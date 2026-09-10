/** One isolated shipped Headless experience run, using only public host APIs. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installHostResolution, ISOLATED_ENTRIES } from '../runtime-e2e/host.mjs'
import { taskById, createWorld, prompt, grade, scriptFor } from './tasks.mjs'
import { TaskDiagnostics, failureCategory } from './diagnostics.mjs'
import { TOOL_SPEC, renderResult, PROTOCOL_VERSION } from './protocol.mjs'
import { hash } from './report.mjs'
import { ExperimentLedger, MODEL } from './experiment-ledger.mjs'
import { installExperimentTransport } from './experiment-transport.mjs'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const {
  harness,
  stateDir,
  runId,
  stage,
  taskId,
  arm,
  resultFile,
  seedDir,
  seedOutput,
  outputCap,
  toolLimit,
  fault = 'none',
} = config
const ledger = new ExperimentLedger(stateDir)
const live = ledger.read().mode === 'live'
assert.equal(ledger.read().active, runId)
if (live) {
  assert.equal(process.env.EVOLVER_LIVE_AUTHORIZED, 'yes')
  assert.equal(fault, 'none')
}
const task = taskById(taskId)
let reason = null,
  currentSession,
  firstRequestHash,
  firstWireHash,
  mainSession
let ctx, fixture, mainAgent
let validationError = false
let completed
const done = new Promise((resolve) => {
  completed = resolve
})
const sessions = new Map(),
  expected = new Map(),
  handles = []
let scripted = scriptFor(task, 'solve')
if (fault === 'success-only') scripted = scripted.slice(1)
let selected = []
const checks = {
  profile: false,
  canonical: false,
  resultDelivery: false,
  auditPrivacy: false,
  disposal: false,
}
const lifecycle = {}
const dataDir = join(process.env.DSH_HOME, 'evolver')
if (seedDir) await cp(seedDir, dataDir, { recursive: true })
const seedText = seedDir ? await readFile(join(seedDir, 'audit-v1.jsonl'), 'utf8') : ''
const stop = (value) => {
  reason ??= value
}
function session(id) {
  if (!sessions.has(id)) {
    const world = createWorld(task)
    sessions.set(id, {
      world,
      diagnostics: new TaskDiagnostics(task, world),
      requests: 0,
      guidanceSeen: false,
    })
  }
  return sessions.get(id)
}
function safeSessions() {
  return [...sessions].map(([id, s]) => ({
    id,
    requests: s.requests,
    guidanceSeen: s.guidanceSeen,
    goalReached: grade(task, s.world.snapshot()),
    diagnostics: s.diagnostics.snapshot(),
  }))
}
function checkpoint() {
  writeFileSync(
    resultFile + '.next',
    JSON.stringify({
      runId,
      stage,
      taskId,
      arm,
      reason,
      firstRequestHash,
      firstWireHash,
      initialStateHash: hash({ task, state: createWorld(task).snapshot() }),
      seedHash: hash(seedText),
      selected: selected.map((p) => ({ id: p.id, guidanceHash: hash(p.guidance) })),
      sessions: safeSessions(),
      checks,
      lifecycle,
    }),
    { mode: 0o600 },
  )
  renameSync(resultFile + '.next', resultFile)
}

installHostResolution(harness)
const transport = installExperimentTransport({
  live,
  ledger,
  runId,
  outputCap,
  fault,
  onStop: stop,
  requestMs: config.requestMs,
  nextFixture: () => scripted.shift(),
  onWire(wire) {
    const s = session(currentSession)
    s.diagnostics.wire(wire.messages)
    const instruction = wire.messages.filter((m) =>
      m.content?.startsWith('Promoted evolution strategies:'),
    )
    const anticipated = expected.get(currentSession) ?? []
    assert.equal(instruction.length, anticipated.length ? 1 : 0)
    for (const p of anticipated) assert.ok(instruction[0].content.includes(p.guidance))
    if (!firstWireHash)
      firstWireHash = hash({
        ...wire,
        messages: wire.messages.filter((m) => !instruction.includes(m)),
      })
    s.requests++
    checkpoint()
  },
})

const { boot, loadProfile, composeEntries } = await import('@deepseek-ai/dsh-app-boot')
const { defineTool } = await import('@deepseek-ai/dsh-tools')
const { HarnessError, createUserMessage } = await import('@deepseek-ai/dsh-llm')
const { SessionId } = await import('@deepseek-ai/dsh-session')
const evolverUrl = new URL('../../lib/index.js', import.meta.url)
const { EvolutionStore } = await import(evolverUrl.href)
if (seedDir) {
  const store = await EvolutionStore.open(dataDir)
  selected = [...store.snapshot().proposals.values()].filter((p) =>
    (config.selectedIds ?? []).includes(p.id),
  )
  assert.equal(selected.length, config.selectedIds.length)
  if (stage === 'recovery') {
    const expectedState = JSON.parse(await readFile(join(seedDir, 'recovery.json'), 'utf8'))
    assert.deepEqual(recoveryState(store.snapshot()), expectedState)
    assert.ok(selected.every((p) => p.status === 'superseded'))
    lifecycle.restartReplay = true
  }
  await store.whenIdle()
}
const anchor = join(harness, 'apps/cli/package.json')
const profile = loadProfile('evolver-experience', 'headless', anchor, process.env.DSH_HOME, {
  userLayer: false,
})
const patches = profile.layers.flatMap((layer) => layer.patches)
const entries = composeEntries([patches])
const disabled = new Set(ISOLATED_ENTRIES)
disabled.delete('llm-deepseek')
for (const entry of entries) if (entry.id?.startsWith('tool-')) disabled.add(entry.id)
const overlays = [...disabled]
  .filter((id) => entries.some((e) => e.id === id))
  .map((id) => ({ id, disabled: true }))
overlays.push(
  { id: 'agent-default-model', config: { provider: 'deepseek-official', model: MODEL } },
  { id: 'tools', config: { mode: 'native' } },
  {
    id: 'llm-deepseek',
    config: {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com',
      thinking: 'disabled',
      reasoningEffort: 'off',
      maxTokens: outputCap,
      streamIdleTimeoutMs: 30000,
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    },
  },
  {
    insert: [
      {
        id: 'dsh-evolver',
        name: evolverUrl.href,
        config: {
          dataDir,
          evaluationWindowSize: 20,
          minimumEvaluationSamples: 1,
        },
      },
      {
        id: 'experience-human-review',
        name: new URL('./experience-review.mjs', import.meta.url).href,
        config: { arm, selectedIds: config.selectedIds ?? [] },
      },
    ],
  },
)
const configFile = join(profile.dir, 'cordis.yml')
writeFileSync(configFile, '[]\n')
const initialPrompt =
  stage === 'training'
    ? `This is a controlled recovery drill. First attempt this deliberately invalid operation once: ${JSON.stringify(scriptFor(task, 'solve')[0][0])}. Then recover and complete the task. ${prompt(task)}`
    : prompt(task)

async function command(agent, text) {
  const answer = await ctx.commands.execute(agent, text, [], new AbortController().signal)
  assert.equal(answer?.result.kind, 'success', 'public review command failed')
}
async function canonical(agent) {
  await ctx.sessions.flush(agent.session)
  const saved = await ctx.sessionPersistence.open(agent.session.id, 'read')
  try {
    const { events } = await saved.read()
    const instructions = events.filter(
      (e) => e.type === 'user/message' && e.data.source?.plugin === 'dsh-evolver',
    )
    const anticipated = expected.get(String(agent.session.id)) ?? []
    assert.equal(instructions.length, anticipated.length ? 1 : 0)
    for (const p of anticipated) assert.ok(JSON.stringify(instructions).includes(p.guidance))
  } finally {
    await saved.close()
  }
}

function recoveryState(state) {
  return {
    patterns: [...state.patterns.values()],
    proposals: [...state.proposals.values()],
    evaluations: [...state.evaluations.values()],
    observations: state.observations.size,
    lastSeq: state.lastSeq,
  }
}

async function fresh(id) {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'deepseek-official', model: MODEL, maxTokens: outputCap },
  })
  handles.push(handle)
  return handle.agent
}

async function probe(agent, fail = false) {
  const args = fail ? scriptFor(task, 'solve')[0][0] : { action: 'inspect', payload: '' }
  const s = session(String(agent.session.id))
  const before = s.world.snapshot().calls
  if (!live) scripted = [[args], []]
  agent.followup(
    createUserMessage({
      content: [
        {
          type: 'text',
          text: `Call bench_apply exactly once with ${JSON.stringify(args)}. This is an isolated lifecycle probe. Do not retry or add calls, even on failure. Then reply OK.`,
        },
      ],
      source: { kind: 'user' },
    }),
  )
  await agent.whenIdle()
  await ctx.get('evolver')?.whenIdle()
  assert.equal(reason, null)
  assert.equal(s.world.snapshot().calls, before + 1)
  await canonical(agent)
}

try {
  ctx = await boot(
    'evolver-experience',
    configFile,
    [...patches, ...overlays],
    async (host) => {
      host.provide('cmdlineArgs', { get: () => [initialPrompt] })
      host.provide('appExit', (code) => {
        if (code && !reason) stop('runtime-error')
        completed()
      })
      fixture = await host.plugin({
        name: 'experience-fixture',
        inject: ['llm', 'tools', 'systemPrompt', 'agents', 'commands'],
        async apply(scoped) {
          scoped.systemPrompt.section({
            name: 'experience',
            order: 0,
            complete: true,
            text: 'Complete the user task using the provided tool. Report the result honestly.',
          })
          scoped.on('agent/session-start', ({ agent }) =>
            expected.set(String(agent.session.id), [
              ...(scoped.get('evolver')?.listPromoted() ?? []),
            ]),
          )
          scoped.on('tools/result', (exec, result) => {
            if (exec.agent) session(String(exec.agent.session.id)).diagnostics.result(exec, result)
          })
          scoped.on(
            'llm/stream',
            async function* (options, next) {
              if (reason) throw new Error('experiment stopped')
              currentSession = String(options.sessionId)
              mainSession ??= currentSession
              const s = session(currentSession)
              s.diagnostics.options(options.messages)
              assert.equal(options.maxTokens, outputCap)
              assert.deepEqual(
                options.tools.map((t) => t.name),
                ['bench_apply'],
              )
              const instructions = options.messages.filter(
                (m) => m.source?.kind === 'plugin' && m.source.plugin === 'dsh-evolver',
              )
              const anticipated = expected.get(currentSession) ?? []
              if (currentSession === mainSession)
                assert.deepEqual(
                  anticipated.map((p) => p.id),
                  arm === 'treatment' ? selected.map((p) => p.id) : [],
                )
              assert.equal(instructions.length, anticipated.length ? 1 : 0)
              for (const p of anticipated)
                assert.ok(JSON.stringify(instructions).includes(p.guidance))
              s.guidanceSeen = instructions.length > 0
              if (!firstRequestHash)
                firstRequestHash = hash({
                  model: options.model,
                  system: options.system,
                  tools: options.tools,
                  messages: options.messages
                    .filter((m) => !instructions.includes(m))
                    .map(({ role, content }) => ({ role, content })),
                })
              let usage = null,
                reports = 0
              try {
                for await (const chunk of next()) {
                  if (chunk.type === 'usage') {
                    reports++
                    usage = {
                      input:
                        chunk.usage.inputTokens +
                        (chunk.usage.cacheReadTokens ?? 0) +
                        (chunk.usage.cacheWriteTokens ?? 0),
                      output: chunk.usage.outputTokens,
                    }
                  }
                  if (
                    chunk.type === 'finish' &&
                    !['stop', 'tool-calls'].includes(chunk.reason.kind)
                  )
                    stop(chunk.reason.kind === 'max-tokens' ? 'output-budget' : 'provider-error')
                  yield chunk
                }
                if (reports !== 1 && !reason) stop('usage-missing')
              } catch {
                stop('provider-error')
                throw new Error('experiment adapter failed')
              } finally {
                transport.finish(usage, reason)
              }
            },
            { global: true },
          )
          scoped.tools.register(
            defineTool({
              ...TOOL_SPEC,
              output: { schema: { type: 'string' }, render: renderResult },
              execute(args, exec) {
                const s = session(String(exec.agent.session.id))
                if (reason || s.world.snapshot().calls >= toolLimit) {
                  stop(reason ?? 'tool-budget')
                  throw new HarnessError('Experiment tool budget exhausted.', 'EXPERIMENT_STOP')
                }
                return s.diagnostics.execute(exec.callId, args, () => {
                  try {
                    return s.world.execute(args)
                  } catch (error) {
                    const code =
                      {
                        'stale-revision': 'STALE_REVISION',
                        'uppercase-required': 'UPPERCASE_REQUIRED',
                        'batch-limit': 'BATCH_LIMIT',
                      }[failureCategory(error.message)] ?? 'TOOL_FAILURE'
                    throw new HarnessError(error.message, code)
                  }
                })
              },
            }),
          )
        },
      })
    },
    pathToFileURL(dirname(anchor)).href + '/',
  )
  await done
  await ctx.evolver.whenIdle()
  checks.profile =
    profile.layers.some((l) => l.packageName === '@deepseek-ai/dsh-headless') &&
    [...ctx.loader.entries()].some((e) => e.options.id === 'headless-runner')
  assert.equal(checks.profile, true)
  mainAgent = ctx.agents.get(SessionId(mainSession))
  assert.ok(mainAgent)
  await canonical(mainAgent)
  checks.canonical = true

  if (!reason && stage === 'training') {
    const state = (await EvolutionStore.open(dataDir)).snapshot()
    assert.ok(state.observations.size > 0, 'training must contain a real DSH failure')
    assert.ok([...state.observations.values()].every((o) => o.sessionId === mainSession))
    selected = ctx.evolver
      .listProposals('pending')
      .filter((p) => state.observations.get(p.observationId)?.sessionId === mainSession)
    assert.ok(selected.length > 0, 'no candidate from real training')
    for (const p of selected) {
      assert.equal(p.verification?.decision, 'passed')
      await command(mainAgent, `/evolve accept ${p.id}`)
    }
    await ctx.evolver.whenIdle()
    await cp(dataDir, seedOutput, { recursive: true })
    lifecycle.trainingFromRealToolFailure = true
    lifecycle.acceptedByCommand = true
    lifecycle.provenance = selected.map((p) => ({
      id: p.id,
      observationId: p.observationId,
      patternId: p.patternId,
      generation: p.generation,
      patternOccurrence: p.patternOccurrence,
      errorCode: state.observations.get(p.observationId).errorCode,
      verifier: p.verification.verifier,
      guidanceHash: hash(p.guidance),
    }))
  }
  if (!reason && stage === 'lifecycle') {
    assert.ok(selected.length > 0 && selected.every((p) => p.status === 'accepted'))
    assert.equal(session(mainSession).guidanceSeen, false)
    lifecycle.acceptedExcluded = true
    for (const p of selected) await command(mainAgent, `/evolve promote ${p.id}`)
    const treatment = await fresh('experience-treatment')
    await probe(treatment)
    const evaluations = selected.map((p) => ctx.evolver.getEvaluation(p.id))
    assert.ok(evaluations.every((e) => e.treatment.total === 1))
    assert.equal(session('experience-treatment').guidanceSeen, true)
    lifecycle.promotedCanonicalAndWire = true
    await probe(mainAgent)
    assert.deepEqual(
      selected.map((p) => ctx.evolver.getEvaluation(p.id)),
      evaluations,
    )
    lifecycle.exposureOnly = true
    for (const p of selected)
      await command(mainAgent, `/evolve rollback ${p.id} isolated lifecycle review`)
    const rolledBack = await fresh('experience-rollback')
    await probe(rolledBack)
    assert.equal(session('experience-rollback').guidanceSeen, false)
    lifecycle.rollbackExcluded = true
    const before = await readFile(join(dataDir, 'audit-v1.jsonl'), 'utf8')
    const service = ctx.evolver
    const entry = [...ctx.loader.entries()].find((e) => e.options.id === 'dsh-evolver')
    await entry.fiber.dispose()
    assert.equal(ctx.commands.find(mainAgent, 'evolve'), undefined)
    await probe(rolledBack, true)
    await service.whenIdle()
    assert.equal(await readFile(join(dataDir, 'audit-v1.jsonl'), 'utf8'), before)
    lifecycle.disposalNoMutation = true
    await cp(dataDir, seedOutput, { recursive: true })
    await writeFile(
      join(seedOutput, 'recovery.json'),
      JSON.stringify(recoveryState((await EvolutionStore.open(dataDir)).snapshot())),
      { mode: 0o600 },
    )
  }
  const audit = await readFile(join(dataDir, 'audit-v1.jsonl'), 'utf8').catch(async (error) => {
    if (error.code !== 'ENOENT') throw error
    // Successful outcomes outside an evaluation cohort intentionally create no journal.
    const state = (await EvolutionStore.open(dataDir)).snapshot()
    assert.equal(state.observations.size, 0)
    assert.equal(state.proposals.size, 0)
    assert.ok(safeSessions().every((s) => s.diagnostics.operations.every((op) => !op.failure)))
    return ''
  })
  for (const value of [task.target, ...task.items, '"payload"', process.env.DEEPSEEK_API_KEY])
    if (value) assert.equal(audit.includes(value), false)
  checks.auditPrivacy = true
  const operations = safeSessions().flatMap((s) => s.diagnostics.operations)
  assert.ok(operations.every((op) => op.bodyValueRendered !== false))
  assert.ok(operations.every((op) => op.nextOptions === null || op.nextOptions.matchesFinal))
  assert.ok(
    operations.every(
      (op) =>
        op.nextWire === null || (op.nextWire.matchesFinal && op.nextWire.matchesBody !== false),
    ),
  )
  checks.resultDelivery = true
} catch {
  validationError = true
  stop('runtime-assertion')
} finally {
  for (const handle of handles) await handle.dispose()
  if (fixture) {
    await fixture.dispose()
    assert.equal(ctx?.tools.get('bench_apply'), undefined)
  }
  await ctx?.fiber.dispose()
  if (ctx) {
    assert.equal(ctx.get('agents'), undefined)
    checks.disposal = true
  }
  transport.assertOfflineBoundary()
}
checkpoint()
const result = JSON.parse(readFileSync(resultFile, 'utf8'))
const main = sessions.get(mainSession)
const state = main?.world.snapshot()
writeFileSync(
  resultFile,
  JSON.stringify({
    ...result,
    protocol: PROTOCOL_VERSION,
    status: validationError
      ? 'invalid'
      : !reason
        ? 'completed'
        : reason.endsWith('budget')
          ? 'budget'
          : 'invalid',
    success: !validationError && !reason && !!state && grade(task, state),
    validationError,
    goalReached: !!state && grade(task, state),
    calls: state?.calls ?? 0,
    repeatedInvalid: state?.repeatedInvalid ?? 0,
  }),
  { mode: 0o600 },
)
