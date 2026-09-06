/** Pure scheduling and paired descriptive summaries; never use tool failure rate as task success. */
import { createHash } from 'node:crypto'
export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const BOUNDS = Object.freeze({
  requestsPerRun: 4,
  toolCallsPerRun: 6,
  outputPerRequest: 512,
  inputPerRequest: 4096,
  runMs: 45000,
  totalMs: 360000,
})
export function schedule(tasks, seed) {
  const ordered = [...tasks].sort((a, b) => hash([seed, a.id]).localeCompare(hash([seed, b.id])))
  return ordered.flatMap((task, index) =>
    (index % 2 ? ['treatment', 'baseline'] : ['baseline', 'treatment']).map((arm) => ({
      taskId: task.id,
      arm,
    })),
  )
}
export function summarize(plan, rows) {
  if (rows.length !== plan.length) throw new Error('missing runs')
  const lookup = new Map()
  for (const row of rows) {
    const key = `${row.taskId}:${row.arm}`
    if (lookup.has(key) || !plan.some((item) => item.taskId === row.taskId && item.arm === row.arm))
      throw new Error('duplicate or unexpected run')
    lookup.set(key, row)
  }
  const counts = {
    bothSucceeded: 0,
    treatmentOnly: 0,
    baselineOnly: 0,
    bothFailed: 0,
    invalidPairs: 0,
  }
  const pairs = [...new Set(plan.map((row) => row.taskId))].map((taskId) => {
    const baseline = lookup.get(`${taskId}:baseline`)
    const treatment = lookup.get(`${taskId}:treatment`)
    const valid = [baseline, treatment].every(
      (row) =>
        row.pairIntegrity === true && ['completed', 'budget', 'timeout'].includes(row.status),
    )
    if (!valid) counts.invalidPairs++
    else
      counts[
        baseline.success
          ? treatment.success
            ? 'bothSucceeded'
            : 'baselineOnly'
          : treatment.success
            ? 'treatmentOnly'
            : 'bothFailed'
      ]++
    const delta = (key) =>
      valid && Number.isFinite(treatment[key]) && Number.isFinite(baseline[key])
        ? treatment[key] - baseline[key]
        : null
    return {
      taskId,
      valid,
      baseline,
      treatment,
      callDelta: delta('calls'),
      repeatedInvalidDelta: delta('repeatedInvalid'),
      requestDelta: delta('requests'),
      inputUnitsDelta: delta('inputUnits'),
      outputUnitsDelta: delta('outputUnits'),
      elapsedMsDelta: delta('elapsedMs'),
    }
  })
  const validPairs = pairs.filter((pair) => pair.valid).length
  return {
    counts,
    plannedPairs: pairs.length,
    validPairs,
    successRateDelta: validPairs ? (counts.treatmentOnly - counts.baselineOnly) / validPairs : null,
    interpretation: counts.invalidPairs ? 'incomplete' : 'descriptive-only',
    pairs,
  }
}
