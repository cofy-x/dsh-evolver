/** Reproduce v1's successful-result rendering defect through shipped Headless + DeepSeek SSE. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const controller = fileURLToPath(new URL('../benchmark.mjs', import.meta.url))
for (const legacy of [true, false]) {
  const result = spawnSync(
    process.execPath,
    [
      controller,
      '--adapter=deepseek-fixture',
      ...(legacy ? ['--fixture-fault=legacy-render'] : []),
    ],
    {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 60000,
    },
  )
  assert.equal(result.status, 0)
  const report = JSON.parse(result.stdout)
  for (const pair of report.pairs) {
    for (const arm of ['baseline', 'treatment']) {
      const rows = pair[arm].diagnostics.operations
      const inspection = rows.find((row) => row.action === 'inspect')
      assert.equal(inspection.bodyValueRendered, !legacy)
      assert.equal(inspection.nextOptions.matchesFinal, true)
      assert.equal(inspection.nextWire.present, true)
      assert.equal(inspection.nextWire.matchesBody, !legacy)
      assert.equal(rows.at(-1).goalReached, true)
    }
  }
}
console.log(
  'Verified through shipped Headless/adapter: legacy renderer loses the body value; v2 delivers it to the next request. Both scripted graders succeed.',
)
