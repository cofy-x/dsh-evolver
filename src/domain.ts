/** Persistent domain contracts for auditable DSH evolution. @module dsh-evolver/domain */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identifier for one bounded observation. */
export type ObservationId = Branded<'dsh-evolver.ObservationId'>

/** Stable identifier for one proposed strategy change. */
export type ProposalId = Branded<'dsh-evolver.ProposalId'>

/** Stable identifier for one metadata-only tool outcome. */
export type ToolOutcomeId = Branded<'dsh-evolver.ToolOutcomeId'>

/** Proposal lifecycle states retained for stable read projections. */
export type ProposalStatus =
  | 'evaluating'
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'promoted'
  | 'superseded'

/** A bounded fact derived from one canonical DSH event. */
export interface ToolFailureObservation {
  readonly id: ObservationId
  readonly kind: 'tool-failure'
  readonly sessionId: string
  readonly toolName: string
  readonly errorCode: string
  readonly summary: string
  readonly observedAt: string
}

/** The observation vocabulary accepted by the MVP. */
export type EvolutionObservation = ToolFailureObservation

/** Input admitted by the service after the collector removes unbounded tool data. */
export interface ToolFailureObservationInput {
  readonly sessionId: string
  readonly toolName: string
  readonly errorCode: string
  readonly summary: string
}

/** Metadata-only canonical tool result used for baseline and treatment measurements. */
export interface ToolOutcome {
  readonly id: ToolOutcomeId
  readonly sessionId: string
  readonly callId: string
  readonly toolName: string
  readonly result: 'succeeded' | 'failed'
  readonly observedAt: string
}

/** Runtime input for one final DSH tool result. */
export interface ToolResultObservationInput {
  readonly sessionId: string
  readonly callId: string
  readonly toolName: string
  readonly failed: boolean
  readonly errorCode?: string
  readonly summary?: string
}

/** Frozen experiment parameters and current deterministic effectiveness projection. */
export interface EvolutionEvaluation {
  readonly proposalId: ProposalId
  readonly targetTool: string
  readonly windowSize: number
  readonly minimumSamples: number
  readonly regressionThreshold: number
  readonly baseline: { readonly total: number; readonly failed: number }
  readonly treatment: { readonly total: number; readonly failed: number }
  readonly verdict: 'insufficient' | 'improved' | 'neutral' | 'regressed'
  readonly failureRateDelta?: number
  readonly updatedAt: string
}

/** Deterministic evidence attached before a proposal can enter human review. */
export interface VerificationOutcome {
  readonly decision: 'passed' | 'failed'
  readonly verifier: string
  readonly evidence: string
}

/** A bounded strategy candidate that cannot mutate code or policy by itself. */
export interface EvolutionProposal {
  readonly id: ProposalId
  readonly observationId: ObservationId
  readonly kind: 'strategy-guidance'
  readonly title: string
  readonly guidance: string
  readonly status: ProposalStatus
  readonly verification?: VerificationOutcome
  readonly rejectionReason?: string
  readonly supersededReason?: string
  readonly createdAt: string
  readonly updatedAt: string
}

interface AuditEnvelope {
  readonly schemaVersion: 1
  readonly seq: number
  readonly at: string
}

/** Append-only facts from which every Evolver projection is rebuilt. */
export type EvolutionAuditEvent = AuditEnvelope &
  (
    | { readonly kind: 'observation-recorded'; readonly observation: EvolutionObservation }
    | { readonly kind: 'proposal-created'; readonly proposal: EvolutionProposal }
    | {
        readonly kind: 'verification-recorded'
        readonly proposalId: ProposalId
        readonly outcome: VerificationOutcome
      }
    | { readonly kind: 'proposal-accepted'; readonly proposalId: ProposalId }
    | {
        readonly kind: 'proposal-rejected'
        readonly proposalId: ProposalId
        readonly reason: string
      }
    | {
        readonly kind: 'proposal-promoted'
        readonly proposalId: ProposalId
        readonly evaluation?: EvolutionEvaluation
      }
    | {
        readonly kind: 'proposal-superseded'
        readonly proposalId: ProposalId
        readonly reason: string
      }
    | { readonly kind: 'tool-outcome-recorded'; readonly outcome: ToolOutcome }
    | {
        readonly kind: 'strategies-exposed'
        readonly sessionId: string
        readonly proposalIds: readonly ProposalId[]
      }
  )

