import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as EvolverPlugin from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function mount(): Promise<{
  ctx: Context
  root: string
  agent: Agent
  injected: UserMessage[]
  fiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-plugin-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const fiber = await ctx.plugin(EvolverPlugin, {
    dataDir: root,
    evaluationWindowSize: 2,
    minimumEvaluationSamples: 1,
    regressionThreshold: 0.5,
  })
  const session = ctx.sessions.create(SessionId('evolver-test-session'))
  const injected: UserMessage[] = []
  const agent = {
    id: session.id,
    session,
    inject(message: UserMessage) {
      injected.push(message)
    },
  } as unknown as Agent
  return { ctx, root, agent, injected, fiber }
}

function failedExecution(
  agent: Agent,
  callId = 'call-1',
): {
  exec: ToolExecution
  result: ToolExecutionResult
} {
  return {
    exec: {
      callId,
      rootCallId: callId,
      token: Symbol('tool'),
      name: 'bash',
      arguments: { command: 'private input is not persisted' },
      agent,
      signal: new AbortController().signal,
    } as unknown as ToolExecution,
    result: {
      isError: true,
      error: {
        message: 'api_key=top-secret command failed',
        info: { name: 'Error', code: 'EXIT_1' },
      },
      content: [{ type: 'text', text: 'complete private output is ignored' }],
    },
  }
}

function successfulExecution(agent: Agent): {
  exec: ToolExecution
  result: ToolExecutionResult
} {
  return {
    exec: {
      callId: 'call-2',
      rootCallId: 'call-2',
      token: Symbol('tool'),
      name: 'bash',
      arguments: { command: 'ignored' },
      agent,
      signal: new AbortController().signal,
    } as unknown as ToolExecution,
    result: { isError: false, value: null, content: [{ type: 'text', text: 'ignored' }] },
  }
}

