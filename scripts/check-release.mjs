/** Read-only candidate/artifact checks. Never creates tags or publishes. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const args = process.argv.slice(2)
assert.ok(args.length <= 1 && args.every((arg) => arg === '--artifact'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(pkg.name, 'dsh-evolver')
assert.notEqual(pkg.private, true)
assert.match(pkg.version, /^\d+\.\d+\.\d+-alpha\.\d+$/)
assert.equal(pkg.publishConfig.access, 'public')
assert.equal(pkg.publishConfig.tag, 'alpha')
assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/')
assert.equal(git('status', '--porcelain'), '', 'release requires a clean checkout')
const sha = git('rev-parse', 'HEAD')
assert.equal(git('rev-parse', 'origin/main'), sha, 'candidate must be synchronized origin/main tip')
const tag = `v${pkg.version}`
assert.equal(git('cat-file', '-t', `refs/tags/${tag}`), 'tag', 'annotated tag required')
assert.equal(git('rev-parse', `${tag}^{commit}`), sha)
if (args.includes('--artifact')) {
  const report = JSON.parse(readFileSync('.cache/release/verified.json', 'utf8'))
  assert.equal(report.productSha, sha)
  assert.equal(report.productDirty, false)
  assert.equal(report.version, pkg.version)
  assert.equal(report.tarball, `${pkg.name}-${pkg.version}.tgz`)
  const integrity = `sha512-${createHash('sha512')
    .update(readFileSync(join('.cache/release', report.tarball)))
    .digest('base64')}`
  assert.equal(integrity, report.integrity, 'artifact changed after verification')
}
console.log(`Release candidate verified: ${tag} at ${sha}`)
