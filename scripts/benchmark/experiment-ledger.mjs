/** Single-controller experiment ledger. Each child exits before the next writer starts. */
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'

export const LIVE_LIMITS = Object.freeze({
  requests: 160,
  outputPerRequest: 1024,
  output: 163840,
  inputPerRequest: 8192,
  input: 1310720,
  requestMs: 30000,
  liveMs: 1200000,
  evaluationReserve: 40,
})
export const MODEL = 'deepseek-v4-flash'
const VERSION = 'experience-ledger-v1'
const stages = ['development', 'training', 'lifecycle', 'recovery', 'evaluation']
const natural = (n) => Number.isSafeInteger(n) && n >= 0
const allowedId = (s) => typeof s === 'string' && /^[a-z0-9:-]{1,128}$/.test(s)

export class ExperimentStop extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}
export function stop(reason) {
  throw new ExperimentStop(reason)
}

/** Validate before every mutation; missing, corrupt, active, or mismatched ledgers never reset. */
export class ExperimentLedger {
  constructor(directory) {
    this.path = join(directory, 'budget.json')
  }
  static initialize(directory, mode) {
    assert.ok(['offline', 'live'].includes(mode))
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const ledger = new ExperimentLedger(directory)
    if (existsSync(ledger.path)) {
      assert.equal(ledger.read().mode, mode)
      return ledger
    }
    assert.equal(
      readdirSync(directory).length,
      0,
      'nonempty state without its ledger must not reset',
    )
    writeFileSync(
      join(directory, 'authorization.json'),
      JSON.stringify({ version: VERSION, mode, model: MODEL, limits: LIVE_LIMITS }),
      { flag: 'wx', mode: 0o600 },
    )
    writeFileSync(
      ledger.path,
      JSON.stringify({
        version: VERSION,
        mode,
        model: MODEL,
        limits: LIVE_LIMITS,
        liveMs: 0,
        runs: [],
        requests: [],
        active: null,
        blocked: null,
      }),
      { flag: 'wx', mode: 0o600 },
    )
    return ledger
  }
  read() {
    const s = JSON.parse(readFileSync(this.path, 'utf8'))
    assert.equal(s.version, VERSION)
    assert.equal(s.model, MODEL)
    assert.deepEqual(s.limits, LIVE_LIMITS)
    assert.ok(['offline', 'live'].includes(s.mode) && natural(s.liveMs))
    assert.ok(
      Array.isArray(s.runs) &&
        Array.isArray(s.requests) &&
        s.requests.length <= LIVE_LIMITS.requests,
    )
    assert.equal(new Set(s.runs.map((r) => r.id)).size, s.runs.length)
    for (const r of s.runs) {
      assert.ok(
        allowedId(r.id) && stages.includes(r.stage) && natural(r.startedAt) && natural(r.deadline),
      )
      assert.ok(Number.isSafeInteger(r.requestLimit) && r.requestLimit > 0 && r.requestLimit <= 16)
      assert.ok(['running', 'finished'].includes(r.state))
    }
    let input = 0,
      output = 0
    s.requests.forEach((r, i) => {
      assert.equal(r.index, i)
      assert.ok(s.runs.some((run) => run.id === r.runId))
      assert.ok(natural(r.input) && r.input <= LIVE_LIMITS.inputPerRequest)
      assert.ok(natural(r.output) && r.output > 0 && r.output <= LIVE_LIMITS.outputPerRequest)
      assert.ok(natural(r.deadline) && ['reserved', 'reported', 'failed'].includes(r.state))
      assert.ok(natural(r.reservedAt) && r.deadline <= r.reservedAt + LIVE_LIMITS.requestMs)
      if (r.usage) assert.ok(natural(r.usage.input) && natural(r.usage.output))
      input += r.input
      output += r.output
    })
    assert.ok(input <= LIVE_LIMITS.input && output <= LIVE_LIMITS.output)
    assert.ok(s.active === null || s.runs.some((r) => r.id === s.active && r.state === 'running'))
    return s
  }
  write(s) {
    writeFileSync(this.path + '.next', JSON.stringify(s), { mode: 0o600 })
    renameSync(this.path + '.next', this.path)
  }
  begin({ id, stage, requestLimit, runMs }, now = Date.now()) {
    const s = this.read()
    assert.equal(s.active, null, 'unfinished run requires explicit recovery; budget is not reset')
    assert.ok(!s.runs.some((r) => r.id === id), 'run already attempted; no replacement runs')
    assert.ok(allowedId(id) && stages.includes(stage))
    assert.ok(Number.isSafeInteger(requestLimit) && requestLimit > 0 && requestLimit <= 16)
    assert.ok(Number.isSafeInteger(runMs) && runMs > 0 && runMs <= 180000)
    if (s.blocked) stop('ledger-blocked')
    const remainingMs = LIVE_LIMITS.liveMs - s.liveMs
    if (remainingMs <= 0) stop('total-time-budget')
    if (
      s.requests.length >=
      (stage === 'evaluation'
        ? LIVE_LIMITS.requests
        : LIVE_LIMITS.requests - LIVE_LIMITS.evaluationReserve)
    )
      stop('request-budget')
    const run = {
      id,
      stage,
      requestLimit,
      startedAt: now,
      deadline: now + Math.min(runMs, remainingMs),
      state: 'running',
    }
    s.runs.push(run)
    s.active = id
    this.write(s)
    return run
  }
  reserve(runId, body, outputCap, now = Date.now(), requestMs = LIVE_LIMITS.requestMs) {
    const s = this.read()
    assert.equal(s.active, runId)
    const run = s.runs.find((r) => r.id === runId)
    if (s.blocked) stop('ledger-blocked')
    if (now >= run.deadline) stop('run-time-budget')
    assert.ok(natural(outputCap) && outputCap > 0 && outputCap <= LIVE_LIMITS.outputPerRequest)
    assert.ok(
      Number.isSafeInteger(requestMs) && requestMs > 0 && requestMs <= LIVE_LIMITS.requestMs,
    )
    const wire = JSON.parse(body)
    const keys = [
      'model',
      'messages',
      'stream',
      'stream_options',
      'thinking',
      'reasoning_effort',
      'tools',
      'temperature',
      'max_tokens',
      'stop',
    ]
    assert.ok(
      Object.keys(wire).every((k) => keys.includes(k)),
      'unexpected wire extension',
    )
    assert.equal(wire.model, MODEL)
    assert.equal(wire.stream, true)
    assert.equal(wire.thinking?.type, 'disabled')
    assert.equal(wire.max_tokens, outputCap)
    assert.ok(
      Array.isArray(wire.messages) &&
        wire.messages.every((m) => m.content == null || typeof m.content === 'string'),
    )
    assert.equal(wire.tools?.length, 1)
    assert.equal(wire.tools[0].function?.name, 'bench_apply')
    const calls = s.requests.filter((r) => r.runId === runId)
    assert.ok(!calls.some((r) => r.state === 'reserved'), 'previous request has not settled')
    if (
      calls.length >= run.requestLimit ||
      s.requests.length >=
        (run.stage === 'evaluation'
          ? LIVE_LIMITS.requests
          : LIVE_LIMITS.requests - LIVE_LIMITS.evaluationReserve)
    )
      stop('request-budget')
    const input = Buffer.byteLength(body) + 256 + wire.messages.length * 32
    if (
      input > LIVE_LIMITS.inputPerRequest ||
      s.requests.reduce((n, r) => n + r.input, input) > LIVE_LIMITS.input
    )
      stop('input-budget')
    if (s.requests.reduce((n, r) => n + r.output, outputCap) > LIVE_LIMITS.output)
      stop('output-budget')
    const request = {
      index: s.requests.length,
      runId,
      input,
      output: outputCap,
      reservedAt: now,
      deadline: Math.min(now + requestMs, run.deadline),
      state: 'reserved',
      usage: null,
    }
    s.requests.push(request)
    this.write(s)
    return request
  }
  settle(index, usage, reason = null) {
    const s = this.read(),
      r = s.requests[index]
    assert.ok(r && r.runId === s.active && r.state === 'reserved')
    if (usage) {
      assert.ok(natural(usage.input) && natural(usage.output))
      r.usage = usage
      if (usage.input > r.input || usage.output > r.output)
        s.blocked = 'provider-usage-exceeded-reservation'
    }
    r.state = usage && !reason ? 'reported' : 'failed'
    r.reason = reason
    this.write(s)
    if (s.blocked) stop('provider-usage-exceeded-reservation')
  }
  end(runId, reason, now = Date.now()) {
    const s = this.read()
    assert.equal(s.active, runId)
    const run = s.runs.find((r) => r.id === runId)
    run.state = 'finished'
    run.elapsedMs = Math.max(0, now - run.startedAt)
    run.reason = reason
    for (const request of s.requests.filter((r) => r.runId === runId && r.state === 'reserved')) {
      request.state = 'failed'
      request.reason = reason ?? 'runtime-error'
    }
    s.liveMs += run.elapsedMs
    s.active = null
    this.write(s)
  }
  summary() {
    const s = this.read()
    return {
      mode: s.mode,
      requests: s.requests.length,
      reservedInput: s.requests.reduce((n, r) => n + r.input, 0),
      reservedOutput: s.requests.reduce((n, r) => n + r.output, 0),
      reportedInput: s.requests.reduce((n, r) => n + (r.usage?.input ?? 0), 0),
      reportedOutput: s.requests.reduce((n, r) => n + (r.usage?.output ?? 0), 0),
      usageReports: s.requests.filter((r) => r.usage).length,
      unreportedRequests: s.requests.filter((r) => !r.usage).length,
      liveMs: s.liveMs,
      remainingRequests: LIVE_LIMITS.requests - s.requests.length,
      blocked: s.blocked,
    }
  }
}