describe('dsh-evolver plugin', () => {
  it('does not record exposure when synchronous injection fails', async () => {
    const { ctx, root, agent } = await mount()
    const { exec, result } = failedExecution(agent)
    ctx.emit('tools/result', exec, result)
    await ctx.evolver.whenIdle()
    const proposal = ctx.evolver.listProposals()[0]
    if (proposal === undefined) throw new Error('expected proposal')
    await ctx.evolver.accept(proposal.id)
    await ctx.evolver.promote(proposal.id)
    const inject = vi.spyOn(agent, 'inject').mockImplementation(() => {
      throw new Error('inbox unavailable')
    })
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
    expect(inject).toHaveBeenCalledOnce()
    await ctx.evolver.whenIdle()
    expect(await readFile(join(root, 'audit-v1.jsonl'), 'utf8')).not.toContain('strategies-exposed')
  })

  it('reports exposure write failure without counting unrecorded treatment', async () => {
    const { ctx, agent, injected } = await mount()
    const { exec, result } = failedExecution(agent)
    ctx.emit('tools/result', exec, result)
    await ctx.evolver.whenIdle()
    const proposal = ctx.evolver.listProposals()[0]
    if (proposal === undefined) throw new Error('expected proposal')
    await ctx.evolver.accept(proposal.id)
    await ctx.evolver.promote(proposal.id)
    const { EvolutionStore } = EvolverPlugin
    vi.spyOn(EvolutionStore.prototype, 'recordExposure').mockRejectedValueOnce(
      new Error('disk unavailable'),
    )
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
    await ctx.evolver.whenIdle()
    expect(injected).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    const success = successfulExecution(agent)
    ctx.emit('tools/result', success.exec, success.result)
    await ctx.evolver.whenIdle()
    expect(ctx.evolver.getEvaluation(proposal.id)?.treatment.total).toBe(0)
  })

  it('collects a failed tool, exposes human review, and injects only promoted guidance', async () => {
    const { ctx, root, agent, injected } = await mount()
    const { exec, result } = failedExecution(agent)
    ctx.emit('tools/result', exec, result)
    await ctx.evolver.whenIdle()

    const [proposal] = ctx.evolver.listProposals()
    expect(proposal).toBeDefined()
    if (proposal === undefined) throw new Error('expected proposal')
    expect(proposal.status).toBe('pending')
    expect(proposal.guidance).not.toContain('private input')
    if (proposal.patternId === undefined) throw new Error('expected pattern association')

    const repeated = failedExecution(agent, 'call-repeat')
    ctx.emit('tools/result', repeated.exec, repeated.result)
    await ctx.evolver.whenIdle()
    expect(ctx.evolver.listProposals()).toHaveLength(1)
    expect(ctx.evolver.getPattern(proposal.patternId)?.occurrenceCount).toBe(2)

    const patterns = await ctx.commands.execute(
      agent,
      '/evolve patterns',
      [],
      new AbortController().signal,
    )
    expect(patterns?.result.text).toContain(proposal.patternId)
    const pattern = await ctx.commands.execute(
      agent,
      `/evolve pattern ${proposal.patternId}`,
      [],
      new AbortController().signal,
    )
    expect(pattern?.result.text).toContain('Occurrences: 2')
    expect(pattern?.result.text).toContain(`Latest proposal: ${proposal.id} (pending)`)

    const audit = await readFile(join(root, 'audit-v1.jsonl'), 'utf8')
    expect(audit).not.toContain('private input is not persisted')
    expect(audit).not.toContain('complete private output is ignored')
    expect(audit).not.toContain('top-secret')
    const auditKinds = audit
      .trimEnd()
      .split('\n')
      .map((line) => (JSON.parse(line) as { kind: string }).kind)
    expect(auditKinds.filter((kind) => kind === 'tool-outcome-recorded')).toHaveLength(2)
    expect(auditKinds.filter((kind) => kind === 'observation-recorded')).toHaveLength(2)
    expect(auditKinds.filter((kind) => kind === 'failure-pattern-occurred')).toHaveLength(2)
    expect(auditKinds.filter((kind) => kind === 'proposal-created')).toHaveLength(1)

    const accepted = await ctx.commands.execute(
      agent,
      `/evolve accept ${proposal.id}`,
      [],
      new AbortController().signal,
    )
    expect(accepted?.result.kind).toBe('success')
    await ctx.commands.execute(
      agent,
      `/evolve promote ${proposal.id}`,
      [],
      new AbortController().signal,
    )

    agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
    expect(injected).toHaveLength(1)
    const expected = JSON.parse(
      await readFile(new URL('./snapshots/promoted-context.json', import.meta.url), 'utf8'),
    ) as unknown
    expect({ content: injected[0]?.content, source: injected[0]?.source }).toEqual(expected)

    const success = successfulExecution(agent)
    ctx.emit('tools/result', success.exec, success.result)
    await ctx.evolver.whenIdle()
    const evaluated = await ctx.commands.execute(
      agent,
      `/evolve evaluate ${proposal.id}`,
      [],
      new AbortController().signal,
    )
    expect(evaluated?.result).toMatchObject({ kind: 'success' })
    expect(evaluated?.result.text).toContain('Verdict: improved')

    const rolledBack = await ctx.commands.execute(
      agent,
      `/evolve rollback ${proposal.id} operator-observed-regression`,
      [],
      new AbortController().signal,
    )
    expect(rolledBack?.result.text).toContain('Status: superseded')
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'resume' })
    expect(injected).toHaveLength(1)
  })

  it('removes command and event registrations and drains writes on disposal', async () => {
    const { ctx, agent, fiber } = await mount()
    expect(ctx.commands.find(agent, 'evolve')).toBeDefined()
    const service = ctx.evolver
    await fiber.dispose()
    expect(ctx.commands.find(agent, 'evolve')).toBeUndefined()

    const warn = vi.spyOn(ctx.logger, 'warn')
    const { exec, result } = failedExecution(agent)
    ctx.emit('tools/result', exec, result)
    await service.whenIdle()
    expect(service.listProposals()).toHaveLength(0)
    expect(service.listPatterns()).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })
})
