/** Auditable, verifier-gated self-evolution for DeepSeek Harness. @module dsh-evolver */

export const name = 'dsh-evolver'

/** Services required before this plugin applies. */
export const inject = ['commands']

export { Config, resolveConfig } from './config.ts'
export type { Config as PluginConfig, ResolvedConfig } from './config.ts'
export {
  EvolutionError,
  failurePatternId,
  generationReservationId,
  observationId,
  proposalId,
  toolOutcomeId,
  type EvaluationPolicy,
  type EvolutionAuditEvent,
  type EvolutionEvaluation,
  type EvolutionObservation,
  type EvolutionProposal,
  type EvolutionServiceApi,
  type EvolutionState,
  type EvolutionVerificationProvider,
  type FailurePattern,
  type FailurePatternDetail,
  type FailurePatternId,
  type FailurePatternKeyVersion,
  type GenerationReservationId,
  type ObservationId,
  type ProposalId,
  type ProposalAdmissionPolicy,
  type ProposalGenerationReservation,
  type ProposalStatus,
  type ToolFailureObservation,
  type ToolFailureObservationInput,
  type ToolOutcome,
  type ToolOutcomeId,
  type ToolResultObservationInput,
  type VerificationOutcome,
} from './domain.ts'
export { evaluateEffectiveness } from './evaluation.ts'
export {
  canonicalizeFailureSummary,
  deriveFailurePatternSignature,
  FAILURE_PATTERN_KEY_VERSION,
  type FailurePatternSignature,
} from './pattern.ts'
export { DeterministicSafetyVerifier, proposeToolFailureStrategy } from './proposer.ts'
export { sanitizeEvidence, EvolutionService } from './service.ts'
export { EvolutionStore } from './store.ts'
export { apply } from './runtime.ts'
