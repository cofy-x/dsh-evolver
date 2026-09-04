/** Deterministic MVP proposal and verification providers. @module dsh-evolver/proposer */

import type {
  EvolutionObservation,
  EvolutionProposal,
  EvolutionVerificationProvider,
  FailurePattern,
  ProposalId,
  ProposalStatus,
  VerificationOutcome,
} from './domain.ts'

/** Aggregated admission context supplied only after a generation reservation succeeds. */
export interface AggregatedProposalContext {
  readonly pattern: FailurePattern
  readonly generation: number
  readonly occurrence: number
  readonly priorTerminalStatus?: Extract<ProposalStatus, 'rejected' | 'superseded'>
}

/** Create one bounded candidate from an admitted failure observation. */
export function proposeToolFailureStrategy(
  id: ProposalId,
  observation: EvolutionObservation,
  at: string,
  context?: AggregatedProposalContext,
): EvolutionProposal {
  const history = context?.priorTerminalStatus
    ? ` A prior generation was ${context.priorTerminalStatus}; this generation was admitted after additional occurrences.`
    : ''
  return {
    id,
    observationId: observation.id,
    ...(context
      ? {
          patternId: context.pattern.id,
          patternOccurrence: context.occurrence,
          generation: context.generation,
        }
      : {}),
    kind: 'strategy-guidance',
    title: `Diagnose recurring ${observation.toolName} failures before retrying`,
    guidance: `This exact failure pattern has been observed ${String(context?.pattern.occurrenceCount ?? 1)} time(s). When ${observation.toolName} fails with ${observation.errorCode}, inspect bounded failure evidence, identify the violated precondition, and change the next attempt instead of repeating the same call.${history}`,
    status: 'evaluating',
    createdAt: at,
    updatedAt: at,
  }
}

/** Offline verifier that enforces the MVP's immutable safety policy. */
export class DeterministicSafetyVerifier implements EvolutionVerificationProvider {
  /** @returns pass only for bounded guidance that cannot directly execute or self-modify. */
  verify(proposal: EvolutionProposal): VerificationOutcome {
    const forbidden = /\b(?:execute|shell|self-modif|approval policy|verifier)\b/iu
    if (forbidden.test(proposal.guidance)) {
      return {
        decision: 'failed',
        verifier: 'deterministic-safety-v1',
        evidence: 'Candidate is outside the strategy-guidance safety boundary.',
      }
    }
    return {
      decision: 'passed',
      verifier: 'deterministic-safety-v1',
      evidence: 'Candidate is bounded guidance with no execution or policy mutation capability.',
    }
  }
}
