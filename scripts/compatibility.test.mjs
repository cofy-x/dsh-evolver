import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import semver from 'semver'
import { compatibilityContract, productManifest, validateHost } from './compatibility.mjs'

test('host validation rejects missing, mixed, and unsupported releases before boot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'evolver-compatibility-'))
  try {
    const manifests = new Map()
    for (const [name, version] of Object.entries(productManifest.devDependencies)) {
      const path = join(directory, `${manifests.size}.json`)
      writeFileSync(path, JSON.stringify({ name, version }))
      manifests.set(name, path)
    }
    assert.equal(validateHost(manifests).baseline, compatibilityContract().baseline)
    const name = '@deepseek-ai/dsh-session-projection'
    const path = manifests.get(name)
    writeFileSync(path, JSON.stringify({ name, version: '0.0.0' }))
    assert.throws(() => validateHost(manifests), /mixed host DSH releases/)
    manifests.delete(name)
    assert.throws(() => validateHost(manifests), /host package missing/)
    writeFileSync(manifests.get('@deepseek-ai/dsh-agent'), JSON.stringify({ version: '0.0.0' }))
    assert.throws(() => validateHost(manifests), /unsupported host version/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the declared line admits the pinned prerelease and stable release but not adjacent lines', () => {
  const { baseline, range } = compatibilityContract()
  const v = semver.parse(baseline)
  assert.ok(semver.satisfies(baseline, range))
  assert.ok(semver.satisfies(`${v.major}.${v.minor}.${v.patch}`, range))
  assert.equal(semver.satisfies(`${v.major}.${v.minor}.${v.patch + 1}-alpha.1`, range), false)
  assert.equal(semver.satisfies(`${v.major}.${v.minor}.${v.patch + 1}`, range), false)
  assert.equal(semver.satisfies('0.1.2-rc.1', range), false)
})

test('partial upgrades, floating pins, and broad prerelease-excluding peers fail closed', () => {
  for (const change of [
    (p) => {
      p.devDependencies['@deepseek-ai/dsh-session'] = '0.1.2-rc.1'
    },
    (p) => {
      p.devDependencies['@deepseek-ai/dsh-agent'] = '^0.1.5-alpha.2'
    },
    (p) => {
      p.peerDependencies['@deepseek-ai/dsh-agent'] = '>=0.1.2-rc.1 <0.2.0'
    },
  ]) {
    const pkg = structuredClone(productManifest)
    change(pkg)
    assert.throws(() => compatibilityContract(pkg))
  }
})
