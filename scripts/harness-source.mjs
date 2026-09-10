/** Pinned source host for reproducible integration tests; explicit overrides remain available. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compatibilityContract, harnessSource } from './compatibility.mjs'

export const sourceDirectory = fileURLToPath(
  new URL(`../.cache/harness/${harnessSource.commit}/`, import.meta.url),
)

/** Reject a missing, moved or edited source baseline without changing its checkout. */
export function verifyHarnessSource(directory = sourceDirectory, pin = harnessSource) {
  assert.ok(
    existsSync(join(directory, '.git')),
    'prepare the source host: pnpm run prepare:harness',
  )
  const git = (...args) =>
    execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
  assert.equal(git('rev-parse', 'HEAD'), pin.commit, 'source host commit differs from the pin')
  assert.equal(
    git('status', '--porcelain'),
    '',
    'source host has local changes; do not overwrite it',
  )
  const cli = JSON.parse(readFileSync(join(directory, 'apps/cli/package.json'), 'utf8'))
  assert.equal(cli.name, '@deepseek-ai/dsh')
  assert.equal(cli.version, pin.version, 'source CLI version differs from the release')
  return directory
}

/** Prefer explicit CLI, then test environment; otherwise require the verified source pin. */
export function resolveHarness(explicit, environment = process.env) {
  compatibilityContract()
  const override = explicit ?? environment.DSH_TEST_HARNESS
  if (override !== undefined) {
    assert.ok(typeof override === 'string' && override.length > 0, 'host path must not be empty')
    return resolve(override)
  }
  return verifyHarnessSource()
}
