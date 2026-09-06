/** Pilot-only admission. One owner at a time: the controller waits for each child to exit. */
import assert from 'node:assert/strict'
import { BOUNDS } from './report.mjs'
export function reserve(state, body, model, run) {
  assert.ok(state && state.runs && typeof state.runs === 'object' && !Array.isArray(state.runs))
  for (const key of ['requests', 'input', 'output'])
    assert.ok(Number.isSafeInteger(state[key]) && state[key] >= 0)
  const validRun = (key) => /^pilot-(precondition|format|batch)-1:(baseline|treatment)$/.test(key)
  assert.ok(validRun(run))
  assert.ok(
    Object.entries(state.runs).every(
      ([key, count]) => validRun(key) && Number.isSafeInteger(count) && count >= 0 && count <= 4,
    ),
  )
  assert.equal(
    Object.values(state.runs).reduce((a, b) => a + b, 0),
    state.requests,
  )
  assert.equal(state.output, state.requests * 512)
  assert.ok(state.input <= state.requests * 4096)
  const wire = JSON.parse(body)
  const allowed = [
    'model',
    'messages',
    'stream',
    'stream_options',
    'thinking',
    'reasoning_effort',
    'tools',
    'temperature',
    'max_tokens',
    'stop',
  ]
  assert.ok(Object.keys(wire).every((key) => allowed.includes(key)))
  assert.equal(wire.model, model)
  assert.equal(wire.stream, true)
  assert.equal(wire.max_tokens, 512)
  assert.equal(wire.thinking?.type, 'disabled')
  assert.ok(
    Array.isArray(wire.messages) &&
      wire.messages.every((m) => m.content == null || typeof m.content === 'string'),
  )
  assert.equal(wire.tools?.length, 1)
  assert.equal(wire.tools[0].function?.name, 'bench_apply')
  const input = Buffer.byteLength(body) + 256 + wire.messages.length * 32
  const count = state.runs[run] ?? 0
  assert.ok(Number.isSafeInteger(count) && count >= 0 && count < 4)
  assert.ok(
    input <= BOUNDS.inputPerRequest &&
      state.requests < 24 &&
      state.input + input <= 98304 &&
      state.output + 512 <= 12288,
  )
  return {
    requests: state.requests + 1,
    input: state.input + input,
    output: state.output + 512,
    runs: { ...state.runs, [run]: count + 1 },
  }
}

/** Local SSE exercises the shipped adapter, including multiple parallel tool calls. */
export function response(calls, request) {
  assert.ok(calls)
  const delta = calls.length
    ? {
        role: 'assistant',
        tool_calls: calls.map((args, index) => ({
          index,
          id: `call-${request}-${index}`,
          type: 'function',
          function: { name: 'bench_apply', arguments: JSON.stringify(args) },
        })),
      }
    : { role: 'assistant', content: 'Task complete.' }
  const events = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
  ]
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
