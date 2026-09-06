/** Negative real-adapter checks; never supply credentials or enable network. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const fault of ['rate-limit', 'hang']) {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../runtime-e2e.mjs', import.meta.url)),
      '--deepseek-dry-run',
      `--fault=${fault}`,
      '--timeout-ms=4000',
    ],
    { encoding: 'utf8', timeout: 8000, env: { PATH: process.env.PATH } },
  )
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  const report = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((item) => item.passed === false)
  assert.ok(report, 'missing safe failure evidence')
  assert.equal(report.reserved?.requests, 1, 'no retries or post-failure requests')
  assert.equal(report.timedOut, fault === 'hang')
  console.log(`EVOLVER_SMOKE_FAULT_PASS ${fault}: one reserved request, bounded termination`)
}
