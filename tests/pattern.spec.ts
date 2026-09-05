import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  failurePatternId,
  type EvolutionProposal,
  type EvolutionVerificationProvider,
} from '../src/domain.ts'
import {
  canonicalizeFailureSummary,
  deriveFailurePatternSignature,
  FAILURE_PATTERN_KEY_VERSION,
} from '../src/pattern.ts'
import { DeterministicSafetyVerifier } from '../src/proposer.ts'
import { EvolutionService } from '../src/service.ts'
import { EvolutionStore } from '../src/store.ts'

const roots: string[] = []
const evaluationPolicy = { windowSize: 4, minimumSamples: 1, regressionThreshold: 0.25 }

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function required(proposal: EvolutionProposal | undefined): EvolutionProposal {
  if (proposal === undefined) throw new Error('expected an admitted proposal')
  return proposal
}

async function fixture(
  verifier: EvolutionVerificationProvider = new DeterministicSafetyVerifier(),
  reproposalAfterOccurrences = 5,
): Promise<{ root: string; store: EvolutionStore; service: EvolutionService }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-pattern-'))
  roots.push(root)
  const store = await EvolutionStore.open(root)
  return {
    root,
    store,
    service: new EvolutionService(store, verifier, 256, evaluationPolicy, {
      reproposalAfterOccurrences,
      generationReservationTimeoutMs: 60_000,
    }),
  }
}

function failure(summary: string, toolName = 'bash', errorCode = 'EXIT_1') {
  return { sessionId: 'pattern-session', toolName, errorCode, summary }
}

describe('failure-pattern-v1 signature', () => {
  it('canonicalizes instance IDs, UUIDs, URLs, home directories, credentials, case, and whitespace', () => {
    const left = canonicalizeFailureSummary(
      'Request 42 FAILED 550e8400-e29b-41d4-a716-446655440000 ABCDEF123456 at https://one.test/x /Users/alice/project <redacted>',
    )
    const right = canonicalizeFailureSummary(
      'request 99 failed 123e4567-e89b-12d3-a456-426614174000 deadbeef9876 at https://two.test/y /home/bob/project <redacted>',
    )
    expect(left).toBe(right)
    const signature = deriveFailurePatternSignature('bash', 'EXIT_1', left)
    expect(signature.keyVersion).toBe(FAILURE_PATTERN_KEY_VERSION)
    expect(signature.id).toMatch(/^fp1_[0-9a-f]{64}$/u)
    expect(() => failurePatternId(signature.id.toUpperCase())).toThrow('failure pattern id')
  })

  it('keeps tool and error-code field boundaries distinct', () => {
    const summary = 'same bounded failure'
    expect(deriveFailurePatternSignature('bash', 'EXIT_1', summary).id).not.toBe(
      deriveFailurePatternSignature('read_file', 'EXIT_1', summary).id,
    )
    expect(deriveFailurePatternSignature('bash', 'EXIT_1', summary).id).not.toBe(
      deriveFailurePatternSignature('bash', 'TIMEOUT', summary).id,
    )
  })
})

