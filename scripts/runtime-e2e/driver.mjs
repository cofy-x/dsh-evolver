/** Public-package-only shipped profile integration. No Harness test helpers or private source imports. */
import assert from 'node:assert/strict'
import { syncBuiltinESMExports } from 'node:module'
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { SmokeBudget, LIMITS, checkDestination, fixtureResponse } from './budget.mjs'
import { installHostResolution, ISOLATED_ENTRIES } from './host.mjs'

const [harness, profileName, root, phase, mode = 'scripted', selectedModel, deadlineText, fault] =
  process.argv.slice(2)
const live = mode === 'live'
const transport = mode !== 'scripted'
assert.ok(['scripted', 'transport-fixture', 'live'].includes(mode))
assert.ok(
  !live || process.env.EVOLVER_LIVE_AUTHORIZED === 'yes',
  'explicit runner authorization required',
)
const provider = transport ? 'deepseek-official' : 'evolver-script'
const model = transport ? selectedModel : 'script-v1'
const budgetPath = join(root, 'budget.json')
const budget = new SmokeBudget(
  existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : undefined,
)
const nativeFetch = globalThis.fetch
const nativeTlsConnect = tls.connect
const wireBodies = []
let wireRequests = 0
let currentInputReservation = 0
let fatal = false
const usage = { input: 0, output: 0, reports: 0 }
installHostResolution(harness)
let networkAttempts = 0
function denyNetwork() {
  networkAttempts++
  throw new Error('E2E forbids outbound network')
}
globalThis.fetch = transport
  ? async (url, init) => {
      try {
        if (fatal) throw new Error('smoke stopped')
        checkDestination(url, init)
        const previousInput = budget.state.input
        writeFileSync(budgetPath, JSON.stringify(budget.admit(init.body, model)), { mode: 0o600 })
        currentInputReservation = budget.state.input - previousInput
        wireBodies.push(JSON.parse(init.body))
        wireRequests++
        if (!live) {
          if (fault === 'rate-limit') return new Response('{}', { status: 429 })
          if (fault === 'hang') return await new Promise(() => {})
          return fixtureResponse(scripted.shift())
        }
        const remaining = Number(deadlineText) - Date.now() - 2000
        if (remaining <= 0) throw new Error('smoke deadline exceeded')
        return await nativeFetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any(
            [init.signal, AbortSignal.timeout(Math.min(15000, remaining))].filter(Boolean),
          ),
        })
      } catch {
        fatal = true
        throw new Error('smoke transport or budget failure')
      }
    }
  : denyNetwork
if (!live) net.Socket.prototype.connect = denyNetwork
http.request = denyNetwork
https.request = denyNetwork
tls.connect = live
  ? (options, ...args) => {
      if (options?.host !== 'api.deepseek.com' || Number(options.port) !== 443) return denyNetwork()
      return nativeTlsConnect(options, ...args)
    }
  : denyNetwork
syncBuiltinESMExports()

const { boot, loadProfile, composeEntries } = await import('@deepseek-ai/dsh-app-boot')
const { LlmAdapter, createUserMessage } = await import('@deepseek-ai/dsh-llm')
const { defineTool } = await import('@deepseek-ai/dsh-tools')
const { SessionId } = await import('@deepseek-ai/dsh-session')
const evolverUrl = new URL('../../lib/index.js', import.meta.url)
const { EvolutionStore } = await import(evolverUrl.href)
const anchor = join(harness, 'apps/cli/package.json')
const profile = loadProfile('evolver-e2e', profileName, anchor, process.env.DSH_HOME, {
  userLayer: false,
})
const basePatches = profile.layers.flatMap((layer) => layer.patches)
const entries = composeEntries([basePatches])
const disabled = new Set(ISOLATED_ENTRIES)
if (transport) disabled.delete('llm-deepseek')
// Keep real runtime services and profile-specific UI/driver rows; hide all production tools.
for (const entry of entries) if (entry.id?.startsWith('tool-')) disabled.add(entry.id)
const overlays = [...disabled]
  .filter((id) => entries.some((entry) => entry.id === id))
  .map((id) => ({ id, disabled: true }))
