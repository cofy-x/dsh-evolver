/** Evolution service orchestration and lifecycle. @module dsh-evolver/service */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { EvolutionError } from './domain.ts'
import type {
  EvolutionProposal,
  EvolutionServiceApi,
  EvolutionVerificationProvider,
  ObservationId,
  ProposalId,
  ProposalStatus,
  ToolFailureObservation,
  ToolFailureObservationInput,
  VerificationOutcome,
} from './domain.ts'
import { proposeToolFailureStrategy } from './proposer.ts'
import type { EvolutionStore } from './store.ts'

function bounded(value: string, field: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length === 0) {
    throw new EvolutionError(`${field} must be non-blank`, 'INVALID_INPUT')
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`
}

function safeToken(value: string, field: string, maxChars: number): string {
  const normalized = bounded(value, field, maxChars)
  if (!/^[A-Za-z0-9_.:/-]+$/u.test(normalized)) {
    throw new EvolutionError(`${field} contains unsupported characters`, 'INVALID_INPUT')
  }
  return normalized
}

/** Remove common credential, URL, and home-path forms before evidence persistence. */
export function sanitizeEvidence(value: string, maxChars: number): string {
  const redacted = value
    .replace(/\b(?:bearer\s+)?(?:sk|token|key)[-_][A-Za-z0-9._-]{8,}\b/giu, '<redacted>')
    .replace(/\b(?:api[_-]?key|password|secret|token)\s*[=:]\s*\S+/giu, '<redacted>')
    .replace(/https?:\/\/\S+/giu, '<url>')
    .replace(/\/(?:Users|home)\/[^/\s]+/gu, '/<home>')
  return bounded(redacted, 'summary', maxChars)
}

/** Runtime implementation of the DSH evolution capability. */
export class EvolutionService implements EvolutionServiceApi {
  private accepting = true
  private readonly operations = new Set<Promise<void>>()

  constructor(
    private readonly store: EvolutionStore,
    private readonly verifier: EvolutionVerificationProvider,
    private readonly maxEvidenceChars: number,
  ) {}

  /** @inheritdoc */
  observeToolFailure(input: ToolFailureObservationInput): Promise<EvolutionProposal> {
    this.assertAccepting()
    return this.track(this.performObservation(input))
  }

  private async performObservation(input: ToolFailureObservationInput): Promise<EvolutionProposal> {
    const observedAt = new Date().toISOString()
    const observation: ToolFailureObservation = Object.freeze({
      id: brandString<ObservationId>(randomUUID()),
      kind: 'tool-failure',
      sessionId: bounded(input.sessionId, 'sessionId', 256),
      toolName: safeToken(input.toolName, 'toolName', 128),
      errorCode: safeToken(input.errorCode, 'errorCode', 128),
      summary: sanitizeEvidence(input.summary, this.maxEvidenceChars),
      observedAt,
    })
    const proposal = Object.freeze(
      proposeToolFailureStrategy(brandString<ProposalId>(randomUUID()), observation, observedAt),
    )
    const outcome = this.normalizeVerification(await this.verifier.verify(proposal))
    return this.store.recordPipeline(observation, proposal, outcome)
  }

  /** @inheritdoc */
  listProposals(status?: ProposalStatus): readonly EvolutionProposal[] {
    const proposals = [...this.store.snapshot().proposals.values()]
      .filter((proposal) => status === undefined || proposal.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return Object.freeze(proposals)
  }

  /** @inheritdoc */
  getProposal(id: ProposalId): EvolutionProposal | undefined {
    return this.store.snapshot().proposals.get(id)
  }

  /** @inheritdoc */
  accept(id: ProposalId): Promise<EvolutionProposal> {
    this.assertAccepting()
    return this.track(this.store.accept(id))
  }

  /** @inheritdoc */
  reject(id: ProposalId, reason: string): Promise<EvolutionProposal> {
    this.assertAccepting()
    return this.track(
      this.store.reject(id, bounded(reason, 'rejection reason', this.maxEvidenceChars)),
    )
  }

  /** @inheritdoc */
  promote(id: ProposalId): Promise<EvolutionProposal> {
    this.assertAccepting()
    return this.track(this.store.promote(id))
  }

  /** @inheritdoc */
  listPromoted(): readonly EvolutionProposal[] {
    return Object.freeze(
      [...this.store.snapshot().proposals.values()]
        .filter((proposal) => proposal.status === 'promoted')
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
    )
  }

  /** @inheritdoc */
  async whenIdle(): Promise<void> {
    while (this.operations.size > 0) {
      await Promise.allSettled([...this.operations])
    }
    await this.store.whenIdle()
  }

  /** Stop admission and await every already-admitted persistence operation. */
  async dispose(): Promise<void> {
    this.accepting = false
    await this.whenIdle()
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new EvolutionError('evolution service is disposed', 'DISPOSED')
  }

  private normalizeVerification(outcome: VerificationOutcome): VerificationOutcome {
    return Object.freeze({
      decision: outcome.decision,
      verifier: safeToken(outcome.verifier, 'verification verifier', 128),
      evidence: bounded(outcome.evidence, 'verification evidence', this.maxEvidenceChars),
    })
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    const settlement = operation.then(
      () => undefined,
      () => undefined,
    )
    this.operations.add(settlement)
    void settlement.finally(() => {
      this.operations.delete(settlement)
    })
    return operation
  }
}
