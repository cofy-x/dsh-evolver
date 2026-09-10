/** Isolated Git fixtures prove release guards without touching real refs or a registry. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('release checks require clean synchronized annotated candidate and unmodified artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'evolver-release-test-'))
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Release Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    writeFileSync(join(root, '.gitignore'), '.cache/\n')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    const sha = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', sha)
    const script = fileURLToPath(new URL('./check-release.mjs', import.meta.url))
    const check = (...args) =>
      spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' }).status
    assert.notEqual(check(), 0, 'missing tag must fail')
    git('-c', 'tag.gpgsign=false', 'tag', '-a', `v${pkg.version}`, '-m', 'fixture')
    assert.equal(check(), 0)
    writeFileSync(join(root, 'dirty'), 'dirty')
    assert.notEqual(check(), 0, 'dirty checkout must fail')
    rmSync(join(root, 'dirty'))
    const output = join(root, '.cache/release')
    mkdirSync(output, { recursive: true })
    const tarball = `${pkg.name}-${pkg.version}.tgz`
    writeFileSync(join(output, tarball), 'fixture archive')
    const report = {
      version: pkg.version,
      tarball,
      productSha: sha,
      productDirty: false,
      integrity: `sha512-${createHash('sha512').update('fixture archive').digest('base64')}`,
    }
    writeFileSync(join(output, 'verified.json'), JSON.stringify(report))
    assert.equal(check('--artifact'), 0)
    writeFileSync(join(output, tarball), 'changed')
    assert.notEqual(check('--artifact'), 0, 'changed artifact must fail')
    git('update-ref', '-d', 'refs/remotes/origin/main')
    assert.notEqual(check(), 0, 'missing synchronized ref must fail')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
