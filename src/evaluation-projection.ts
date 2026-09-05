/** evaluation-projection responsibilities for the audited evolution store. @module dsh-evolver/evaluation-projection */

import {
  EvolutionError,
  type EvaluationPolicy,
  type EvolutionEvaluation,
  type EvolutionProposal,
  type ProposalId,
  type ToolOutcome,
} from './domain.ts'
import type { MutableState } from './audit-state.ts'
import { evaluateEffectiveness } from './evaluation.ts'
export function updateEvaluations(state: MutableState, outcome: ToolOutcome, at: string): void {
  const exposed = state.exposures.get(outcome.sessionId)
  if (exposed === undefined) return
  for (const id of exposed) {
    const evaluation = state.evaluations.get(id)
    const proposal = state.proposals.get(id)
    if (
      evaluation === undefined ||
      proposal?.status !== 'promoted' ||
      evaluation.targetTool !== outcome.toolName ||
      evaluation.treatment.total >= evaluation.windowSize
    ) {
      continue
    }
    state.evaluations.set(
      id,
      Object.freeze(
        evaluateEffectiveness({
          ...evaluation,
          treatment: {
            total: evaluation.treatment.total + 1,
            failed: evaluation.treatment.failed + (outcome.result === 'failed' ? 1 : 0),
          },
          updatedAt: at,
        }),
      ),
    )
  }
}

export function createPromotionEvaluation(
  state: MutableState,
  id: ProposalId,
  policy: EvaluationPolicy,
  at: string,
): EvolutionEvaluation {
  const proposal = state.proposals.get(id)
  if (proposal === undefined) {
    throw new EvolutionError('proposal is missing', 'CORRUPT_STORE')
  }
  const observation = state.observations.get(proposal.observationId)
  if (observation === undefined) {
    throw new EvolutionError('proposal observation is missing', 'CORRUPT_STORE')
  }
  const eligibleOutcomes = [...state.outcomes.values()].filter(
    (outcome) =>
      outcome.toolName === observation.toolName && isBaselineOutcome(state, proposal, outcome),
  )
  // Success sampling stops once the window fills; later failures must not evict those successes.
  const baselineOutcomes =
    proposal.patternId === undefined
      ? eligibleOutcomes.slice(-policy.windowSize)
      : eligibleOutcomes.slice(0, policy.windowSize)
  return Object.freeze(
    evaluateEffectiveness({
      proposalId: id,
      targetTool: observation.toolName,
      ...policy,
      baseline: {
        total: baselineOutcomes.length,
        failed: baselineOutcomes.filter((outcome) => outcome.result === 'failed').length,
      },
      treatment: { total: 0, failed: 0 },
      updatedAt: at,
    }),
  )
}

/** New pattern generations use audit order, including their triggering outcome immediately before the observation. */
function isBaselineOutcome(
  state: MutableState,
  proposal: EvolutionProposal,
  outcome: ToolOutcome,
): boolean {
  if (proposal.patternId === undefined) return outcome.observedAt >= proposal.createdAt
  const observationSeq = state.observationSequences.get(proposal.observationId)
  const outcomeSeq = state.outcomeSequences.get(outcome.id)
  if (observationSeq === undefined || outcomeSeq === undefined) return false
  if (outcomeSeq >= observationSeq) return true
  const observation = state.observations.get(proposal.observationId)
  return (
    outcomeSeq === observationSeq - 1 &&
    outcome.result === 'failed' &&
    outcome.sessionId === observation?.sessionId &&
    outcome.observedAt === observation.observedAt
  )
}

export function shouldSampleOutcome(
  state: MutableState,
  outcome: ToolOutcome,
  policy: EvaluationPolicy,
): boolean {
  const exposed = state.exposures.get(outcome.sessionId)
  if (
    exposed &&
    [...exposed].some((id) => {
      const evaluation = state.evaluations.get(id)
      return (
        state.proposals.get(id)?.status === 'promoted' &&
        evaluation?.targetTool === outcome.toolName &&
        evaluation.treatment.total < evaluation.windowSize
      )
    })
  ) {
    return true
  }
  return [...state.proposals.values()].some((proposal) => {
    if (proposal.status !== 'pending' && proposal.status !== 'accepted') return false
    const observation = state.observations.get(proposal.observationId)
    if (observation?.toolName !== outcome.toolName) return false
    const collected = [...state.outcomes.values()].filter(
      (candidate) =>
        candidate.toolName === outcome.toolName && isBaselineOutcome(state, proposal, candidate),
    ).length
    return collected < policy.windowSize
  })
}
