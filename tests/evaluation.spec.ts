import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateEffectiveness } from '../src/evaluation.ts'
import { DeterministicSafetyVerifier } from '../src/proposer.ts'
import { EvolutionService } from '../src/service.ts'
import { EvolutionStore } from '../src/store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('effectiveness evaluation', () => {
  it('classifies deterministic failure-rate deltas without overstating small samples', () => {
    const base = {
      proposalId: '00000000-0000-4000-8000-000000000001' as never,
      targetTool: 'bash',
      windowSize: 10,
      minimumSamples: 2,
      regressionThreshold: 0.25,
      baseline: { total: 2, failed: 1 },
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(evaluateEffectiveness({ ...base, treatment: { total: 1, failed: 0 } }).verdict).toBe(
      'insufficient',
    )
    expect(evaluateEffectiveness({ ...base, treatment: { total: 2, failed: 0 } }).verdict).toBe(
      'improved',
    )
    expect(evaluateEffectiveness({ ...base, treatment: { total: 2, failed: 1 } }).verdict).toBe(
      'neutral',
    )
    expect(evaluateEffectiveness({ ...base, treatment: { total: 2, failed: 2 } }).verdict).toBe(
      'regressed',
    )
  })

  it('persists a baseline, counts only exposed treatment, deduplicates calls, and rolls back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-evaluation-'))
    roots.push(root)
    const policy = { windowSize: 4, minimumSamples: 2, regressionThreshold: 0.25 }
    const store = await EvolutionStore.open(root)
    const service = new EvolutionService(store, new DeterministicSafetyVerifier(), 120, policy)
    await service.observeToolResult({
      sessionId: 'irrelevant-session',
      callId: 'irrelevant-1',
      toolName: 'read_file',
      failed: false,
    })
    expect(store.snapshot().outcomes.size).toBe(0)
    const proposal = await service.observeToolResult({
      sessionId: 'baseline-session',
      callId: 'baseline-1',
      toolName: 'bash',
      failed: true,
      errorCode: 'EXIT_1',
      summary: 'failed once',
    })
    await service.observeToolResult({
      sessionId: 'baseline-session',
      callId: 'baseline-2',
      toolName: 'bash',
      failed: false,
    })
    if (proposal === undefined) throw new Error('expected a failure proposal')
    await service.accept(proposal.id)
    await service.promote(proposal.id)
    expect(service.getEvaluation(proposal.id)).toMatchObject({
      baseline: { total: 2, failed: 1 },
      treatment: { total: 0, failed: 0 },
      verdict: 'insufficient',
    })

    await service.observeToolResult({
      sessionId: 'unexposed-session',
      callId: 'ignored-1',
      toolName: 'bash',
      failed: false,
    })
    expect(store.snapshot().outcomes.size).toBe(2)
    await service.recordExposure('treatment-session', [proposal.id])
    for (const callId of ['treatment-1', 'treatment-2', 'treatment-2']) {
      await service.observeToolResult({
        sessionId: 'treatment-session',
        callId,
        toolName: 'bash',
        failed: false,
      })
    }
    expect(service.getEvaluation(proposal.id)).toMatchObject({
      treatment: { total: 2, failed: 0 },
      verdict: 'improved',
      failureRateDelta: -0.5,
    })
    expect(store.snapshot().outcomes.size).toBe(4)

    const reopened = new EvolutionService(
      await EvolutionStore.open(root),
      new DeterministicSafetyVerifier(),
      120,
      policy,
    )
    expect(reopened.getEvaluation(proposal.id)?.verdict).toBe('improved')
    expect((await reopened.supersede(proposal.id, 'operator rollback')).status).toBe('superseded')
    expect(reopened.listPromoted()).toHaveLength(0)
    expect((await reopened.supersede(proposal.id, 'operator rollback')).status).toBe('superseded')

    const filename = join(root, 'audit-v1.jsonl')
    const secondVersion = (await readFile(filename, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter(
        (event) =>
          ![
            'failure-pattern-created',
            'failure-pattern-occurred',
            'proposal-generation-reserved',
            'proposal-generation-abandoned',
          ].includes(String(event.kind)),
      )
      .map((event) => {
        if (event.kind !== 'proposal-created') return event
        const legacyProposal = { ...(event.proposal as Record<string, unknown>) }
        Reflect.deleteProperty(legacyProposal, 'patternId')
        Reflect.deleteProperty(legacyProposal, 'patternOccurrence')
        Reflect.deleteProperty(legacyProposal, 'generation')
        return { ...event, proposal: legacyProposal }
      })
      .map((event, seq) => ({ ...event, seq }))
    await writeFile(filename, `${secondVersion.map((event) => JSON.stringify(event)).join('\n')}\n`)
    const legacyV2 = await EvolutionStore.open(root)
    expect(legacyV2.snapshot().patterns.size).toBe(0)
    expect(legacyV2.snapshot().evaluations.get(proposal.id)?.verdict).toBe('improved')
    expect(legacyV2.snapshot().proposals.get(proposal.id)?.status).toBe('superseded')
  })

  it('isolates evaluation cohorts across generations of the same pattern', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-generation-evaluation-'))
    roots.push(root)
    const service = new EvolutionService(
      await EvolutionStore.open(root),
      new DeterministicSafetyVerifier(),
      120,
      { windowSize: 2, minimumSamples: 1, regressionThreshold: 0.25 },
      { reproposalAfterOccurrences: 1, generationReservationTimeoutMs: 60_000 },
    )
    const first = await service.observeToolResult({
      sessionId: 'generation-baseline-1',
      callId: 'generation-failure-1',
      toolName: 'bash',
      failed: true,
      errorCode: 'EXIT_1',
      summary: 'generation item 1 failed',
    })
    if (first === undefined) throw new Error('expected generation 1')
    await service.accept(first.id)
    await service.promote(first.id)
    await service.recordExposure('generation-treatment-1', [first.id])
    await service.observeToolResult({
      sessionId: 'generation-treatment-1',
      callId: 'generation-success-1',
      toolName: 'bash',
      failed: false,
    })
    expect(service.getEvaluation(first.id)).toMatchObject({
      treatment: { total: 1, failed: 0 },
      verdict: 'improved',
    })
    await service.supersede(first.id, 'generation complete')

    const second = await service.observeToolResult({
      sessionId: 'generation-baseline-2',
      callId: 'generation-failure-2',
      toolName: 'bash',
      failed: true,
      errorCode: 'EXIT_1',
      summary: 'generation item 2 failed',
    })
    if (second === undefined) throw new Error('expected generation 2')
    expect(second).toMatchObject({ patternId: first.patternId, generation: 2 })
    await service.accept(second.id)
    await service.promote(second.id)
    await service.recordExposure('generation-treatment-2', [second.id])
    await service.observeToolResult({
      sessionId: 'generation-treatment-2',
      callId: 'generation-success-2',
      toolName: 'bash',
      failed: false,
    })

    expect(service.getEvaluation(first.id)).toMatchObject({
      treatment: { total: 1, failed: 0 },
      verdict: 'improved',
    })
    expect(service.getEvaluation(second.id)).toMatchObject({
      baseline: { total: 1, failed: 1 },
      treatment: { total: 1, failed: 0 },
      verdict: 'improved',
    })
  })
})
