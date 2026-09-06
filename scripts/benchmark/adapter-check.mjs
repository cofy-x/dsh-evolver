/** Credential-free shipped DeepSeek adapter checks; inherits no credential environment. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const controller = fileURLToPath(new URL('../benchmark.mjs', import.meta.url))
for (const fault of ['none', 'rate-limit', 'hang']) {
  const result = spawnSync(
    process.execPath,
    [controller, '--adapter=deepseek-fixture', `--fixture-fault=${fault}`, '--run-timeout-ms=4000'],
    { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 60000 },
  )
  const report = JSON.parse(result.stdout)
  assert.equal(report.wireReservations.requests, fault === 'none' ? 24 : 6)
  assert.equal(report.counts.invalidPairs, fault === 'rate-limit' ? 3 : 0)
  assert.equal(report.counts.bothSucceeded, fault === 'none' ? 3 : 0)
  for (const pair of report.pairs)
    for (const arm of ['baseline', 'treatment']) {
      assert.equal(
        pair[arm].status,
        fault === 'none' ? 'completed' : fault === 'hang' ? 'timeout' : 'infrastructure',
      )
      assert.equal(pair[arm].pairIntegrity, true)
    }
  console.log(`real-adapter fixture ${fault}: passed`)
}
for (const args of [
  ['--adapter=deepseek-live'],
  ['--adapter=deepseek-live', '--allow-paid=yes', '--split=heldout'],
  ['--adapter=deepseek-live', '--allow-paid=yes', '--fixture-fault=hang'],
]) {
  const result = spawnSync(process.execPath, [controller, ...args], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
}
console.log('paid opt-in and pilot-only CLI boundaries: passed')
