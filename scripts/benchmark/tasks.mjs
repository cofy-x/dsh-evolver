/** Immutable synthetic task partitions. Hidden parameters never enter the user task prompt. */
export const VERSION = 'recovery-benchmark-v1'
const families = ['precondition', 'format', 'batch']
export const TASKS = Object.freeze(
  ['development', 'pilot', 'heldout'].flatMap((split, s) =>
    families.flatMap((family, f) =>
      Array.from({ length: split === 'heldout' ? 4 : 1 }, (_, i) =>
        Object.freeze({
          id: `${split}-${family}-${i + 1}`,
          split,
          family,
          target: `parcel-${s + 1}-${f + 1}-${i + 1}`,
          revision: 3 + s * 10 + i,
          items: Object.freeze(Array.from({ length: 3 + i }, (_, n) => `item-${s}-${i}-${n}`)),
          limit: 2,
        }),
      ),
    ),
  ),
)

export function taskById(id) {
  const task = TASKS.find((item) => item.id === id)
  if (!task) throw new Error('unknown benchmark task')
  return task
}

export function prompt(task) {
  return task.family === 'batch'
    ? `Complete the queue for items ${task.items.join(', ')} using bench_apply. Stop when the task is complete.`
    : `Store ${task.target} in the record using bench_apply, satisfying the record's validation rules. Stop when the task is complete.`
}

/** Tools only mutate closure-owned synthetic state. No disk, shell, network, or grade access. */
export function createWorld(task) {
  let value = null
  const completed = new Set()
  const failedKeys = new Set()
  const metrics = { calls: 0, failures: 0, repeatedInvalid: 0 }
  return {
    execute({ action, payload }) {
      metrics.calls++
      if (action === 'inspect')
        return JSON.stringify({
          family: task.family,
          ...(task.family === 'precondition'
            ? { revision: task.revision, value }
            : task.family === 'format'
              ? { format: 'uppercase', value }
              : { limit: task.limit, completed: [...completed] }),
        })
      const fail = (message) => {
        metrics.failures++
        const key = JSON.stringify([action, payload])
        if (failedKeys.has(key)) metrics.repeatedInvalid++
        failedKeys.add(key)
        throw new Error(message)
      }
      if (action !== 'commit') return fail('Unknown operation; inspect record rules.')
      let data
      try {
        data = JSON.parse(payload)
      } catch {
        return fail('Commit payload must be a JSON object; inspect record rules.')
      }
      if (!data || Array.isArray(data) || typeof data !== 'object')
        return fail('Commit payload must be an object.')
      if (task.family === 'precondition') {
        if (data.revision !== task.revision)
          return fail('Stale revision; inspect the current record revision before writing.')
        if (typeof data.value !== 'string') return fail('Value must be a string.')
        value = data.value
      } else if (task.family === 'format') {
        if (typeof data.value !== 'string' || data.value !== data.value.toUpperCase())
          return fail('Value must use uppercase format.')
        value = data.value
      } else {
        if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > task.limit)
          return fail('Batch rejected atomically: use at most two items per commit.')
        if (data.items.some((item) => !task.items.includes(item)))
          return fail('Batch contains an unknown item.')
        for (const item of data.items) completed.add(item)
      }
      return 'Committed.'
    },
    snapshot() {
      return { value, completed: [...completed].sort(), ...metrics }
    },
  }
}

/** Independent exact-state oracle; assistant output, tool success count, and Evolver verdict are irrelevant. */
export function grade(task, state) {
  return task.family === 'batch'
    ? JSON.stringify(state.completed) === JSON.stringify([...task.items].sort())
    : state.value === (task.family === 'format' ? task.target.toUpperCase() : task.target)
}

/** White-box offline scripts validate the harness, never estimate model effectiveness. */
export function scriptFor(task, behavior) {
  const commit = (data) => ({ action: 'commit', payload: JSON.stringify(data) })
  const inspect = { action: 'inspect', payload: '' }
  const bad =
    task.family === 'batch'
      ? commit({ items: task.items })
      : commit({ value: task.target, revision: 0 })
  const good =
    task.family === 'batch'
      ? Array.from({ length: Math.ceil(task.items.length / task.limit) }, (_, i) =>
          commit({ items: task.items.slice(i * task.limit, (i + 1) * task.limit) }),
        )
      : [
          commit({
            revision: task.revision,
            value: task.family === 'format' ? task.target.toUpperCase() : task.target,
          }),
        ]
  if (behavior === 'claim') return [[]]
  if (behavior === 'repeat') return [[bad], [bad], [bad], []]
  if (behavior === 'budget') return [[inspect], [inspect], [inspect], [inspect], []]
  return [[bad], behavior === 'overhead' ? [inspect, inspect] : [inspect], good, []]
}