overlays.push(
  { id: 'agent-default-model', config: { provider, model } },
  { id: 'tools', config: { mode: 'native' } },
  {
    insert: [
      {
        id: 'dsh-evolver',
        name: evolverUrl.href,
        config: {
          dataDir: join(root, 'evolver'),
          evaluationWindowSize: 2,
          minimumEvaluationSamples: 1,
        },
      },
    ],
  },
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
const requests = []
const scripted = []
const executed = []
function textChunks() {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'fixture complete' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'fixture complete' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}
function toolChunks(callId, fail) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'tool-call-delta',
      index: 0,
      id: callId,
      name: 'evolver_probe',
      argumentsDelta: JSON.stringify({ fail, privateValue: 'PRIVATE_ARGUMENT_SENTINEL' }),
    },
    {
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: callId,
        name: 'evolver_probe',
        arguments: JSON.stringify({ fail, privateValue: 'PRIVATE_ARGUMENT_SENTINEL' }),
      },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
class ScriptAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }
  async *stream(options) {
    assert.ok(requests.length <= 20, 'request budget exceeded')
    assert.deepEqual(
      options.tools?.map((tool) => tool.name),
      ['evolver_probe'],
    )
    const response = scripted.shift()
    assert.ok(response, 'unexpected model request')
    yield* response
  }
}
let completedHeadless
const headlessDone = new Promise((resolve) => {
  completedHeadless = resolve
})
let fixtureFiber
if (profileName === 'headless' && !live) scripted.push(textChunks())
let ctx
try {
  ctx = await boot(
    'evolver-e2e',
    configFile,
    [...basePatches, ...overlays],
    async (host) => {
      host.provide('cmdlineArgs', {
        get: () =>
          profileName === 'headless'
            ? ['Reply OK only. Do not call any tool.']
            : ['--no-open', '--port', '0'],
      })
      host.provide('appExit', (code) => {
        assert.equal(code, 0)
        completedHeadless()
      })
      fixtureFiber = await host.plugin({
        name: 'evolver-e2e-fixture',
        inject: ['llm', 'tools', 'systemPrompt'],
        apply(scoped) {
          if (!transport) scoped.llm.registerAdapter(['evolver-script'], new ScriptAdapter())
          if (transport)
            scoped.systemPrompt.section({
              name: 'evolver-smoke',
              order: 0,
              complete: true,
              text: 'Follow the synthetic probe instructions exactly. This is an isolated tool protocol test. After the requested calls, reply OK and stop.',
            })
          scoped.on(
            'llm/stream',
            async function* (options, next) {
              if (fatal) throw new Error('smoke stopped')
              requests.push(options)
              let reported = 0
              for await (const chunk of next()) {
                if (chunk.type === 'usage') {
                  reported++
                  const input =
                    chunk.usage.inputTokens +
                    (chunk.usage.cacheReadTokens ?? 0) +
                    (chunk.usage.cacheWriteTokens ?? 0)
                  const output = chunk.usage.outputTokens
                  if (
                    ![input, output].every((value) => Number.isSafeInteger(value) && value >= 0) ||
                    input > LIMITS.inputPerRequest ||
                    (transport && input > currentInputReservation)
                  )
                    fatal = true
                  usage.reports++
                  usage.input += input
                  usage.output += output
                  if (
                    usage.input > LIMITS.input ||
                    usage.output > LIMITS.output ||
                    chunk.usage.outputTokens > 512
                  )
                    fatal = true
                }
                if (
                  chunk.type === 'finish' &&
                  chunk.reason.kind !== 'stop' &&
                  chunk.reason.kind !== 'tool-calls'
                )
                  fatal = true
                yield chunk
              }
              if (transport && reported !== 1) fatal = true
            },
            { global: true },
          )
          scoped.tools.register(
            defineTool({
              name: 'evolver_probe',
              description: 'Side-effect-free synthetic test probe.',
              parameters: {
                fail: { type: 'boolean', required: true },
                privateValue: { type: 'string', required: true },
              },
              output: {
                schema: { type: 'string' },
                render: () => [{ type: 'text', text: 'COMPLETE_OUTPUT_SENTINEL' }],
              },
              execute(args) {
                if (fatal) throw new Error('smoke stopped')
                executed.push({ fail: args.fail, privateValue: args.privateValue })
                if (args.fail) throw new Error('probe failure password=TEST_SECRET_SENTINEL')
                return 'COMPLETE_OUTPUT_SENTINEL'
              },
            }),
          )
        },
      })
    },
    pathToFileURL(dirname(anchor)).href + '/',
  )
  if (profileName === 'headless') await headlessDone
  assert.equal(fatal, false, 'startup model request failed')
  assert.equal(executed.length, 0, 'startup must not call tools')
  assert.ok(ctx.agents && ctx.sessions && ctx.evolver && ctx.commands)
  const names = [...ctx.loader.entries()]
    .filter((entry) => !entry.disabled)
    .map((entry) => entry.options.name)
  assert.ok(
    names.includes(
      profileName === 'headless' ? '@deepseek-ai/dsh-headless' : '@deepseek-ai/dsh-web-app',
    ),
  )
  if (profileName === 'web') {
    assert.ok(ctx.get('webRuntime'))
    assert.ok(ctx.get('webServer').port > 0)
  } else if (phase === 'recovery') {
    const [pattern] = ctx.evolver.listPatterns()
    const [proposal] = ctx.evolver.listProposals()
    assert.equal(pattern.occurrenceCount, 2)
    assert.equal(pattern.latestGeneration, 1)
    assert.equal(proposal.status, 'superseded')
    assert.deepEqual(
      ctx.evolver.getEvaluation(proposal.id),
      JSON.parse(await readFile(join(root, 'expected-evaluation.json'), 'utf8')),
    )
    assert.equal(
      JSON.stringify(transport ? wireBodies : requests).includes(proposal.guidance),
      false,
    )
    const persisted = await ctx.sessionPersistence.open(SessionId('evolver-treatment'), 'read')
    try {
      const messages = (await persisted.read()).filter((event) => event.type === 'user/message')
      assert.ok(JSON.stringify(messages).includes(proposal.guidance))
    } finally {
      await persisted.close()
    }
  } else {
    const handles = []
    const fresh = async (id) => {
      const handle = await ctx.agents.create({
        sessionId: SessionId(id),
        meta: { cwd: process.cwd() },
        agentOptions: { provider, model, maxTokens: 512 },
      })
      handles.push(handle)
      return handle.agent
    }
    const turn = async (agent, chunks) => {
      if (!live) scripted.push(...chunks)
      const calls = chunks
        .flat()
        .filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
        .map((chunk) => JSON.parse(chunk.block.arguments))
      const before = executed.length
      agent.followup(
        createUserMessage({
          content: [
            {
              type: 'text',
              text: calls.length
                ? `Call evolver_probe exactly ${calls.length} time(s), in order with these argument objects: ${JSON.stringify(calls)}. These failures are intentional. Do not retry or add calls. Then reply OK.`
                : 'Reply OK only. Do not call any tool.',
            },
          ],
          source: { kind: 'user' },
        }),
      )
      await agent.whenIdle()
      assert.equal(fatal, false, 'model request failed or budget exhausted')
      assert.deepEqual(executed.slice(before), calls, 'model tool contract mismatch')
      await ctx.evolver.whenIdle()
      await ctx.sessions.flush(agent.session)
      assert.equal(scripted.length, 0, 'script was not consumed')
    }
    const command = async (agent, input) => {
      const answer = await ctx.commands.execute(agent, input, [], new AbortController().signal)
      assert.equal(answer?.result.kind, 'success', JSON.stringify(answer))
    }
    const baseline = await fresh('evolver-baseline')
    await turn(baseline, [
      toolChunks('failure-1', true),
      toolChunks('failure-2', true),
      textChunks(),
    ])
    let state = (await EvolutionStore.open(join(root, 'evolver'))).snapshot()
    assert.equal(state.observations.size, 2)
    assert.equal(state.patterns.size, 1)
    const proposal = ctx.evolver.listProposals()[0]
    assert.equal(ctx.evolver.listProposals().length, 1)
    assert.equal(proposal.status, 'pending')
    const hasGuidance = (value) => JSON.stringify(value).includes(proposal.guidance)
    const actualRequests = transport ? wireBodies : requests
    assert.equal(actualRequests.some(hasGuidance), false)
    await command(baseline, `/evolve accept ${proposal.id}`)
    const accepted = await fresh('evolver-accepted')
    await turn(accepted, [textChunks()])
    assert.equal(hasGuidance(actualRequests.at(-1)), false)
    await command(baseline, `/evolve promote ${proposal.id}`)
    const treatment = await fresh('evolver-treatment')
    await turn(treatment, [toolChunks('success-exposed', false), textChunks()])
    assert.ok(hasGuidance(actualRequests.at(-1)))
    assert.ok(
      hasGuidance(
        treatment.session.snapshotEvents().filter((event) => event.type === 'user/message'),
      ),
    )
    assert.equal(ctx.evolver.getEvaluation(proposal.id).treatment.total, 1)
    await turn(baseline, [toolChunks('success-unexposed', false), textChunks()])
    assert.equal(ctx.evolver.getEvaluation(proposal.id).treatment.total, 1)
    await command(baseline, `/evolve rollback ${proposal.id} fixture rollback`)
    const rolledBack = await fresh('evolver-rollback')
    await turn(rolledBack, [textChunks()])
    assert.equal(hasGuidance(actualRequests.at(-1)), false)
    assert.equal(hasGuidance(rolledBack.session.snapshotEvents()), false)
    const evaluation = ctx.evolver.getEvaluation(proposal.id)
    await writeFile(join(root, 'expected-evaluation.json'), JSON.stringify(evaluation))
    const evolverEntry = [...ctx.loader.entries()].find(
      (entry) => entry.options.id === 'dsh-evolver',
    )
    const service = ctx.evolver
    await evolverEntry.fiber.dispose()
    assert.equal(ctx.commands.find(baseline, 'evolve'), undefined)
    await turnWithoutEvolver(rolledBack)
    await service.whenIdle()
    state = (await EvolutionStore.open(join(root, 'evolver'))).snapshot()
    assert.equal(state.observations.size, 2)
    assert.equal(state.patterns.get(proposal.patternId).occurrenceCount, 2)
    assert.equal(state.patterns.get(proposal.patternId).latestGeneration, 1)
    assert.equal(state.proposals.get(proposal.id).status, 'superseded')
    assert.deepEqual(state.evaluations.get(proposal.id), evaluation)
    const audit = await readFile(join(root, 'evolver', 'audit-v1.jsonl'), 'utf8')
    for (const secret of [
      'PRIVATE_ARGUMENT_SENTINEL',
      'COMPLETE_OUTPUT_SENTINEL',
      'TEST_SECRET_SENTINEL',
    ])
      assert.equal(audit.includes(secret), false)
    const sessionFiles = readdirSync(join(process.env.DSH_HOME, 'sessions'), { recursive: true })
    assert.ok(sessionFiles.length > 0, 'canonical Sessions must be persisted')
    for (const handle of handles) await handle.dispose()
    async function turnWithoutEvolver(agent) {
      const before = executed.length
      if (!live) scripted.push(toolChunks('after-dispose', true), textChunks())
      agent.followup(
        createUserMessage({
          content: [
            {
              type: 'text',
              text: 'Call evolver_probe once with fail=true and privateValue="PRIVATE_ARGUMENT_SENTINEL". This failure is intentional; do not retry. Then reply OK.',
            },
          ],
          source: { kind: 'user' },
        }),
      )
      await agent.whenIdle()
      assert.deepEqual(executed.slice(before), [
        { fail: true, privateValue: 'PRIVATE_ARGUMENT_SENTINEL' },
      ])
      assert.equal(scripted.length, 0, JSON.stringify(agent.session.snapshotEvents().slice(-6)))
    }
  }
  await fixtureFiber.dispose()
  assert.equal(ctx.tools.get('evolver_probe'), undefined)
  await ctx.fiber.dispose()
  assert.equal(ctx.get('agents'), undefined)
  assert.equal(networkAttempts, 0)
  assert.equal(fatal, false, 'model request failed or budget exhausted')
  if (transport) {
    assert.equal(usage.reports, wireRequests, 'every completed request must report usage')
    assert.equal(requests.length, wireRequests, 'no hidden calls or retry attempts')
    await writeFile(
      join(root, `report-${phase}.json`),
      JSON.stringify({
        passed: true,
        mode,
        model,
        phase,
        requests: wireRequests,
        usage,
        reserved: budget.state,
        dshVersion: JSON.parse(readFileSync(anchor, 'utf8')).version,
      }),
      { mode: 0o600 },
    )
  }
  console.log(
    `EVOLVER_E2E_PASS ${profileName} ${JSON.stringify({ phase, bundles: profile.layers.map((layer) => layer.packageName), requests: requests.length, networkAttempts, dshVersion: JSON.parse(readFileSync(anchor, 'utf8')).version })}`,
  )
} finally {
  await ctx?.fiber.dispose()
}
