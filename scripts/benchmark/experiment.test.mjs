import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExperimentLedger, LIVE_LIMITS, MODEL } from './experiment-ledger.mjs'

const wire = JSON.stringify({
  model: MODEL,
  stream: true,
  thinking: { type: 'disabled' },
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'probe' }],
  tools: [{ function: { name: 'bench_apply' } }],
})
const fixture = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'evolver-ledger-test-'))
  try {
    fn(dir, ExperimentLedger.initialize(dir, 'offline'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('one restored ledger retains reservations, usage, failed requests and 40 evaluation slots', () =>
  fixture((dir, ledger) => {
    let clock = 1000
    for (let i = 0; i < 20; i++) {
      const id = `development:${i}`
      ledger.begin({ id, stage: 'development', requestLimit: 6, runMs: 1000 }, clock)
      for (let j = 0; j < 6; j++) {
        const restored = new ExperimentLedger(dir)
        const request = restored.reserve(id, wire, 1024, clock)
        assert.ok(request.deadline <= clock + LIVE_LIMITS.requestMs)
        assert.throws(() => restored.reserve(id, wire, 1024, clock), /not settled/)
        restored.settle(
          request.index,
          j ? { input: 10, output: 2 } : null,
          j ? null : 'provider-http-429',
        )
      }
      ledger.end(id, null, clock + 1)
      clock += 2
    }
    assert.equal(ledger.summary().requests, 120)
    assert.equal(ledger.summary().usageReports, 100)
    assert.throws(
      () =>
        ledger.begin(
          { id: 'training:blocked', stage: 'training', requestLimit: 6, runMs: 1000 },
          clock,
        ),
      /request-budget/,
    )
    for (let i = 0; i < 4; i++) {
      const id = `evaluation:${i}`
      ledger.begin({ id, stage: 'evaluation', requestLimit: 10, runMs: 1000 }, clock)
      for (let j = 0; j < 10; j++) {
        const request = ledger.reserve(id, wire, 1024, clock)
        ledger.settle(request.index, { input: 10, output: 2 })
      }
      ledger.end(id, null, clock + 1)
      clock += 2
    }
    assert.equal(ledger.summary().requests, 160)
    assert.equal(ledger.summary().reservedOutput, 163840)
    assert.throws(
      () =>
        ledger.begin(
          { id: 'evaluation:blocked', stage: 'evaluation', requestLimit: 1, runMs: 1000 },
          clock,
        ),
      /request-budget/,
    )
  }))

test('corrupt/missing/unfinished state never resets and cumulative time survives reopening', () =>
  fixture((dir, ledger) => {
    ledger.begin(
      { id: 'development:one', stage: 'development', requestLimit: 1, runMs: 1000 },
      1000,
    )
    assert.throws(
      () =>
        new ExperimentLedger(dir).begin({
          id: 'development:two',
          stage: 'development',
          requestLimit: 1,
          runMs: 1000,
        }),
      /unfinished/,
    )
    assert.throws(() => ledger.reserve('development:one', wire, 1024, 2001), /run-time-budget/)
    ledger.end('development:one', 'run-time-budget', 1201000)
    assert.throws(
      () =>
        new ExperimentLedger(dir).begin({
          id: 'development:two',
          stage: 'development',
          requestLimit: 1,
          runMs: 1000,
        }),
      /total-time-budget/,
    )
    writeFileSync(ledger.path, '{')
    assert.throws(() => ExperimentLedger.initialize(dir, 'offline'))
    rmSync(ledger.path)
    assert.throws(() => ExperimentLedger.initialize(dir, 'offline'), /must not reset/)
  }))

test('wire validation fails before reservation and excess reported usage stops the experiment', () =>
  fixture((dir, ledger) => {
    ledger.begin({ id: 'development:one', stage: 'development', requestLimit: 6, runMs: 90000 })
    const body = JSON.parse(wire)
    for (const patch of [{ max_tokens: 1025 }, { model: 'other' }, { tools: [] }, { extra: true }])
      assert.throws(() =>
        ledger.reserve('development:one', JSON.stringify({ ...body, ...patch }), 1024),
      )
    assert.throws(
      () =>
        ledger.reserve(
          'development:one',
          JSON.stringify({ ...body, messages: [{ content: 'x'.repeat(8192) }] }),
          1024,
        ),
      /input-budget/,
    )
    assert.equal(ledger.summary().requests, 0)
    const request = ledger.reserve('development:one', wire, 1024)
    assert.throws(() => ledger.settle(request.index, { input: 10000, output: 2 }), /provider-usage/)
    assert.equal(ledger.summary().reportedInput, 10000)
    assert.throws(() => ledger.reserve('development:one', wire, 1024), /ledger-blocked/)
    assert.ok(!readFileSync(ledger.path, 'utf8').includes('probe'))
  }))
