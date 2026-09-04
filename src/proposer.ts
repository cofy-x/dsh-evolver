/** Deterministic MVP proposal and verification providers. @module dsh-evolver/proposer */

import type {
  EvolutionObservation,
  EvolutionProposal,
  EvolutionVerificationProvider,
  ProposalId,
  VerificationOutcome,
} from './domain.ts'

/** Create one bounded candidate from an admitted failure observation. */
export function proposeToolFailureStrategy(
  id: ProposalId,
  observation: EvolutionObservation,
  at: string,
): EvolutionProposal {
  return {
    id,
    observationId: observation.id,
    kind: 'strategy-guidance',
    title: `Diagnose ${observation.toolName} failures before retrying`,
    guidance: `When ${observation.toolName} fails with ${observation.errorCode}, inspect the bounded failure evidence, identify the violated precondition, and change the next attempt instead of repeating the same call.`,
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
