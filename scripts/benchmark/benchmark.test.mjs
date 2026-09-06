import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TASKS, createWorld, grade, scriptFor, prompt } from './tasks.mjs'
import { schedule, summarize } from './report.mjs'
import { reserve } from './transport.mjs'

test('pilot wire ledger spans all six runs, rejects extensions and corrupted state', () => {
  const wire = {
    model: 'deepseek-v4-flash',
    stream: true,
    max_tokens: 512,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'probe' }],
    tools: [{ type: 'function', function: { name: 'bench_apply' } }],
  }
  let state = { requests: 0, input: 0, output: 0, runs: {} }
  const run = 'pilot-format-1:baseline'
  for (const patch of [
    { max_tokens: 513 },
    { model: 'other' },
    { extra: true },
    { messages: [{ content: 'x'.repeat(4096) }] },
    { tools: [] },
  ])
    assert.throws(() => reserve(state, JSON.stringify({ ...wire, ...patch }), wire.model, run))
  assert.throws(() => reserve({ ...state, requests: 1 }, JSON.stringify(wire), wire.model, run))
  for (const task of TASKS.filter((t) => t.split === 'pilot'))
    for (const arm of ['baseline', 'treatment']) {
      const key = `${task.id}:${arm}`
      for (let i = 0; i < 4; i++)
        state = reserve(JSON.parse(JSON.stringify(state)), JSON.stringify(wire), wire.model, key)
      assert.throws(() => reserve(state, JSON.stringify(wire), wire.model, key))
    }
  assert.equal(state.requests, 24)
  assert.equal(state.output, 12288)
})

test('partitions are disjoint and the independent oracle rejects claimed or partial completion', () => {
  assert.equal(new Set(TASKS.map((task) => task.id)).size, TASKS.length)
  assert.equal(TASKS.filter((task) => task.split === 'heldout').length, 12)
  for (const task of TASKS) {
    const world = createWorld(task)
    assert.equal(grade(task, world.snapshot()), false)
    assert.equal(
      grade(task, { ...world.snapshot(), assistant: 'Task complete.', calls: 99 }),
      false,
    )
    assert.ok(!prompt(task).includes(`"revision":${task.revision}`))
    for (const calls of scriptFor(task, 'solve'))
      for (const call of calls) {
        try {
          world.execute(call)
        } catch {
          /* Expected first failure. */
        }
      }
    assert.equal(grade(task, world.snapshot()), true)
    assert.equal(world.snapshot().failures, 1)
  }
})

test('failed batch is atomic, duplicate failures are counted, and worlds are isolated', () => {
  const task = TASKS.find((task) => task.family === 'batch')
  const world = createWorld(task)
  const bad = scriptFor(task, 'solve')[0][0]
  for (let i = 0; i < 3; i++) assert.throws(() => world.execute(bad))
  assert.deepEqual(world.snapshot().completed, [])
  assert.equal(world.snapshot().repeatedInvalid, 2)
  assert.equal(createWorld(task).snapshot().calls, 0)
})

test('schedule is reproducible and alternates arm order without changing task membership', () => {
  const tasks = TASKS.filter((task) => task.split === 'pilot')
  const plan = schedule(tasks, 17)
  assert.deepEqual(plan, schedule(tasks, 17))
  assert.deepEqual(
    plan.filter((_, i) => i % 2 === 0).map((row) => row.arm),
    ['baseline', 'treatment', 'baseline'],
  )
  for (const task of tasks) assert.equal(plan.filter((row) => row.taskId === task.id).length, 2)
})

test('paired reports preserve failures and overhead without inferring effectiveness', () => {
  const plan = schedule(
    TASKS.filter((task) => task.split === 'pilot'),
    17,
  )
  const rows = plan.map((row) => ({
    ...row,
    status: 'completed',
    pairIntegrity: true,
    success: true,
    calls: row.arm === 'treatment' ? 4 : 3,
    repeatedInvalid: 0,
  }))
  let report = summarize(plan, rows)
  assert.equal(report.successRateDelta, 0)
  assert.ok(report.pairs.every((pair) => pair.callDelta === 1))
  rows.find((row) => row.arm === 'baseline').success = false
  report = summarize(plan, rows)
  assert.equal(report.counts.treatmentOnly, 1)
  rows.find((row) => row.arm === 'treatment').status = 'infrastructure'
  assert.equal(summarize(plan, rows).counts.invalidPairs, 1)
  assert.throws(() => summarize(plan, rows.slice(1)), /missing/)
  assert.throws(
    () =>
      summarize(
        plan,
        rows.map(() => rows[0]),
      ),
    /duplicate/,
  )
})
