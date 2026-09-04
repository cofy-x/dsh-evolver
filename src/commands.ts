/** Human review command for proposal lifecycle operations. @module dsh-evolver/commands */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import {
  EvolutionError,
  proposalId,
  type EvolutionEvaluation,
  type EvolutionProposal,
  type EvolutionServiceApi,
  type ProposalStatus,
} from './domain.ts'

const STATUSES: readonly ProposalStatus[] = [
  'evaluating',
  'pending',
  'accepted',
  'rejected',
  'promoted',
  'superseded',
]

function lineOf(proposal: EvolutionProposal): string {
  return `${proposal.id}  ${proposal.status.padEnd(9)}  ${proposal.title}`
}

function detailOf(proposal: EvolutionProposal): string {
  const verification = proposal.verification
    ? `${proposal.verification.decision} by ${proposal.verification.verifier}: ${proposal.verification.evidence}`
    : 'not completed'
  return [
    `Proposal ${proposal.id}`,
    `Status: ${proposal.status}`,
    `Title: ${proposal.title}`,
    `Guidance: ${proposal.guidance}`,
    `Verification: ${verification}`,
    ...(proposal.rejectionReason ? [`Rejection: ${proposal.rejectionReason}`] : []),
    ...(proposal.supersededReason ? [`Rollback: ${proposal.supersededReason}`] : []),
  ].join('\n')
}

function rate(failed: number, total: number): string {
  return total === 0 ? 'n/a' : `${((failed / total) * 100).toFixed(1)}%`
}

function evaluationOf(evaluation: EvolutionEvaluation): string {
  const delta =
    evaluation.failureRateDelta === undefined
      ? 'n/a'
      : `${(evaluation.failureRateDelta * 100).toFixed(1)} percentage points`
  return [
    `Evaluation ${evaluation.proposalId}`,
    `Verdict: ${evaluation.verdict}`,
    `Target tool: ${evaluation.targetTool}`,
    `Baseline: ${String(evaluation.baseline.failed)}/${String(evaluation.baseline.total)} failed (${rate(evaluation.baseline.failed, evaluation.baseline.total)})`,
    `Treatment: ${String(evaluation.treatment.failed)}/${String(evaluation.treatment.total)} failed (${rate(evaluation.treatment.failed, evaluation.treatment.total)})`,
    `Failure-rate delta: ${delta}`,
    `Policy: minimum ${String(evaluation.minimumSamples)} samples per cohort, ${String(evaluation.windowSize)}-result window, ${(evaluation.regressionThreshold * 100).toFixed(1)}-point threshold`,
  ].join('\n')
}

async function execute(service: EvolutionServiceApi, rawInput: string): Promise<CommandResult> {
  const input = rawInput.trim()
  if (input.length === 0 || input === 'list') {
    const proposals = service.listProposals()
    return {
      kind: 'success',
      text: proposals.length === 0 ? 'No evolution proposals.' : proposals.map(lineOf).join('\n'),
    }
  }
  const [operation, idText, ...rest] = input.split(/\s+/u)
  if (operation === 'list' && idText !== undefined) {
    if (!STATUSES.includes(idText as ProposalStatus)) {
      return { kind: 'error', text: `Unknown proposal status: ${idText}` }
    }
    const proposals = service.listProposals(idText as ProposalStatus)
    return {
      kind: 'success',
      text:
        proposals.length === 0
          ? `No ${idText} evolution proposals.`
          : proposals.map(lineOf).join('\n'),
    }
  }
  if (idText === undefined) {
    return {
      kind: 'error',
      text: 'Usage: /evolve list [status] | show|accept|promote|evaluate <id> | reject|rollback <id> <reason>',
    }
  }
  try {
    const id = proposalId(idText)
    switch (operation) {
      case 'show': {
        const proposal = service.getProposal(id)
        return proposal === undefined
          ? { kind: 'error', text: `Proposal ${id} was not found.` }
          : { kind: 'success', text: detailOf(proposal) }
      }
      case 'accept':
        return { kind: 'success', text: detailOf(await service.accept(id)) }
      case 'reject':
        return { kind: 'success', text: detailOf(await service.reject(id, rest.join(' '))) }
      case 'promote':
        return { kind: 'success', text: detailOf(await service.promote(id)) }
      case 'evaluate': {
        const evaluation = service.getEvaluation(id)
        return evaluation === undefined
          ? { kind: 'error', text: `Proposal ${id} has no promotion evaluation.` }
          : { kind: 'success', text: evaluationOf(evaluation) }
      }
      case 'rollback':
        return { kind: 'success', text: detailOf(await service.supersede(id, rest.join(' '))) }
      default:
        return { kind: 'error', text: `Unknown evolve operation: ${String(operation)}` }
    }
  } catch (error: unknown) {
    if (error instanceof EvolutionError) return { kind: 'error', text: error.message }
    throw error
  }
}

/** Register the human-only `/evolve` review surface. */
export function registerEvolutionCommand(ctx: Context, service: EvolutionServiceApi): void {
  ctx.commands.register({
    name: 'evolve',
    description: 'review and promote audited evolution proposals',
    input: {
      hint: '[list [status]|show|accept|promote|evaluate <id>|reject|rollback <id> <reason>]',
    },
    handler: ({ rawInput }) => execute(service, rawInput),
  })
}
