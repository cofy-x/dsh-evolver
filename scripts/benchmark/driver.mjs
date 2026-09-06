/** One isolated shipped Headless benchmark arm. No private host imports. */
import assert from 'node:assert/strict'
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import { installHostResolution, ISOLATED_ENTRIES } from '../runtime-e2e/host.mjs'
import { taskById, TASKS, createWorld, prompt, grade, scriptFor } from './tasks.mjs'
import { BOUNDS, hash } from './report.mjs'
import { reserve, response } from './transport.mjs'
import { checkDestination } from '../runtime-e2e/budget.mjs'

const [
  harness,
  pairRoot,
  taskId,
  arm,
  behavior,
  resultFile,
  adapter = 'scripted',
  model,
  ledgerPath,
  deadlineText,
  fault = 'none',
] = process.argv.slice(2)
const transport = adapter !== 'scripted'
const live = adapter === 'deepseek-live'
assert.ok(['scripted', 'deepseek-fixture', 'deepseek-live'].includes(adapter))
if (live) {
  assert.equal(process.env.EVOLVER_LIVE_AUTHORIZED, 'yes')
  assert.equal(fault, 'none')
}
const nativeFetch = globalThis.fetch
const nativeTlsConnect = tls.connect
assert.ok(['baseline', 'treatment'].includes(arm))
assert.ok(
  ['solve', 'repeat', 'claim', 'overhead', 'budget', 'infra', 'hang', 'leak'].includes(behavior),
)
installHostResolution(harness)
let networkAttempts = 0
const deny = () => {
  networkAttempts++
  throw new Error('benchmark forbids network')
}
globalThis.fetch = transport
  ? async (url, init) => {
      if (status !== 'completed') throw new Error('pilot stopped')
      checkDestination(url, init)
      const wire = JSON.parse(init.body)
      if (requests === 0) {
        const guidance = wire.messages.filter((m) => m.content?.includes(proposal.guidance))
        if (guidance.length !== (arm === 'treatment' ? 1 : 0)) {
          status = 'invalid'
          throw new Error('wire exposure mismatch')
        }
        wireFirstRequestHash = hash({
          ...wire,
          messages: wire.messages.filter((m) => !guidance.includes(m)),
        })
      }
      try {
        const previous = JSON.parse(readFileSync(ledgerPath, 'utf8'))
        const next = reserve(previous, init.body, model, `${taskId}:${arm}`)
        writeFileSync(ledgerPath + '.next', JSON.stringify(next), { mode: 0o600 })
        renameSync(ledgerPath + '.next', ledgerPath)
        currentInput = next.input - previous.input
        inputUnits += currentInput
        requests++
      } catch {
        status = 'budget'
        throw new Error('pilot admission failed')
      }
      await checkpoint()
      if (!live) {
        if (fault === 'rate-limit') return new Response('{}', { status: 429 })
        if (fault === 'hang') return await new Promise(() => {})
        return response(script.shift(), requests)
      }
      try {
        const remaining = Number(deadlineText) - Date.now() - 1000
        if (remaining <= 0) throw new Error('deadline')
        return await nativeFetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any(
            [init.signal, AbortSignal.timeout(Math.min(15000, remaining))].filter(Boolean),
          ),
        })
      } catch {
        status = 'infrastructure'
        throw new Error('pilot transport failed')
      }
    }
  : deny
if (!live) net.Socket.prototype.connect = deny
tls.connect = live
  ? (options, ...args) => {
      if (options?.host !== 'api.deepseek.com' || Number(options.port) !== 443) return deny()
      return nativeTlsConnect(options, ...args)
    }
  : deny
