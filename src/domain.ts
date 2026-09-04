/** Persistent domain contracts for auditable DSH evolution. @module dsh-evolver/domain */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identifier for one bounded observation. */
export type ObservationId = Branded<'dsh-evolver.ObservationId'>

/** Stable identifier for one proposed strategy change. */
export type ProposalId = Branded<'dsh-evolver.ProposalId'>

/** Stable identifier for one metadata-only tool outcome. */
export type ToolOutcomeId = Branded<'dsh-evolver.ToolOutcomeId'>

/** Deterministic identifier for one versioned exact failure pattern. */
export type FailurePatternId = Branded<'dsh-evolver.FailurePatternId'>

/** Opaque identity for one recoverable proposal-generation reservation. */
export type GenerationReservationId = Branded<'dsh-evolver.GenerationReservationId'>

/** Pattern-key algorithm recorded with every durable pattern. */
export type FailurePatternKeyVersion = 'failure-pattern-v1'

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

/** Aggregated projection over independently persisted failure observations. */
export interface FailurePattern {
  readonly id: FailurePatternId
  readonly keyVersion: FailurePatternKeyVersion
  readonly toolName: string
  readonly errorCode: string
  readonly canonicalSummary: string
  readonly occurrenceCount: number
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly representativeObservationIds: readonly ObservationId[]
  readonly latestProposalId?: ProposalId
  readonly latestProposalOccurrence?: number
  readonly latestGeneration: number
  readonly activeProposalId?: ProposalId
}

/** Structured review projection combining a pattern with current admission state. */
export interface FailurePatternDetail {
  readonly pattern: FailurePattern
  readonly latestProposal?: EvolutionProposal
  readonly activeProposal?: EvolutionProposal
  readonly reservation?: ProposalGenerationReservation
  readonly nextProposalEligibleAtOccurrence?: number
}

/** Persisted lease proving which process may invoke a proposal provider for a generation. */
export interface ProposalGenerationReservation {
  readonly id: GenerationReservationId
  readonly patternId: FailurePatternId
  readonly proposalId: ProposalId
  readonly observationId: ObservationId
  readonly generation: number
  readonly occurrence: number
  readonly reservedAt: string
  readonly expiresAt: string
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
  readonly patternId?: FailurePatternId
  readonly patternOccurrence?: number
  readonly generation?: number
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
    | {
        readonly kind: 'failure-pattern-created'
        readonly pattern: Pick<
          FailurePattern,
          'id' | 'keyVersion' | 'toolName' | 'errorCode' | 'canonicalSummary' | 'firstSeenAt'
        >
      }
    | {
        readonly kind: 'failure-pattern-occurred'
        readonly patternId: FailurePatternId
        readonly observationId: ObservationId
        readonly occurrence: number
      }
    | {
        readonly kind: 'proposal-generation-reserved'
        readonly reservation: ProposalGenerationReservation
      }
    | {
        readonly kind: 'proposal-generation-abandoned'
        readonly reservationId: GenerationReservationId
        readonly reason: 'provider-failed' | 'expired'
      }
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
  readonly patterns: ReadonlyMap<FailurePatternId, FailurePattern>
  readonly reservations: ReadonlyMap<FailurePatternId, ProposalGenerationReservation>
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

/** Admission and crash-recovery parameters frozen by the service. */
export interface ProposalAdmissionPolicy {
  readonly reproposalAfterOccurrences: number
  readonly generationReservationTimeoutMs: number
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
   * Persist one bounded tool failure and create a verified proposal only when admission succeeds.
   * @param input - normalized observation with no transcript or tool payload.
   * @returns the persisted proposal, or undefined for an aggregated-only occurrence.
   */
  observeToolFailure(input: ToolFailureObservationInput): Promise<EvolutionProposal | undefined>

  /** Record one canonical result and create a proposal as part of the same commit when it failed. */
  observeToolResult(input: ToolResultObservationInput): Promise<EvolutionProposal | undefined>

  /** @returns proposals, newest first, optionally restricted by status. */
  listProposals(status?: ProposalStatus): readonly EvolutionProposal[]

  /** @param id - proposal identifier. @returns the proposal when present. */
  getProposal(id: ProposalId): EvolutionProposal | undefined

  /** @returns patterns ordered by latest occurrence, newest first. */
  listPatterns(): readonly FailurePattern[]

  /** @returns one exact pattern projection when present. */
  getPattern(id: FailurePatternId): FailurePattern | undefined

  /** @returns structured pattern, proposal, reservation, and reproposal eligibility state. */
  getPatternDetail(id: FailurePatternId): FailurePatternDetail | undefined

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

/** Parse one deterministic v1 failure-pattern identifier. */
export function failurePatternId(value: string): FailurePatternId {
  if (!/^fp1_[0-9a-f]{64}$/u.test(value)) {
    throw new EvolutionError(
      'failure pattern id must be fp1_ followed by 64 lowercase hex digits',
      'INVALID_INPUT',
    )
  }
  return value as FailurePatternId
}

/** Parse one reservation identifier at the persistence boundary. */
export function generationReservationId(value: string): GenerationReservationId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new EvolutionError(
      'generation reservation id must be a lowercase UUIDv4',
      'INVALID_INPUT',
    )
  }
  return value as GenerationReservationId
}
