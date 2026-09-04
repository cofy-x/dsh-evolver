/** Persistent domain contracts for auditable DSH evolution. @module dsh-evolver/domain */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identifier for one bounded observation. */
export type ObservationId = Branded<'dsh-evolver.ObservationId'>

/** Stable identifier for one proposed strategy change. */
export type ProposalId = Branded<'dsh-evolver.ProposalId'>

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
    | { readonly kind: 'proposal-promoted'; readonly proposalId: ProposalId }
  )

/** Replayed current state; callers receive detached snapshots. */
export interface EvolutionState {
  readonly observations: ReadonlyMap<ObservationId, EvolutionObservation>
  readonly proposals: ReadonlyMap<ProposalId, EvolutionProposal>
  readonly lastSeq: number
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

  /** @returns promoted strategies in stable promotion order. */
  listPromoted(): readonly EvolutionProposal[]

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
