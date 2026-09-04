/** Cordis activation and DSH event adapters. @module dsh-evolver/runtime */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import { registerEvolutionCommand } from './commands.ts'
import { resolveConfig, type Config } from './config.ts'
import type { EvolutionServiceApi } from './domain.ts'
import { DeterministicSafetyVerifier } from './proposer.ts'
import { EvolutionService } from './service.ts'
import { EvolutionStore } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Audited proposal lifecycle and promoted strategy projection. */
    evolver: EvolutionServiceApi
  }
}

/** Activate persistence, human review, signal collection, and promoted context injection. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  const store = await EvolutionStore.open(resolved.dataDir)
  const service = new EvolutionService(
    store,
    new DeterministicSafetyVerifier(),
    resolved.maxEvidenceChars,
    {
      windowSize: resolved.evaluationWindowSize,
      minimumSamples: resolved.minimumEvaluationSamples,
      regressionThreshold: resolved.regressionThreshold,
    },
    {
      reproposalAfterOccurrences: resolved.reproposalAfterOccurrences,
      generationReservationTimeoutMs: resolved.generationReservationTimeoutMs,
    },
  )
  ctx.provide('evolver', service)
  registerEvolutionCommand(ctx, service)

  ctx.on('tools/result', (exec, result) => {
    if (exec.agent === undefined) return
    void service
      .observeToolResult({
        sessionId: String(exec.agent.session.id),
        callId: exec.callId,
        toolName: exec.name,
        failed: result.isError,
        ...(result.isError
          ? {
              errorCode: result.error.info?.code ?? 'TOOL_FAILURE',
              summary: result.error.message,
            }
          : {}),
      })
      .catch((error: unknown) => {
        ctx.logger.warn(`dsh-evolver failed to persist a tool result: ${String(error)}`)
      })
  })

  ctx.on('agent/session-start', ({ agent }) => {
    const promoted = service.listPromoted().slice(-resolved.maxPromotedStrategies)
    if (promoted.length === 0) return
    void service
      .recordExposure(
        String(agent.session.id),
        promoted.map((proposal) => proposal.id),
      )
      .catch((error: unknown) => {
        ctx.logger.warn(`dsh-evolver failed to persist a strategy exposure: ${String(error)}`)
      })
    const text = [
      'Promoted evolution strategies:',
      ...promoted.map((proposal) => `- ${proposal.title}: ${proposal.guidance}`),
    ].join('\n')
    agent.inject(
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-evolver', form: 'instructions' },
      }),
    )
  })

  ctx.effect(
    () => async () => {
      await service.dispose()
    },
    'dsh-evolver: persistence operations',
  )
}
