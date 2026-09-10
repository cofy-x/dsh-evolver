/** Experiment-only, bounded diagnostic projection. Raw values live only in transient maps. */
import { grade } from './tasks.mjs'

const FAILURES = new Map([
  ['Unknown operation; inspect record rules.', 'unknown-action'],
  ['Commit payload must be a JSON object; inspect record rules.', 'invalid-json'],
  ['Commit payload must be an object.', 'invalid-object'],
  ['Stale revision; inspect the current record revision before writing.', 'stale-revision'],
  ['Value must be a string.', 'invalid-value'],
  ['Value must use uppercase format.', 'uppercase-required'],
  ['Batch rejected atomically: use at most two items per commit.', 'batch-limit'],
  ['Batch contains an unknown item.', 'unknown-item'],
])

/** Never return an error message or argument-derived string to the report. */
export function failureCategory(message, code) {
  if (code === 'INVALID_ARGS') return 'invalid-arguments'
  if (code === 'UNKNOWN_TOOL') return 'unknown-tool'
  return FAILURES.get(message) ?? 'other-tool-error'
}

export function actionCategory(args) {
  return ['inspect', 'commit'].includes(args?.action) ? args.action : 'unknown-action'
}

function progressUnits(task, state) {
  return task.family === 'batch'
    ? task.items.filter((item) => state.completed.includes(item)).length
    : Number(grade(task, state))
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const textOf = (blocks) =>
  blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

/** Captures execution order, coarse progress and result-delivery booleans, never raw content. */
export class TaskDiagnostics {
  #task
  #world
  #rows = []
  #calls = new Map()
  #pending = new Map()
  constructor(task, world) {
    this.#task = task
    this.#world = world
  }

  #entry(callId, args) {
    if (this.#calls.has(callId)) return this.#calls.get(callId)
    if (this.#rows.length >= 32) throw new Error('diagnostic capacity exceeded')
    const row = {
      order: this.#rows.length + 1,
      action: actionCategory(args),
      bodyEntered: false,
      failure: null,
      progress: 'unchanged',
      goalReached: grade(this.#task, this.#world.snapshot()),
      bodyValueRendered: null,
      nextOptions: null,
      nextWire: null,
    }
    this.#rows.push(row)
    this.#calls.set(callId, row)
    return row
  }

  execute(callId, args, body) {
    const row = this.#entry(callId, args)
    row.bodyEntered = true
    const before = progressUnits(this.#task, this.#world.snapshot())
    try {
      const value = body()
      // The synthetic world is synchronous. This is not an arbitrary tool wrapper.
      this.#pending.set(callId, { bodyValue: value })
      return value
    } catch (error) {
      row.failure = failureCategory(error.message, error.info?.code)
      throw error
    } finally {
      const after = progressUnits(this.#task, this.#world.snapshot())
      row.progress = after > before ? 'closer' : after < before ? 'farther' : 'unchanged'
      row.goalReached = grade(this.#task, this.#world.snapshot())
    }
  }

  result(exec, result) {
    const row = this.#entry(exec.callId, exec.arguments)
    if (result.isError) row.failure = failureCategory(result.error.message, result.error.info?.code)
    const pending = this.#pending.get(exec.callId) ?? {}
    if (Object.hasOwn(pending, 'bodyValue') && !result.isError)
      row.bodyValueRendered = same(result.content, [{ type: 'text', text: pending.bodyValue }])
    pending.content = structuredClone(result.content)
    pending.isError = result.isError
    this.#pending.set(exec.callId, pending)
  }

  options(messages) {
    const results = messages.flatMap((m) => m.content).filter((b) => b.type === 'tool-result')
    for (const [id, pending] of this.#pending) {
      const row = this.#calls.get(id)
      if (!pending.content || row.nextOptions !== null) continue
      const block = results.find((b) => b.toolCallId === id)
      row.nextOptions = {
        present: !!block,
        matchesFinal:
          !!block && same(block.content, pending.content) && !!block.isError === pending.isError,
      }
    }
  }

  wire(messages) {
    for (const [id, pending] of this.#pending) {
      const row = this.#calls.get(id)
      if (!pending.content || row.nextWire !== null) continue
      const block = messages.find((m) => m.role === 'tool' && m.tool_call_id === id)
      row.nextWire = {
        present: !!block,
        matchesFinal: !!block && block.content === textOf(pending.content),
        matchesBody: Object.hasOwn(pending, 'bodyValue')
          ? !!block && block.content === pending.bodyValue
          : null,
      }
      // Neither values nor rendered output survive after their first request check.
      this.#pending.delete(id)
    }
  }

  snapshot() {
    return {
      version: 'task-diagnostics-v1',
      counts: Object.fromEntries(
        ['inspect', 'commit', 'unknown-action'].map((action) => [
          action,
          this.#rows.filter((r) => r.action === action).length,
        ]),
      ),
      operations: structuredClone(this.#rows),
    }
  }
}
