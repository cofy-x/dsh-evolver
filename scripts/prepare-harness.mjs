/** Prepare the selected release from source without moving any developer checkout. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { compatibilityContract, harnessSource } from './compatibility.mjs'
import { sourceDirectory, verifyHarnessSource } from './harness-source.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(
    'Usage: pnpm run prepare:harness [--source=EXISTING_CHECKOUT | --check]\nDefault: clone the pinned official release tag into ignored .cache/harness/<commit>, verify commit/version/cleanliness, install locked dependencies without lifecycle scripts, then build host, client, Web and native addon. --source reuses local Git objects through a detached worktree without moving that checkout; the pinned commit must already exist. Existing source is never reset or deleted. --check only verifies source identity, not build freshness. Requires Node 24, pnpm 11 and the host native build toolchain. No model calls or publication.',
  )
  process.exit(0)
}
assert.ok(
  args.length <= 1 && args.every((arg) => arg === '--check' || /^--source=.+$/.test(arg)),
  'expected --source=EXISTING_CHECKOUT or --check',
)
compatibilityContract()
if (args[0] === '--check') {
  verifyHarnessSource()
  console.log(`Verified source ${harnessSource.tag} at ${harnessSource.commit}`)
  process.exit(0)
}
const run = (command, argv, cwd) => execFileSync(command, argv, { cwd, stdio: 'inherit' })
if (!existsSync(sourceDirectory)) {
  mkdirSync(dirname(sourceDirectory), { recursive: true })
  if (args[0]) {
    const source = resolve(args[0].slice('--source='.length))
    run('git', ['worktree', 'add', '--detach', sourceDirectory, harnessSource.commit], source)
  } else {
    run('git', [
      'clone',
      '--depth=1',
      '--branch',
      harnessSource.tag,
      '--',
      harnessSource.repository,
      sourceDirectory,
    ])
  }
}
verifyHarnessSource()
run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], sourceDirectory)
for (const script of ['build:lib:host', 'build:lib:client', 'build:web', 'build:native-system'])
  run('pnpm', ['run', script], sourceDirectory)
verifyHarnessSource()
console.log(`Built source host ${harnessSource.version} at ${harnessSource.commit}`)