http.request = deny
https.request = deny
syncBuiltinESMExports()
const { boot, loadProfile, composeEntries } = await import('@deepseek-ai/dsh-app-boot')
const { LlmAdapter } = await import('@deepseek-ai/dsh-llm')
const { defineTool } = await import('@deepseek-ai/dsh-tools')
const { SessionId } = await import('@deepseek-ai/dsh-session')
const evolverUrl = new URL('../../lib/index.js', import.meta.url)
const { EvolutionStore, EvolutionService, DeterministicSafetyVerifier } = await import(
  evolverUrl.href
)
const task = taskById(taskId)
const world = createWorld(task)
const initialStateHash = hash({ task, state: world.snapshot() })
const seedDir = join(pairRoot, 'seed')
// Prepare one training-only accepted journal, then copy it byte-for-byte into each arm.
// This is synthetic service-level seeding, not a claim of model-generated training evidence.
if (!existsSync(join(seedDir, 'audit-v1.jsonl'))) {
  const training = TASKS.find((item) => item.split === 'development' && item.family === task.family)
  const trainingWorld = createWorld(training)
  let summary
  try {
    trainingWorld.execute(scriptFor(training, 'solve')[0][0])
  } catch (error) {
    summary = error.message
  }
  assert.ok(summary)
  const service = new EvolutionService(
    await EvolutionStore.open(seedDir),
    new DeterministicSafetyVerifier(),
    256,
  )
  const proposal = await service.observeToolFailure({
    sessionId: 'benchmark-training',
    toolName: 'bench_apply',
    errorCode: 'TOOL_FAILURE',
    summary,
  })
  await service.accept(proposal.id)
  await service.dispose()
}
const seedText = await readFile(join(seedDir, 'audit-v1.jsonl'), 'utf8')
const dataDir = join(process.env.DSH_HOME, 'evolver')
await cp(seedDir, dataDir, { recursive: true })
const control = new EvolutionService(
  await EvolutionStore.open(dataDir),
  new DeterministicSafetyVerifier(),
  256,
)
const [proposal] = control.listProposals()
assert.equal(proposal.status, 'accepted')
if (arm === 'treatment') await control.promote(proposal.id)
await control.dispose()
const anchor = join(harness, 'apps/cli/package.json')
const profile = loadProfile('evolver-benchmark', 'headless', anchor, process.env.DSH_HOME, {
  userLayer: false,
})
const patches = profile.layers.flatMap((layer) => layer.patches)
const entries = composeEntries([patches])
const disabled = new Set(ISOLATED_ENTRIES)
if (transport) disabled.delete('llm-deepseek')
for (const entry of entries) if (entry.id?.startsWith('tool-')) disabled.add(entry.id)
const overlays = [...disabled]
  .filter((id) => entries.some((entry) => entry.id === id))
  .map((id) => ({ id, disabled: true }))
overlays.push(
  {
    id: 'agent-default-model',
    config: {
      provider: transport ? 'deepseek-official' : 'benchmark-script',
      model: transport ? model : 'offline-v1',
    },
  },
  { id: 'tools', config: { mode: 'native' } },
  { insert: [{ id: 'dsh-evolver', name: evolverUrl.href, config: { dataDir } }] },
)
if (transport)
  overlays.push({
    id: 'llm-deepseek',
    config: {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com',
      thinking: 'disabled',
      reasoningEffort: 'off',
      maxTokens: 512,
      streamIdleTimeoutMs: 15000,
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    },
  })
const configFile = join(profile.dir, 'cordis.yml')
await writeFile(configFile, '[]\n')
let requests = 0
let inputUnits = 0
let outputUnits = 0
let status = 'completed'
let firstRequestHash
let wireFirstRequestHash
let currentInput = 0
const usage = { input: 0, output: 0, reports: 0 }
let exposureSeen = false
let sessionId
let validationCompleted = false
const script = scriptFor(task, behavior)
const started = performance.now()
let ctx
let fixture
let complete
const completed = new Promise((resolve) => {
  complete = resolve
})

