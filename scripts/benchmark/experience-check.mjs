/** Public-profile, credential-free development and parent-watchdog regression checks. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const controller = fileURLToPath(new URL('../experience.mjs', import.meta.url))
for (const fault of ['none', 'success-only', 'rate-limit', 'hang']) {
  const result = spawnSync(
    process.execPath,
    [
      controller,
      '--mode=offline',
      '--phase=development',
      `--fault=${fault}`,
      '--run-ms=10000',
      '--request-ms=1000',
    ],
    {
      env: { PATH: process.env.PATH, DSH_TEST_HARNESS: process.env.DSH_TEST_HARNESS },
      encoding: 'utf8',
      timeout: 60000,
    },
  )
  const report = JSON.parse(result.stdout)
  assert.equal(report.implementationUnchanged, true)
  assert.equal(
    report.budget.requests,
    fault === 'none' ? 12 : fault === 'success-only' ? 9 : fault === 'rate-limit' ? 2 : 3,
  )
  assert.equal(report.rows.length, 3)
  if (fault === 'none' || fault === 'success-only') {
    assert.equal(result.status, 0)
    assert.ok(report.rows.every((r) => r.success && Object.values(r.checks).every(Boolean)))
  } else if (fault === 'rate-limit') {
    assert.deepEqual(
      report.rows.map((r) => r.reason),
      ['provider-http-429', 'provider-http-429', 'infrastructure-stop'],
    )
  } else
    assert.ok(
      report.rows.every((r) => r.reason === 'request-time-budget' && r.status === 'timeout'),
    )
  console.log(`experience development ${fault}: passed`)
}
