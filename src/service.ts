/** Evolution service orchestration and lifecycle. @module dsh-evolver/service */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { EvolutionError } from './domain.ts'
import type {
  EvolutionProposal,
  EvolutionServiceApi,
  EvolutionVerificationProvider,
  EvaluationPolicy,
  ObservationId,
  ProposalId,
  ProposalStatus,
  ToolFailureObservation,
  ToolFailureObservationInput,
  ToolOutcome,
  ToolOutcomeId,
  ToolResultObservationInput,
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
    private readonly evaluationPolicy: EvaluationPolicy = {
      windowSize: 20,
      minimumSamples: 5,
      regressionThreshold: 0.15,
    },
  ) {}

  /** @inheritdoc */
  observeToolFailure(input: ToolFailureObservationInput): Promise<EvolutionProposal> {
    this.assertAccepting()
    return this.track(this.performObservation(input))
  }

  private async performObservation(input: ToolFailureObservationInput): Promise<EvolutionProposal> {
    const { observation, proposal, verification } = await this.createFailurePipeline(input)
    return this.store.recordPipeline(observation, proposal, verification)
  }

  /** @inheritdoc */
  observeToolResult(input: ToolResultObservationInput): Promise<EvolutionProposal | undefined> {
    this.assertAccepting()
    return this.track(this.performToolResult(input))
  }

  private async performToolResult(
    input: ToolResultObservationInput,
  ): Promise<EvolutionProposal | undefined> {
    const observedAt = new Date().toISOString()
    const sessionId = bounded(input.sessionId, 'sessionId', 256)
    const toolName = safeToken(input.toolName, 'toolName', 128)
    const outcome: ToolOutcome = Object.freeze({
      id: brandString<ToolOutcomeId>(randomUUID()),
      sessionId,
      callId: safeToken(input.callId, 'callId', 256),
      toolName,
      result: input.failed ? 'failed' : 'succeeded',
      observedAt,
    })
    if (!input.failed) return this.store.recordToolResultPipeline(outcome, this.evaluationPolicy)
    const { observation, proposal, verification } = await this.createFailurePipeline(
      {
        sessionId,
        toolName,
        errorCode: input.errorCode ?? 'TOOL_FAILURE',
        summary: input.summary ?? 'Tool failed without a bounded summary.',
      },
      observedAt,
    )
    return this.store.recordToolResultPipeline(outcome, this.evaluationPolicy, {
      observation,
      proposal,
      verification,
    })
  }

  private async createFailurePipeline(
    input: ToolFailureObservationInput,
    observedAt = new Date().toISOString(),
  ): Promise<{
    readonly observation: ToolFailureObservation
    readonly proposal: EvolutionProposal
    readonly verification: VerificationOutcome
  }> {
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
    const verification = this.normalizeVerification(await this.verifier.verify(proposal))
    return { observation, proposal, verification }
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
    return this.track(this.store.promote(id, this.evaluationPolicy))
  }

  /** @inheritdoc */
  supersede(id: ProposalId, reason: string): Promise<EvolutionProposal> {
    this.assertAccepting()
    return this.track(
      this.store.supersede(id, bounded(reason, 'supersede reason', this.maxEvidenceChars)),
    )
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
  recordExposure(sessionId: string, proposalIds: readonly ProposalId[]): Promise<void> {
    this.assertAccepting()
    if (proposalIds.length === 0) return Promise.resolve()
    return this.track(this.store.recordExposure(bounded(sessionId, 'sessionId', 256), proposalIds))
  }

  /** @inheritdoc */
  getEvaluation(id: ProposalId) {
    return this.store.snapshot().evaluations.get(id)
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
