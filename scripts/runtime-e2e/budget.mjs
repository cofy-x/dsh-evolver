/** Smoke-only wire admission. Reservations are charged before transport, including failed calls. */
export const LIMITS = Object.freeze({
  requests: 16,
  inputPerRequest: 4096,
  input: 32768,
  outputPerRequest: 512,
  output: 8192,
  timeoutMs: 120000,
})

export class SmokeBudget {
  constructor(state = { requests: 0, input: 0, output: 0 }) {
    for (const key of ['requests', 'input', 'output']) {
      if (!Number.isSafeInteger(state[key]) || state[key] < 0 || state[key] > LIMITS[key])
        throw new Error('invalid budget ledger')
    }
    this.state = { requests: state.requests, input: state.input, output: state.output }
  }

  admit(body, model) {
    const wire = JSON.parse(body)
    const allowed = new Set([
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
    ])
    if (Object.keys(wire).some((key) => !allowed.has(key)))
      throw new Error('unexpected request extension')
    if (
      wire.model !== model ||
      wire.stream !== true ||
      wire.max_tokens !== LIMITS.outputPerRequest ||
      wire.thinking?.type !== 'disabled'
    )
      throw new Error('unsafe model request configuration')
    if (
      !Array.isArray(wire.messages) ||
      wire.messages.some(
        (m) => typeof m.content !== 'string' && m.content !== null && m.content !== undefined,
      )
    )
      throw new Error('only text requests are supported')
    if (wire.tools?.length !== 1 || wire.tools[0].function?.name !== 'evolver_probe')
      throw new Error('unexpected tools')
    // Charge every serialized UTF-8 byte, plus framing headroom. This is a deliberately
    // conservative byte-BPE estimate, not an authoritative provider tokenizer count.
    const input = Buffer.byteLength(body, 'utf8') + 256 + wire.messages.length * 32
    if (
      input > LIMITS.inputPerRequest ||
      this.state.requests + 1 > LIMITS.requests ||
      this.state.input + input > LIMITS.input ||
      this.state.output + wire.max_tokens > LIMITS.output
    )
      throw new Error('smoke budget exceeded')
    this.state = {
      requests: this.state.requests + 1,
      input: this.state.input + input,
      output: this.state.output + wire.max_tokens,
    }
    return { ...this.state }
  }
}

/** Fixed destination, no files, discovery, redirects, query overrides, or custom endpoints. */
export function checkDestination(url, init) {
  if (
    String(url) !== 'https://api.deepseek.com/chat/completions' ||
    init?.method !== 'POST' ||
    typeof init.body !== 'string'
  )
    throw new Error('smoke transport denied')
}

/** Translate the existing deterministic scenario to provider SSE at the transport seam. */
export function fixtureResponse(chunks) {
  if (!chunks) throw new Error('unexpected model request')
  const blocks = chunks.filter((chunk) => chunk.type === 'block-end').map((chunk) => chunk.block)
  const tool = blocks.find((block) => block.type === 'tool-call')
  const delta = tool
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: tool.id,
            type: 'function',
            function: { name: tool.name, arguments: tool.arguments },
          },
        ],
      }
    : { role: 'assistant', content: 'fixture complete' }
  const events = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
  ]
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
