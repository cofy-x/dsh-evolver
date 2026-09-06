import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { SmokeBudget, checkDestination, fixtureResponse } from './budget.mjs'

const wire = (overrides = {}) =>
  JSON.stringify({
    model: 'fixture',
    stream: true,
    thinking: { type: 'disabled' },
    max_tokens: 512,
    messages: [{ role: 'user', content: 'probe' }],
    tools: [{ type: 'function', function: { name: 'evolver_probe' } }],
    ...overrides,
  })

test('reserves before calls and restores aggregate request/output ceilings', () => {
  let budget = new SmokeBudget()
  for (let i = 0; i < 16; i++) budget = new SmokeBudget(budget.admit(wire(), 'fixture'))
  assert.equal(budget.state.output, 8192)
  const before = { ...budget.state }
  assert.throws(() => budget.admit(wire(), 'fixture'), /budget exceeded/)
  assert.deepEqual(budget.state, before)
})

test('preflight rejects oversized Unicode, aggregate input, modalities and unsafe options', () => {
  const budget = new SmokeBudget()
  for (const overrides of [
    { max_tokens: 513 },
    { model: 'other' },
    { thinking: { type: 'enabled' } },
    { messages: [{ content: [{ type: 'image_url' }] }] },
    { tools: [] },
    { messages: [{ content: '中'.repeat(1400) }] },
  ]) {
    assert.throws(() => budget.admit(wire(overrides), 'fixture'))
    assert.equal(budget.state.requests, 0)
  }
  assert.throws(() =>
    new SmokeBudget({ requests: 1, input: 32760, output: 512 }).admit(wire(), 'fixture'),
  )
  assert.throws(() => new SmokeBudget({ requests: -1, input: 0, output: 0 }))
})

test('only the exact completion POST is admitted', () => {
  checkDestination('https://api.deepseek.com/chat/completions', { method: 'POST', body: wire() })
  for (const url of [
    'http://api.deepseek.com/chat/completions',
    'https://api.deepseek.com/files',
    'https://api.deepseek.com/chat/completions?key=secret',
    'https://api.deepseek.com.evil.test/chat/completions',
  ])
    assert.throws(() => checkDestination(url, { method: 'POST', body: wire() }))
  assert.throws(() =>
    checkDestination('https://api.deepseek.com/chat/completions', { method: 'GET' }),
  )
})

test('local provider fixture supplies usage and a terminal SSE frame', async () => {
  const response = fixtureResponse([{ type: 'block-end', block: { type: 'text', text: 'OK' } }])
  const text = await response.text()
  assert.match(text, /prompt_tokens/)
  assert.ok(text.endsWith('data: [DONE]\n\n'))
  assert.throws(() => fixtureResponse(undefined))
})

test('CLI rejects missing authorization and ambiguous modes without exposing credentials', () => {
  for (const args of [
    ['--deepseek-live'],
    ['--allow-paid'],
    ['--deepseek-live', '--deepseek-dry-run'],
    ['--unknown'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [new URL('../runtime-e2e.mjs', import.meta.url).pathname, ...args],
      { encoding: 'utf8', timeout: 3000, env: { DEEPSEEK_API_KEY: 'DO_NOT_EXPOSE_TEST_VALUE' } },
    )
    assert.notEqual(result.status, 0)
    assert.equal((result.stdout + result.stderr).includes('DO_NOT_EXPOSE_TEST_VALUE'), false)
  }
})
