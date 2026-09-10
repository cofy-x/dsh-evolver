/** Experiment-only Loader entry: complete public human review before the shipped runner starts. */
import assert from 'node:assert/strict'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'experience-human-review'
export const inject = ['evolver', 'agents', 'commands']
export async function apply(ctx, config) {
  if (config.arm !== 'treatment') return
  const control = await ctx.agents.create({
    sessionId: SessionId('experiment-control'),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 1024 },
  })
  try {
    assert.ok(Array.isArray(config.selectedIds) && config.selectedIds.length > 0)
    for (const id of config.selectedIds) {
      assert.ok(ctx.evolver.listProposals('accepted').some((p) => p.id === id))
      const answer = await ctx.commands.execute(
        control.agent,
        `/evolve promote ${id}`,
        [],
        new AbortController().signal,
      )
      assert.equal(answer?.result.kind, 'success')
    }
  } finally {
    await control.dispose()
  }
}
