import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { compatibilityContract, harnessSource, productManifest } from './compatibility.mjs'
import { resolveHarness, verifyHarnessSource } from './harness-source.mjs'

test('source version, release tag, repository and exact commit remain a coherent pin', () => {
  compatibilityContract()
  for (const mutation of [
    { version: '0.0.0' },
    { tag: 'master' },
    { repository: 'https://example.invalid/harness.git' },
    { commit: 'master' },
  ])
    assert.throws(() => compatibilityContract(productManifest, { ...harnessSource, ...mutation }))
})

test('explicit host path wins over the test environment and empty overrides fail closed', () => {
  assert.equal(resolveHarness('explicit', { DSH_TEST_HARNESS: 'environment' }), resolve('explicit'))
  assert.equal(
    resolveHarness(undefined, { DSH_TEST_HARNESS: 'environment' }),
    resolve('environment'),
  )
  assert.throws(() => resolveHarness(undefined, { DSH_TEST_HARNESS: '' }), /must not be empty/)
})

test('source verification rejects missing, moved, dirty or incorrectly versioned checkouts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'evolver-source-'))
  const git = (...args) =>
    execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
  try {
    assert.throws(() => verifyHarnessSource(directory), /prepare:harness/)
    git('init', '--quiet')
    mkdirSync(join(directory, 'apps/cli'), { recursive: true })
    writeFileSync(
      join(directory, 'apps/cli/package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh', version: harnessSource.version }),
    )
    git('add', '.')
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    )
    const pin = { ...harnessSource, commit: git('rev-parse', 'HEAD') }
    assert.equal(verifyHarnessSource(directory, pin), directory)
    assert.throws(
      () => verifyHarnessSource(directory, { ...pin, commit: '0'.repeat(40) }),
      /commit differs/,
    )
    assert.throws(
      () => verifyHarnessSource(directory, { ...pin, version: '0.0.0' }),
      /version differs/,
    )
    writeFileSync(join(directory, 'uncommitted'), 'do not erase')
    assert.throws(() => verifyHarnessSource(directory, pin), /local changes/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
