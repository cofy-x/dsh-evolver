/** End-to-end scoring regressions through the actual shipped Headless runtime. Offline only. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const runner = fileURLToPath(new URL('../benchmark.mjs', import.meta.url))
const scenarios = [
  ['solve', 'solve', 'bothSucceeded', 0],
  ['claim', 'solve', 'treatmentOnly', 1],
  ['solve', 'repeat', 'baselineOnly', -1],
  ['solve', 'overhead', 'bothSucceeded', 0],
  ['budget', 'solve', 'treatmentOnly', 1],
  ['infra', 'solve', 'invalidPairs', null],
  ['leak', 'solve', 'invalidPairs', null],
  ['hang', 'solve', 'treatmentOnly', 1],
]
for (const [baseline, treatment, count, delta] of scenarios) {
  const child = spawnSync(
    process.execPath,
    [
      runner,
      '--split=development',
      `--baseline=${baseline}`,
      `--treatment=${treatment}`,
      '--run-timeout-ms=4000',
    ],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, DSH_TEST_HARNESS: process.env.DSH_TEST_HARNESS },
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    },
  )
  assert.equal(child.error, undefined)
  const report = JSON.parse(child.stdout)
  assert.equal(report.counts[count], 3)
  assert.equal(report.successRateDelta, delta)
  assert.equal(child.status, count === 'invalidPairs' ? 1 : 0)
  if (treatment === 'overhead') assert.ok(report.pairs.every((pair) => pair.callDelta === 1))
  if (treatment === 'repeat')
    assert.ok(report.pairs.every((pair) => pair.treatment.repeatedInvalid === 2))
  if (baseline === 'budget')
    assert.ok(
      report.pairs.every(
        (pair) => pair.baseline.status === 'budget' && pair.baseline.requests === 4,
      ),
    )
  console.log(`BENCHMARK_CHECK_PASS ${baseline}/${treatment}: ${count}=3; offline fixture only`)
}
