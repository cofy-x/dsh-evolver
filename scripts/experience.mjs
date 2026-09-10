/** Reproducible experience phases sharing one durable, non-resetting budget ledger. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm, open, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TASKS, VERSION } from './benchmark/tasks.mjs'
import { PROTOCOL_VERSION } from './benchmark/protocol.mjs'
import { hash, summarize } from './benchmark/report.mjs'
import { frozenPlan } from './benchmark/experience-plan.mjs'
import { ExperimentLedger, MODEL, LIVE_LIMITS } from './benchmark/experiment-ledger.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(
    'Usage: node scripts/experience.mjs --phase=development|training|lifecycle|recovery|freeze|evaluation|status --mode=offline|live [--state=PATH] [--plan=PATH] [--harness=PATH] [--allow-paid=yes] [--attempt=1|2] [--fault=none|success-only|rate-limit|hang] [--run-ms=1..90000]\nRun phases in the listed order. Freeze writes a new plan without model calls; commit it locally before live evaluation. Live requires explicit authorization and a persistent state directory, reuses DEEPSEEK_API_KEY only, and never resets an existing ledger. No automatic retries or replacements. Explicit development attempt 2 requires a retained invalid report and writes development-r2.json. All live phases must share the same state directory. Status reads the safe ledger without credentials. The credential-free complete loop is pnpm run test:experience.',
  )
  process.exit(0)
}
const options = {}
for (const arg of args) {
  const match =
    /^--(phase|mode|state|harness|allow-paid|fault|run-ms|request-ms|attempt|plan)=(.+)$/.exec(arg)
  assert.ok(match && !Object.hasOwn(options, match[1]), 'unknown or duplicate argument')
  options[match[1]] = match[2]
}
const phase = options.phase ?? 'development'
const mode = options.mode ?? 'offline'
assert.ok(['offline', 'live'].includes(mode))
if (phase === 'status') {
  assert.ok(options.state)
  const ledger = new ExperimentLedger(resolve(options.state))
  console.log(
    JSON.stringify(
      { ...ledger.summary(), runs: ledger.read().runs, requests: ledger.read().requests },
      null,
      2,
    ),
  )
  process.exit(0)
}
assert.ok(
  ['development', 'training', 'lifecycle', 'recovery', 'freeze', 'evaluation'].includes(phase),
  'unknown phase',
)
const live = mode === 'live'
const attempt = Number(options.attempt ?? 1)
assert.ok([1, 2].includes(attempt), 'only explicit development attempts 1 and 2 are defined')
if (phase !== 'development') assert.equal(attempt, 1)
if (live) {
  assert.equal(options['allow-paid'], 'yes')
  assert.ok(options.state, 'live requires a persistent state directory')
} else assert.equal(options['allow-paid'], undefined)
const fault = options.fault ?? 'none'
assert.ok(['none', 'success-only', 'rate-limit', 'hang'].includes(fault))
if (live) assert.equal(fault, 'none')
const runMs = Number(options['run-ms'] ?? 90000)
const requestMs = Number(options['request-ms'] ?? LIVE_LIMITS.requestMs)
assert.ok(Number.isSafeInteger(requestMs) && requestMs > 0 && requestMs <= LIVE_LIMITS.requestMs)
if (live) assert.equal(options['request-ms'], undefined)
assert.ok(Number.isSafeInteger(runMs) && runMs > 0 && runMs <= 90000)
const harness = resolve(options.harness ?? '../deepseek-harness')
const product = fileURLToPath(new URL('..', import.meta.url))
const driver = fileURLToPath(new URL('./benchmark/experience-driver.mjs', import.meta.url))
const stateDir = options.state
  ? resolve(options.state)
  : await mkdtemp(join(tmpdir(), 'evolver-experience-state-'))
const ledger = ExperimentLedger.initialize(stateDir, mode)
const lock = await open(join(stateDir, 'controller.lock'), 'wx', 0o600)
const git = (cwd, ...argv) => execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim()
const implementationFiles = [
  'scripts/experience.mjs',
  'scripts/benchmark/experience-driver.mjs',
  'scripts/benchmark/experience-review.mjs',
  'scripts/benchmark/experience-plan.mjs',
  'scripts/benchmark/experiment-ledger.mjs',
  'scripts/benchmark/experiment-transport.mjs',
  'scripts/benchmark/diagnostics.mjs',
  'scripts/benchmark/protocol.mjs',
  'scripts/benchmark/tasks.mjs',
  'scripts/benchmark/report.mjs',
  'scripts/benchmark/transport.mjs',
  'scripts/runtime-e2e/host.mjs',
  'scripts/runtime-e2e/budget.mjs',
  'src/proposer.ts',
  'src/runtime.ts',
  'src/service.ts',
  'src/config.ts',
]
for (const path of git(product, 'ls-files', 'src').split('\n'))
  if (path && !implementationFiles.includes(path)) implementationFiles.push(path)
for (const path of (await readdir(join(product, 'lib'))).filter((p) => p.endsWith('.js')).sort())
  implementationFiles.push(`lib/${path}`)
const fingerprint = async () =>
  hash(
    await Promise.all(
      implementationFiles.map(async (p) => [p, await readFile(join(product, p), 'utf8')]),
    ),
  )
const rows = []
let scratch
try {
  work: {
    if (phase === 'training') {
      const source = join(stateDir, live ? 'development-r2.json' : 'development.json')
      const development = JSON.parse(await readFile(source, 'utf8'))
      assert.ok(development.implementationUnchanged)
      assert.ok(
        development.rows.length === 3 &&
          development.rows.every(
            (r) => r.goalReached && !r.validationError && Object.values(r.checks).every(Boolean),
          ),
        'all development exact-state goals must be feasible with validated measurements',
      )
    }
    if (attempt === 2) {
      const previous = JSON.parse(await readFile(join(stateDir, 'development.json'), 'utf8'))
      assert.ok(
        previous.rows.some((r) => r.status === 'invalid'),
        'attempt 2 requires a retained invalid development attempt',
      )
    }
    const implementationHash = await fingerprint()
    if (phase === 'freeze') {
      assert.ok(options.plan && options.state, 'freeze requires explicit plan and state paths')
      const frozen = await frozenPlan(
        stateDir,
        implementationHash,
        git(harness, 'rev-parse', 'HEAD'),
      )
      await writeFile(resolve(options.plan), JSON.stringify(frozen, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      })
      console.log(JSON.stringify({ phase, planHash: hash(frozen), pairs: frozen.runs.length / 2 }))
      break work
    }
    let plan = TASKS.filter(
      (t) =>
        t.split === 'development' &&
        (!['lifecycle', 'recovery'].includes(phase) || t.family === 'precondition'),
    ).map((task) => ({
      id: `${PROTOCOL_VERSION}:${phase}${attempt === 1 ? '' : '-r2'}:${task.family}`,
      taskId: task.id,
      stage: phase,
      arm: 'baseline',
      requestLimit: phase === 'lifecycle' ? 16 : 6,
      toolLimit: 10,
      outputCap: 1024,
      ...(phase === 'training' ? { seedOutput: join(stateDir, 'seeds', task.family) } : {}),
    }))
    if (['lifecycle', 'recovery'].includes(phase)) {
      const training = JSON.parse(await readFile(join(stateDir, 'training.json'), 'utf8'))
      assert.ok(
        training.implementationUnchanged &&
          training.rows.every((r) => r.success && r.lifecycle.acceptedByCommand),
      )
      const selected = training.rows.find((r) => r.taskId === 'development-precondition-1').selected
      plan[0].selectedIds = selected.map((p) => p.id)
      plan[0].seedDir = join(
        stateDir,
        ...(phase === 'recovery' ? ['recovery-seed'] : ['seeds', 'precondition']),
      )
      if (phase === 'lifecycle') plan[0].seedOutput = join(stateDir, 'recovery-seed')
      else {
        const previous = JSON.parse(await readFile(join(stateDir, 'lifecycle.json'), 'utf8'))
        assert.ok(
          previous.implementationUnchanged &&
            previous.rows.every((r) => r.success && r.lifecycle.disposalNoMutation),
        )
      }
    }
    let frozen
    if (phase === 'evaluation') {
      assert.ok(options.plan)
      const planPath = resolve(options.plan)
      const bytes = await readFile(planPath, 'utf8')
      frozen = JSON.parse(bytes)
      assert.deepEqual(
        frozen,
        await frozenPlan(stateDir, implementationHash, git(harness, 'rev-parse', 'HEAD')),
        'frozen plan or implementation changed',
      )
      if (live) {
        assert.equal(frozen.trainingMode, 'live')
        assert.equal(
          git(product, 'show', `HEAD:${relative(product, planPath)}`),
          bytes.trim(),
          'live plan must be committed before heldout execution',
        )
        assert.equal(
          git(
            product,
            'status',
            '--porcelain',
            '--',
            ...implementationFiles,
            relative(product, planPath),
          ),
          '',
          'live experiment files must be clean',
        )
      }
      plan = frozen.runs.map((r) => {
        const family = TASKS.find((t) => t.id === r.taskId).family
        const candidate = frozen.candidates.find((c) => c.family === family)
        return {
          ...r,
          seedDir: join(stateDir, 'seeds', family),
          selectedIds: candidate.selected.map((p) => p.id),
        }
      })
    }
    const phaseFile = join(stateDir, `${phase}${attempt === 1 ? '' : '-r2'}.json`)
    // Claim the phase before reading credentials. Interrupted/failed plans cannot be overwritten.
    await writeFile(phaseFile, JSON.stringify({ state: 'started', plan, implementationHash }), {
      flag: 'wx',
      mode: 0o600,
    })
    const apiKey = live ? process.env.DEEPSEEK_API_KEY : 'fixture-not-a-secret'
    assert.ok(apiKey && !/[\r\n]/.test(apiKey), 'DEEPSEEK_API_KEY is required')
    scratch = await mkdtemp(join(tmpdir(), 'evolver-experience-run-'))
    let consecutiveInfrastructure = 0
    for (const run of plan) {
      const empty = {
        runId: run.id,
        taskId: run.taskId,
        arm: run.arm,
        status: 'not-run',
        success: false,
      }
      if (consecutiveInfrastructure >= 2) {
        rows.push({ ...empty, reason: 'infrastructure-stop' })
        continue
      }
      let admission
      try {
        admission = ledger.begin({ ...run, runMs })
      } catch (error) {
        rows.push({ ...empty, reason: error.reason ?? 'ledger-error' })
        continue
      }
      const home = join(scratch, run.taskId, run.arm),
        workspace = join(scratch, run.taskId, 'workspace')
      await mkdir(home, { recursive: true, mode: 0o700 })
      await mkdir(workspace, { recursive: true })
      const resultFile = join(home, 'report.json'),
        configFile = join(home, 'run.json')
      await writeFile(
        configFile,
        JSON.stringify({ ...run, runId: run.id, harness, stateDir, resultFile, fault, requestMs }),
        { mode: 0o600 },
      )
      let killedReason = null
      const code = await new Promise((resolveExit) => {
        const child = spawn(process.execPath, [driver, configFile], {
          cwd: workspace,
          env: {
            PATH: process.env.PATH,
            DSH_HOME: home,
            DSH_AGENTS_HOME: join(home, 'agents'),
            XDG_CONFIG_HOME: join(home, 'config'),
            XDG_CACHE_HOME: join(home, 'cache'),
            DSH_TELEMETRY_DISABLED: '1',
            DEEPSEEK_API_KEY: apiKey,
            ...(live ? { EVOLVER_LIVE_AUTHORIZED: 'yes' } : {}),
          },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        })
        const kill = (reason) => {
          killedReason ??= reason
          child.kill('SIGKILL')
        }
        const timer = setTimeout(
          () => kill('run-time-budget'),
          Math.max(1, admission.deadline - Date.now()),
        )
        let requestTimer, requestIndex
        child.on('message', (message) => {
          if (message?.type === 'request-start') {
            const entry = ledger.read().requests[message.index]
            if (
              !entry ||
              entry.runId !== run.id ||
              entry.deadline !== message.deadline ||
              entry.state !== 'reserved'
            )
              return kill('ledger-error')
            clearTimeout(requestTimer)
            requestIndex = message.index
            requestTimer = setTimeout(
              () => kill('request-time-budget'),
              Math.max(1, entry.deadline - Date.now()),
            )
          } else if (message?.type === 'request-end' && message.index === requestIndex)
            clearTimeout(requestTimer)
        })
        child.on('error', () => {
          killedReason ??= 'runtime-error'
        })
        child.on('close', (value) => {
          clearTimeout(timer)
          clearTimeout(requestTimer)
          resolveExit(value)
        })
      })
      let row
      try {
        row = JSON.parse(await readFile(resultFile, 'utf8'))
        assert.equal(row.runId, run.id)
      } catch {
        row = empty
      }
      if (killedReason || code !== 0)
        row = {
          ...row,
          status: killedReason?.endsWith('budget') ? 'timeout' : 'invalid',
          success: false,
          reason: killedReason ?? 'runtime-error',
        }
      ledger.end(run.id, row.reason)
      row.elapsedMs = Date.now() - admission.startedAt
      const requests = ledger.read().requests.filter((r) => r.runId === run.id)
      row.requests = requests.length
      row.inputUnits = requests.reduce((n, r) => n + r.input, 0)
      row.outputUnits = requests.reduce((n, r) => n + (r.usage?.output ?? 0), 0)
      row.usage = {
        input: requests.reduce((n, r) => n + (r.usage?.input ?? 0), 0),
        output: row.outputUnits,
        reports: requests.filter((r) => r.usage).length,
      }
      rows.push(row)
      consecutiveInfrastructure = row.status === 'invalid' ? consecutiveInfrastructure + 1 : 0
    }
    let summary
    if (phase === 'evaluation') {
      for (const taskId of new Set(plan.map((r) => r.taskId))) {
        const pair = rows.filter((r) => r.taskId === taskId)
        const fields = ['firstRequestHash', 'firstWireHash', 'initialStateHash', 'seedHash']
        const valid =
          pair.length === 2 &&
          fields.every(
            (key) => typeof pair[0][key] === 'string' && pair[0][key] === pair[1][key],
          ) &&
          hash(pair[0].selected) === hash(pair[1].selected)
        for (const row of pair)
          row.pairIntegrity = valid && !!row.checks && Object.values(row.checks).every(Boolean)
      }
      summary = summarize(plan, rows)
    }
    const report = {
      version: 'experience-experiment-v2',
      taskVersion: VERSION,
      protocol: PROTOCOL_VERSION,
      phase,
      attempt,
      mode,
      model: MODEL,
      limits: LIVE_LIMITS,
      plan,
      planHash: hash(plan),
      ...(frozen ? { frozenPlanHash: hash(frozen), summary } : {}),
      fixtureHash: hash(TASKS),
      implementationHash,
      implementationUnchanged: implementationHash === (await fingerprint()),
      productSha: git(product, 'rev-parse', 'HEAD'),
      productDirty: !!git(product, 'status', '--porcelain'),
      harnessSha: git(harness, 'rev-parse', 'HEAD'),
      harnessDirty: !!git(harness, 'status', '--porcelain'),
      dshVersion: JSON.parse(await readFile(join(harness, 'apps/cli/package.json'), 'utf8'))
        .version,
      node: process.version,
      rows,
      budget: ledger.summary(),
    }
    await writeFile(phaseFile, JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(report, null, 2))
    if (!report.implementationUnchanged || rows.some((r) => !r.success)) process.exitCode = 1
  }
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true })
  await lock.close()
  await rm(join(stateDir, 'controller.lock'))
  if (!options.state) await rm(stateDir, { recursive: true, force: true })
}