async function inspectRequest(options) {
  if (status !== 'completed') throw new Error('benchmark stopped')
  sessionId = options.sessionId
  assert.deepEqual(
    options.tools.map((tool) => tool.name),
    ['bench_apply'],
  )
  assert.equal(options.maxTokens, BOUNDS.outputPerRequest)
  const visible = {
    model: options.model,
    system: options.system,
    tools: options.tools,
    messages: options.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  }
  const guidanceMessages = options.messages.filter(
    (message) => message.source?.kind === 'plugin' && message.source.plugin === 'dsh-evolver',
  )
  const leaked = JSON.stringify(visible).includes(proposal.guidance)
  if (requests === 0) {
    exposureSeen = leaked
    if (
      leaked !== (arm === 'treatment') ||
      guidanceMessages.length !== (arm === 'treatment' ? 1 : 0)
    ) {
      status = 'invalid'
      throw new Error('guidance contamination')
    }
    firstRequestHash = hash({
      ...visible,
      messages: options.messages
        .filter((message) => !guidanceMessages.includes(message))
        .map((message) => ({ role: message.role, content: message.content })),
    })
  }
  const size = Buffer.byteLength(JSON.stringify(visible)) + 256 + visible.messages.length * 32
  if (requests >= BOUNDS.requestsPerRun || (!transport && size > BOUNDS.inputPerRequest)) {
    status = 'budget'
    throw new Error('benchmark request budget')
  }
  if (!transport) {
    requests++
    inputUnits += size
  }
  await checkpoint()
}
async function checkpoint() {
  await writeFile(
    resultFile,
    JSON.stringify({
      taskId,
      arm,
      firstRequestHash,
      wireFirstRequestHash,
      initialStateHash,
      exposureSeen,
      seedHash: hash(seedText),
      guidanceHash: hash(proposal.guidance),
    }),
    { mode: 0o600 },
  )
}
class Adapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, defaultMaxTokens: BOUNDS.outputPerRequest }
  }
  async *stream(options) {
    await inspectRequest(options)
    if (behavior === 'hang') await new Promise(() => {})
    if (behavior === 'infra') {
      status = 'infrastructure'
      throw new Error('synthetic infrastructure failure')
    }
    const calls = script.shift()
    assert.ok(calls, 'script exhausted')
    const blocks = calls.length
      ? calls.map((args, i) => ({
          type: 'tool-call',
          id: `call-${requests}-${i}`,
          name: 'bench_apply',
          arguments: JSON.stringify(args),
        }))
      : [{ type: 'text', text: 'Task complete.' }]
    const outputSize = Buffer.byteLength(JSON.stringify(blocks))
    if (outputSize > BOUNDS.outputPerRequest) {
      status = 'budget'
      throw new Error('benchmark output budget')
    }
    for (const [index, block] of blocks.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      if (block.type === 'tool-call')
        yield {
          type: 'tool-call-delta',
          index,
          id: block.id,
          name: block.name,
          argumentsDelta: block.arguments,
        }
      else yield { type: 'text-delta', index, text: block.text }
      yield { type: 'block-end', index, block }
    }
    // Offline counters are byte estimates, never fabricated provider token usage.
    outputUnits += outputSize
    yield { type: 'finish', reason: { kind: calls.length ? 'tool-calls' : 'stop' } }
  }
}
try {
  ctx = await boot(
    'evolver-benchmark',
    configFile,
    [...patches, ...overlays],
    async (host) => {
      host.provide('cmdlineArgs', { get: () => [prompt(task)] })
      host.provide('appExit', (code) => {
        if (code && status === 'completed') status = 'infrastructure'
        complete()
      })
      fixture = await host.plugin({
        name: 'benchmark-fixture',
        inject: ['llm', 'tools', 'systemPrompt'],
        apply(scoped) {
          scoped.systemPrompt.section({
            name: 'benchmark',
            order: 0,
            complete: true,
            text:
              'Complete the user task using the provided tool. Report the result honestly.' +
              (behavior === 'leak' ? proposal.guidance : ''),
          })
          if (!transport) scoped.llm.registerAdapter(['benchmark-script'], new Adapter())
          else
            scoped.on(
              'llm/stream',
              async function* (options, next) {
                await inspectRequest(options)
                let reported = 0
                try {
                  for await (const chunk of next()) {
                    if (chunk.type === 'usage') {
                      const input =
                        chunk.usage.inputTokens +
                        (chunk.usage.cacheReadTokens ?? 0) +
                        (chunk.usage.cacheWriteTokens ?? 0)
                      const output = chunk.usage.outputTokens
                      assert.ok([input, output].every((v) => Number.isSafeInteger(v) && v >= 0))
                      assert.ok(input <= currentInput && output <= 512)
                      reported++
                      usage.reports++
                      usage.input += input
                      usage.output += output
                      outputUnits += output
                    }
                    if (
                      status === 'completed' &&
                      chunk.type === 'finish' &&
                      !['stop', 'tool-calls'].includes(chunk.reason.kind)
                    )
                      status = chunk.reason.kind === 'max-tokens' ? 'budget' : 'infrastructure'
                    yield chunk
                  }
                  assert.equal(reported, 1)
                } catch {
                  if (status === 'completed') status = 'infrastructure'
                  throw new Error('pilot adapter failed')
                }
              },
              { global: true },
            )
          scoped.tools.register(
            defineTool({
              name: 'bench_apply',
              description:
                'Inspect record rules/current state or commit a JSON payload to the isolated record.',
              parameters: {
                action: { type: 'string', required: true },
                payload: { type: 'string', required: true },
              },
              output: {
                schema: { type: 'string' },
                render: (value) => [{ type: 'text', text: value }],
              },
              execute(args) {
                if (status !== 'completed' || world.snapshot().calls >= BOUNDS.toolCallsPerRun) {
                  status = 'budget'
                  throw new Error('benchmark tool budget')
                }
                return world.execute(args)
              },
            }),
          )
        },
      })
    },
    pathToFileURL(dirname(anchor)).href + '/',
  )
  await completed
  await ctx.evolver.whenIdle()
  if (sessionId && status !== 'invalid') {
    const saved = await ctx.sessionPersistence.open(SessionId(sessionId), 'read')
    try {
      const events = (await saved.read()).filter((event) => event.type === 'user/message')
      assert.equal(
        JSON.stringify(events).includes(proposal.guidance),
        arm === 'treatment',
        'canonical exposure mismatch',
      )
    } finally {
      await saved.close()
    }
  }
  const audit = await readFile(join(dataDir, 'audit-v1.jsonl'), 'utf8')
  assert.equal(audit.includes(task.target), false, 'task answer entered audit')
  assert.equal(audit.includes('"payload"'), false, 'tool arguments entered audit')
  if (transport)
    assert.equal(audit.includes(process.env.DEEPSEEK_API_KEY), false, 'credential entered audit')
  await fixture.dispose()
  assert.equal(ctx.tools.get('bench_apply'), undefined)
  validationCompleted = true
} catch {
  // Privacy/canonical/disposal assertions are mandatory even after a task budget failure.
  status = 'invalid'
} finally {
  await ctx?.fiber.dispose()
}
assert.equal(networkAttempts, 0)
const state = world.snapshot()
await mkdir(dirname(resultFile), { recursive: true })
await writeFile(
  resultFile,
  JSON.stringify({
    taskId,
    arm,
    status,
    goalReached: grade(task, state),
    success: status === 'completed' && grade(task, state),
    calls: state.calls,
    failures: state.failures,
    repeatedInvalid: state.repeatedInvalid,
    requests,
    inputUnits,
    outputUnits,
    usage: transport ? usage : null,
    elapsedMs: Math.round(performance.now() - started),
    exposureSeen,
    firstRequestHash,
    wireFirstRequestHash,
    initialStateHash,
    seedHash: hash(seedText),
    guidanceHash: hash(proposal.guidance),
    networkAttempts,
    validationCompleted,
  }),
  { mode: 0o600 },
)
