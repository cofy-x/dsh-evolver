/** Development-only release-line policy; package.json owns the selected baseline. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import semver from 'semver'

export const productManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const isDsh = (name) => name.startsWith('@deepseek-ai/dsh-')

/** Validate exact, coherent development pins and an explicit prerelease-aware support line. */
export function compatibilityContract(pkg = productManifest) {
  const development = Object.entries(pkg.devDependencies).filter(([name]) => isDsh(name))
  assert.ok(development.length > 0, 'missing DSH development baseline')
  const baseline = development[0][1]
  assert.equal(
    semver.valid(baseline),
    baseline,
    'DSH development dependencies must be exact versions',
  )
  assert.ok(
    development.every(([, version]) => version === baseline),
    'mixed DSH development releases',
  )
  const parsed = semver.parse(baseline)
  const nextLine = `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-0`
  const range = `>=${baseline} <${nextLine}`
  const peers = Object.entries(pkg.peerDependencies).filter(([name]) => isDsh(name))
  assert.ok(peers.length > 0)
  for (const [name, declared] of peers) {
    assert.equal(pkg.devDependencies[name], baseline, `${name}: missing exact development pin`)
    assert.equal(declared, range, `${name}: support must be limited to the selected release line`)
    assert.ok(
      semver.satisfies(baseline, declared),
      `${name}: peer range excludes tested prerelease`,
    )
    assert.equal(semver.satisfies(nextLine, declared), false)
  }
  return { baseline, range, development }
}

/** Check host peer compatibility and coherent DSH service identities before profile boot. */
export function validateHost(manifests, pkg = productManifest) {
  const contract = compatibilityContract(pkg)
  const read = (name) => {
    assert.ok(manifests.has(name), `host package missing: ${name}`)
    return JSON.parse(readFileSync(manifests.get(name), 'utf8'))
  }
  const hostVersion = read('@deepseek-ai/dsh-agent').version
  for (const [name, range] of Object.entries(pkg.peerDependencies))
    assert.ok(
      semver.satisfies(read(name).version, range),
      `${name}: unsupported host version; expected ${range}`,
    )
  for (const [name] of contract.development)
    assert.equal(read(name).version, hostVersion, `${name}: mixed host DSH releases`)
  return { ...contract, hostVersion }
}
