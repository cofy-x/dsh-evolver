/** Auditable, verifier-gated self-evolution for DeepSeek Harness. @module dsh-evolver */

export const name = 'dsh-evolver'

/** Services required before this plugin applies. */
export const inject = ['commands']

export { Config, resolveConfig } from './config.ts'
export type { Config as PluginConfig, ResolvedConfig } from './config.ts'
export {
  EvolutionError,
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
  type ObservationId,
  type ProposalId,
  type ProposalStatus,
  type ToolFailureObservation,
  type ToolFailureObservationInput,
  type ToolOutcome,
  type ToolOutcomeId,
  type ToolResultObservationInput,
  type VerificationOutcome,
} from './domain.ts'
export { evaluateEffectiveness } from './evaluation.ts'
export { DeterministicSafetyVerifier, proposeToolFailureStrategy } from './proposer.ts'
export { sanitizeEvidence, EvolutionService } from './service.ts'
export { EvolutionStore } from './store.ts'
export { apply } from './runtime.ts'
