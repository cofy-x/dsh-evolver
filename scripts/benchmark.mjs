/** Isolated paired experiment controller; live transport requires explicit paid opt-in. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHarness } from './harness-source.mjs'
import { TASKS, VERSION } from './benchmark/tasks.mjs'
import { BOUNDS, hash, schedule, summarize } from './benchmark/report.mjs'
import { LEGACY_PROTOCOL_VERSION } from './benchmark/protocol.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(
    'Usage: node scripts/benchmark.mjs [--harness=PATH] [--split=development|pilot|heldout] [--seed=INTEGER] [--baseline=solve|repeat|claim|overhead|budget|infra|hang|leak] [--treatment=...] [--run-timeout-ms=1..45000] [--adapter=scripted|deepseek-fixture|deepseek-live] [--model=deepseek-v4-flash] [--allow-paid=yes]\nHost path: explicit CLI, then DSH_TEST_HARNESS, then the pinned source host (pnpm run prepare:harness). Default offline. DeepSeek modes require the pilot split and prohibit script overrides. Live requires explicit paid opt-in and DEEPSEEK_API_KEY; only the official endpoint is allowed. Safe JSON only; temporary state is removed.',
  )
  process.exit(0)
}
const options = {}
for (const arg of args) {
  const match =
    /^--(harness|split|seed|baseline|treatment|run-timeout-ms|adapter|model|allow-paid|fixture-fault)=(.+)$/.exec(
      arg,
    )
  assert.ok(match && !(match[1] in options), 'unknown or duplicate argument')
  options[match[1]] = match[2]
}
const split = options.split ?? 'pilot'
const adapter = options.adapter ?? 'scripted'
assert.ok(['scripted', 'deepseek-fixture', 'deepseek-live'].includes(adapter))
const live = adapter === 'deepseek-live'
const transport = adapter !== 'scripted'
const fault = options['fixture-fault'] ?? 'none'
assert.ok(['none', 'rate-limit', 'hang', 'legacy-render'].includes(fault))
if (options['fixture-fault']) assert.equal(adapter, 'deepseek-fixture')
const model = options.model ?? 'deepseek-v4-flash'
assert.ok(/^deepseek-[a-z0-9-]+$/.test(model))
if (transport) assert.ok(split === 'pilot' && !options.baseline && !options.treatment)
if (live) assert.equal(options['allow-paid'], 'yes', 'live requires --allow-paid=yes')
else assert.equal(options['allow-paid'], undefined)
// Do not inspect credentials unless all command-line validation has passed.
assert.ok(['development', 'pilot', 'heldout'].includes(split))
const seed = Number(options.seed ?? 17)
assert.ok(Number.isSafeInteger(seed) && seed >= 0)
const runMs = Number(options['run-timeout-ms'] ?? BOUNDS.runMs)
assert.ok(Number.isSafeInteger(runMs) && runMs > 0 && runMs <= BOUNDS.runMs)
const behaviors = { baseline: options.baseline ?? 'solve', treatment: options.treatment ?? 'solve' }
assert.ok(
  Object.values(behaviors).every((value) =>
    ['solve', 'repeat', 'claim', 'overhead', 'budget', 'infra', 'hang', 'leak'].includes(value),
  ),
)
const harness = resolveHarness(options.harness)
const apiKey = live ? process.env.DEEPSEEK_API_KEY : 'fixture-not-a-secret'
if (live) assert.ok(apiKey && !/[\r\n]/.test(apiKey), 'DEEPSEEK_API_KEY is required')
const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-benchmark-'))
const ledgerPath = join(root, 'ledger.json')
await writeFile(ledgerPath, JSON.stringify({ requests: 0, input: 0, output: 0, runs: {} }), {
  mode: 0o600,
})
const tasks = TASKS.filter((task) => task.split === split)
const plan = schedule(tasks, seed)
const rows = []
const deadline = Date.now() + BOUNDS.totalMs
const driver = fileURLToPath(new URL('./benchmark/driver.mjs', import.meta.url))
const revision = (cwd) =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
const dirty = (cwd) =>
  execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim().length > 0
const product = fileURLToPath(new URL('..', import.meta.url))
const implementationFiles = [
  'scripts/benchmark.mjs',
  'scripts/benchmark/driver.mjs',
  'scripts/benchmark/tasks.mjs',
  'scripts/benchmark/report.mjs',
  'scripts/benchmark/transport.mjs',
  'scripts/benchmark/diagnostics.mjs',
  'scripts/benchmark/protocol.mjs',
  'scripts/runtime-e2e/host.mjs',
  'scripts/compatibility.mjs',
  'scripts/harness-source.mjs',
  'scripts/harness-source.json',
  'scripts/runtime-e2e/budget.mjs',
  'src/proposer.ts',
]
const readImplementation = () =>
  Promise.all(
    implementationFiles.map(async (path) => [path, await readFile(join(product, path), 'utf8')]),
  )
try {
  const implementationHash = hash(await readImplementation())
  for (const run of plan) {
    const pairRoot = join(root, run.taskId)
    const workspace = join(pairRoot, 'workspace')
    await mkdir(workspace, { recursive: true })
    const home = join(pairRoot, run.arm)
    const resultFile = join(home, 'result.json')
    const empty = {
      ...run,
      status: 'not-run',
      success: false,
      calls: null,
      repeatedInvalid: null,
      requests: null,
      inputUnits: null,
      outputUnits: null,
      elapsedMs: null,
    }
    if (Date.now() >= deadline) {
      rows.push(empty)
      continue
    }
    const outcome = await new Promise((resolveResult) => {
      const child = spawn(
        process.execPath,
        [
          driver,
          harness,
          pairRoot,
          run.taskId,
          run.arm,
          behaviors[run.arm],
          resultFile,
          adapter,
          model,
          ledgerPath,
          String(Math.min(deadline, Date.now() + runMs)),
          fault,
        ],
        {
          cwd: workspace,
          env: {
            PATH: process.env.PATH,
            DSH_HOME: home,
            DSH_AGENTS_HOME: join(home, 'agents'),
            XDG_CONFIG_HOME: join(home, 'config'),
            XDG_CACHE_HOME: join(home, 'cache'),
            DSH_TELEMETRY_DISABLED: '1',
            ...(transport ? { DEEPSEEK_API_KEY: apiKey } : {}),
            ...(live ? { EVOLVER_LIVE_AUTHORIZED: 'yes' } : {}),
          },
          stdio: 'ignore',
        },
      )
      let timedOut = false
      let spawnFailed = false
      const timer = setTimeout(
        () => {
          timedOut = true
          child.kill('SIGKILL')
        },
        Math.min(runMs, Math.max(1, deadline - Date.now())),
      )
      child.on('error', () => {
        spawnFailed = true
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolveResult({ code, timedOut, spawnFailed })
      })
    })
    if (outcome.timedOut) {
      const checkpoint = await readFile(resultFile, 'utf8').then(
        (text) => {
          try {
            return JSON.parse(text)
          } catch {
            return {}
          }
        },
        () => ({}),
      )
      rows.push({
        ...empty,
        status: 'timeout',
        stopReason: 'run-time-budget',
        diagnostics: checkpoint.diagnostics,
        firstRequestHash: checkpoint.firstRequestHash,
        initialStateHash: checkpoint.initialStateHash,
        seedHash: checkpoint.seedHash,
        guidanceHash: checkpoint.guidanceHash,
        exposureSeen: checkpoint.exposureSeen,
        wireFirstRequestHash: checkpoint.wireFirstRequestHash,
      })
    } else if (outcome.code !== 0 || outcome.spawnFailed)
      rows.push({ ...empty, status: 'infrastructure' })
    else {
      try {
        const row = JSON.parse(await readFile(resultFile, 'utf8'))
        assert.equal(row.taskId, run.taskId)
        assert.equal(row.arm, run.arm)
        rows.push(row)
      } catch {
        rows.push({ ...empty, status: 'infrastructure' })
      }
    }
  }
  // Only metadata/identity is omitted by the driver; no model-visible text is normalized away.
  for (const task of tasks) {
    const pair = rows.filter((row) => row.taskId === task.id)
    const keys = ['firstRequestHash', 'initialStateHash', 'seedHash', 'guidanceHash']
    if (transport) keys.push('wireFirstRequestHash')
    const intact =
      pair.every((row) => keys.every((key) => typeof row[key] === 'string')) &&
      keys.every((key) => pair[0][key] === pair[1][key])
    for (const row of pair) row.pairIntegrity = intact
    if (pair.every((row) => row.firstRequestHash)) {
      if (!intact) {
        for (const row of pair) {
          row.status = 'invalid'
          row.success = false
        }
      }
    }
  }
  const unchanged = implementationHash === hash(await readImplementation())
  if (!unchanged)
    for (const row of rows) {
      row.pairIntegrity = false
      row.success = false
    }
  const report = {
    version: VERSION,
    protocol: fault === 'legacy-render' ? 'legacy-render-reproduction' : LEGACY_PROTOCOL_VERSION,
    evidence: live
      ? 'live-adapter-pilot'
      : transport
        ? 'offline-real-adapter'
        : 'offline-harness-only',
    adapter,
    model: transport ? model : null,
    wireReservations: transport ? JSON.parse(await readFile(ledgerPath, 'utf8')) : null,
    split,
    seed,
    behaviors: transport ? null : behaviors,
    fixtureFault: fault,
    limits: {
      ...BOUNDS,
      runMs,
      totalRequests: plan.length * BOUNDS.requestsPerRun,
      totalInputReservation: plan.length * BOUNDS.requestsPerRun * BOUNDS.inputPerRequest,
      totalOutputReservation: plan.length * BOUNDS.requestsPerRun * BOUNDS.outputPerRequest,
    },
    fixtureHash: hash(tasks),
    implementationHash,
    implementationUnchanged: unchanged,
    planHash: hash({ tasks, plan, behaviors, bounds: BOUNDS, runMs, adapter, model, fault }),
    executionOrder: plan,
    node: process.version,
    productSha: revision(product),
    productDirty: dirty(product),
    harnessSha: revision(harness),
    harnessDirty: dirty(harness),
    ...summarize(plan, rows),
  }
  console.log(JSON.stringify(report, null, 2))
  if (report.counts.invalidPairs || rows.some((row) => row.status === 'not-run'))
    process.exitCode = 1
} finally {
  await rm(root, { recursive: true, force: true })
}