describe('proposal admission', () => {
  it('refreshes a stale runtime projection on its next transaction, not on synchronous reads', async () => {
    const { root, service } = await fixture()
    const proposal = required(await service.observeToolFailure(failure('shared runtime failed')))
    await service.accept(proposal.id)
    await service.promote(proposal.id)
    const other = new EvolutionService(
      await EvolutionStore.open(root),
      new DeterministicSafetyVerifier(),
      256,
    )
    await service.supersede(proposal.id, 'operator rollback')
    expect(other.listPromoted()).toHaveLength(1)
    await other.observeToolResult({
      sessionId: 'refresh',
      callId: 'refresh',
      toolName: 'unused',
      failed: false,
    })
    expect(other.listPromoted()).toHaveLength(0)
    await other.dispose()
  })

  it('aggregates observations whose wall-clock order differs from commit order', async () => {
    const { root, service } = await fixture()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'))
      await service.observeToolFailure(failure('out of order 1 failed'))
      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
      await service.observeToolFailure(failure('out of order 2 failed'))
      const pattern = (await EvolutionStore.open(root)).snapshot().patterns.values().next().value
      expect(pattern).toMatchObject({
        occurrenceCount: 2,
        firstSeenAt: '2026-01-01T00:00:01.000Z',
        lastSeenAt: '2026-01-01T00:00:02.000Z',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects malformed provider decisions without poisoning replay', async () => {
    const { root, service } = await fixture({
      verify: () =>
        ({ decision: 'unknown', verifier: 'bad-v1', evidence: 'invalid decision' }) as never,
    })
    await expect(
      service.observeToolFailure(failure('malformed provider failed')),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const state = (await EvolutionStore.open(root)).snapshot()
    expect(state.proposals.size).toBe(0)
    expect(state.reservations.size).toBe(0)
    expect(state.patterns.size).toBe(1)
  })

  it('aggregates matching failures and invokes proposer verification only once', async () => {
    const verify = vi.fn(
      new DeterministicSafetyVerifier().verify.bind(new DeterministicSafetyVerifier()),
    )
    const { service } = await fixture({ verify })
    const first = required(
      await service.observeToolFailure(failure('Job 100 failed at https://one.test')),
    )
    expect(
      await service.observeToolFailure(failure('job 200 FAILED at https://two.test')),
    ).toBeUndefined()

    expect(verify).toHaveBeenCalledTimes(1)
    expect(service.listProposals()).toHaveLength(1)
    expect(first).toMatchObject({ generation: 1, patternOccurrence: 1 })
    expect(service.listPatterns()).toMatchObject([
      {
        occurrenceCount: 2,
        latestGeneration: 1,
        latestProposalId: first.id,
        activeProposalId: first.id,
      },
    ])
  })

  it('serializes concurrent multi-store admission before invoking an expensive verifier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-concurrent-pattern-'))
    roots.push(root)
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const verify = vi.fn(async () => {
      entered?.()
      await gate
      return {
        decision: 'passed' as const,
        verifier: 'controlled-v1',
        evidence: 'controlled evidence',
      }
    })
    const services = await Promise.all(
      [0, 1].map(
        async () =>
          new EvolutionService(await EvolutionStore.open(root), { verify }, 256, evaluationPolicy, {
            reproposalAfterOccurrences: 5,
            generationReservationTimeoutMs: 60_000,
          }),
      ),
    )
    const first = services[0]?.observeToolFailure(failure('concurrent item 1 failed'))
    await started
    const second = await services[1]?.observeToolFailure(failure('concurrent item 2 failed'))
    expect(second).toBeUndefined()
    release?.()
    await first

    const snapshot = (await EvolutionStore.open(root)).snapshot()
    expect(verify).toHaveBeenCalledTimes(1)
    expect(snapshot.patterns.values().next().value).toMatchObject({ occurrenceCount: 2 })
    expect(snapshot.proposals.size).toBe(1)
    expect(snapshot.reservations.size).toBe(0)
  })

  it('keeps the occurrence and releases the reservation when verification fails', async () => {
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockReturnValue({
        decision: 'passed' as const,
        verifier: 'recovered-v1',
        evidence: 'provider recovered',
      })
    const { store, service } = await fixture({ verify })
    await expect(service.observeToolFailure(failure('provider item 1 failed'))).rejects.toThrow(
      'provider unavailable',
    )
    expect(store.snapshot().patterns.values().next().value).toMatchObject({ occurrenceCount: 1 })
    expect(store.snapshot().proposals.size).toBe(0)
    expect(store.snapshot().reservations.size).toBe(0)

    const proposal = required(await service.observeToolFailure(failure('provider item 2 failed')))
    expect(proposal).toMatchObject({ generation: 1, patternOccurrence: 2 })
  })

  it('reclaims an expired reservation and rejects the stale provider completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-expired-pattern-'))
    roots.push(root)
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const slow = new EvolutionService(
      await EvolutionStore.open(root),
      {
        verify: async () => {
          entered?.()
          await gate
          return { decision: 'passed', verifier: 'slow-v1', evidence: 'late result' }
        },
      },
      256,
      evaluationPolicy,
      { reproposalAfterOccurrences: 5, generationReservationTimeoutMs: 1 },
    )
    const recovered = new EvolutionService(
      await EvolutionStore.open(root),
      new DeterministicSafetyVerifier(),
      256,
      evaluationPolicy,
      { reproposalAfterOccurrences: 5, generationReservationTimeoutMs: 1 },
    )
    const stale = slow.observeToolFailure(failure('lease item 1 failed'))
    await started
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    const proposal = required(await recovered.observeToolFailure(failure('lease item 2 failed')))
    let disposed = false
    const disposal = slow.dispose().then(() => {
      disposed = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(disposed).toBe(false)
    release?.()
    await expect(stale).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    await disposal

    expect(proposal).toMatchObject({ generation: 1, patternOccurrence: 2 })
    const snapshot = (await EvolutionStore.open(root)).snapshot()
    expect(snapshot.proposals.size).toBe(1)
    expect(snapshot.reservations.size).toBe(0)
  })

  it.each(['rejected', 'superseded'] as const)(
    'requires five new occurrences before generation 2 after %s',
    async (terminal) => {
      const { service } = await fixture()
      const first = required(await service.observeToolFailure(failure('repeat 1 failed')))
      if (terminal === 'rejected') {
        await service.reject(first.id, 'not useful')
      } else {
        await service.accept(first.id)
        await service.promote(first.id)
        await service.supersede(first.id, 'withdrawn')
      }
      for (const instance of [2, 3, 4, 5]) {
        expect(
          await service.observeToolFailure(failure(`repeat ${String(instance)} failed`)),
        ).toBeUndefined()
      }
      const second = required(await service.observeToolFailure(failure('repeat 6 failed')))
      expect(second).toMatchObject({ generation: 2, patternOccurrence: 6, status: 'pending' })
      expect(second.patternId).toBe(first.patternId)
      expect(service.listPatterns()[0]).toMatchObject({ occurrenceCount: 6, latestGeneration: 2 })
    },
  )

  it('keeps a promoted generation unique until explicit rollback', async () => {
    const { service } = await fixture()
    const proposal = required(await service.observeToolFailure(failure('active 1 failed')))
    await service.accept(proposal.id)
    await service.promote(proposal.id)
    for (const instance of [2, 3, 4, 5, 6, 7]) {
      await service.observeToolFailure(failure(`active ${String(instance)} failed`))
    }
    expect(service.listProposals()).toHaveLength(1)
    expect(service.listPatterns()[0]).toMatchObject({
      occurrenceCount: 7,
      activeProposalId: proposal.id,
    })
  })

  it('persists patterns and proposal linkage across restart', async () => {
    const { root, service } = await fixture()
    const proposal = required(await service.observeToolFailure(failure('restart 1 failed')))
    await service.observeToolFailure(failure('restart 2 failed'))
    const reopened = await EvolutionStore.open(root)
    if (proposal.patternId === undefined) throw new Error('expected pattern association')
    expect(reopened.snapshot().patterns.get(proposal.patternId)).toMatchObject({
      occurrenceCount: 2,
      latestProposalId: proposal.id,
      latestGeneration: 1,
    })
  })

  it('waits for an admitted generation during disposal and rejects later observations', async () => {
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const { store, service } = await fixture({
      verify: async () => {
        entered?.()
        await gate
        return { decision: 'passed', verifier: 'controlled-v1', evidence: 'completed safely' }
      },
    })
    const mutation = service.observeToolFailure(failure('dispose 1 failed'))
    await started
    let disposed = false
    const disposal = service.dispose().then(() => {
      disposed = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(disposed).toBe(false)

    release?.()
    await mutation
    await disposal
    expect(store.snapshot().proposals.size).toBe(1)
    expect(store.snapshot().reservations.size).toBe(0)
    expect(() => service.observeToolFailure(failure('dispose 2 failed'))).toThrow(
      expect.objectContaining({ code: 'DISPOSED' }),
    )
  })

  it.each(['duplicate', 'reference', 'generation', 'occurrence'] as const)(
    'fails closed for corrupt pattern audit: %s',
    async (corruption) => {
      const { root, service } = await fixture()
      await service.observeToolFailure(failure('corruption 1 failed'))
      const filename = join(root, 'audit-v1.jsonl')
      const events = (await readFile(filename, 'utf8'))
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      const occurrence = events.find((event) => event.kind === 'failure-pattern-occurred')
      const reservation = events.find((event) => event.kind === 'proposal-generation-reserved')
      if (occurrence === undefined || reservation === undefined)
        throw new Error('missing fixture facts')
      if (corruption === 'duplicate') {
        events.push({ ...occurrence, seq: events.length, occurrence: 2 })
      } else if (corruption === 'reference') {
        occurrence.observationId = '00000000-0000-4000-8000-000000000099'
      } else if (corruption === 'generation') {
        reservation.reservation = {
          ...(reservation.reservation as Record<string, unknown>),
          generation: 2,
        }
      } else {
        occurrence.occurrence = 2
      }
      await writeFile(filename, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)
      await expect(EvolutionStore.open(root)).rejects.toMatchObject({ code: 'CORRUPT_STORE' })
    },
  )
})