/** Replayed current state; callers receive detached snapshots. */
export interface EvolutionState {
  readonly observations: ReadonlyMap<ObservationId, EvolutionObservation>
  readonly proposals: ReadonlyMap<ProposalId, EvolutionProposal>
  readonly outcomes: ReadonlyMap<ToolOutcomeId, ToolOutcome>
  readonly evaluations: ReadonlyMap<ProposalId, EvolutionEvaluation>
  readonly lastSeq: number
}

/** Frozen parameters used when a promotion starts its effectiveness experiment. */
export interface EvaluationPolicy {
  readonly windowSize: number
  readonly minimumSamples: number
  readonly regressionThreshold: number
}

/** Verification provider role; providers supply evidence but cannot promote. */
export interface EvolutionVerificationProvider {
  /**
   * Evaluate one bounded candidate without mutating lifecycle state.
   * @param proposal - candidate created from one admitted observation.
   * @returns bounded evidence and a pass/fail decision.
   */
  verify(proposal: EvolutionProposal): VerificationOutcome | Promise<VerificationOutcome>
}

/** Public service exposed as `ctx.evolver`. */
export interface EvolutionServiceApi {
  /**
   * Persist one bounded tool failure and create its verified pending proposal.
   * @param input - normalized observation with no transcript or tool payload.
   * @returns the persisted proposal projection.
   */
  observeToolFailure(input: ToolFailureObservationInput): Promise<EvolutionProposal>

  /** Record one canonical result and create a proposal as part of the same commit when it failed. */
  observeToolResult(input: ToolResultObservationInput): Promise<EvolutionProposal | undefined>

  /** @returns proposals, newest first, optionally restricted by status. */
  listProposals(status?: ProposalStatus): readonly EvolutionProposal[]

  /** @param id - proposal identifier. @returns the proposal when present. */
  getProposal(id: ProposalId): EvolutionProposal | undefined

  /** @param id - verified pending proposal. @returns accepted projection. */
  accept(id: ProposalId): Promise<EvolutionProposal>

  /**
   * Reject a pending or accepted proposal.
   * @param id - proposal identifier.
   * @param reason - bounded human review reason.
   * @returns rejected projection.
   */
  reject(id: ProposalId, reason: string): Promise<EvolutionProposal>

  /** @param id - accepted proposal. @returns promoted projection. */
  promote(id: ProposalId): Promise<EvolutionProposal>

  /** Stop injecting a promoted strategy while preserving its complete history. */
  supersede(id: ProposalId, reason: string): Promise<EvolutionProposal>

  /** @returns promoted strategies in stable promotion order. */
  listPromoted(): readonly EvolutionProposal[]

  /** Persist which promoted strategies were actually injected into a Session. */
  recordExposure(sessionId: string, proposalIds: readonly ProposalId[]): Promise<void>

  /** @returns the deterministic baseline/treatment projection when promotion started one. */
  getEvaluation(id: ProposalId): EvolutionEvaluation | undefined

  /** @returns fulfillment after admitted persistence work settles. */
  whenIdle(): Promise<void>
}

/** Domain error with one stable machine-readable code. */
export class EvolutionError extends Error {
  override readonly name = 'EvolutionError'

  constructor(
    message: string,
    readonly code:
      | 'INVALID_INPUT'
      | 'INVALID_TRANSITION'
      | 'NOT_FOUND'
      | 'CORRUPT_STORE'
      | 'DISPOSED',
  ) {
    super(message)
  }
}

/** Apply compile-time branding after an identifier passed its owning parser. */
export function proposalId(value: string): ProposalId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new EvolutionError('proposal id must be a lowercase UUIDv4', 'INVALID_INPUT')
  }
  return value as ProposalId
}

/** Apply compile-time branding after an identifier passed its owning parser. */
export function observationId(value: string): ObservationId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new EvolutionError('observation id must be a lowercase UUIDv4', 'INVALID_INPUT')
  }
  return value as ObservationId
}

/** Apply compile-time branding after an identifier passed its owning parser. */
export function toolOutcomeId(value: string): ToolOutcomeId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new EvolutionError('tool outcome id must be a lowercase UUIDv4', 'INVALID_INPUT')
  }
  return value as ToolOutcomeId
}
