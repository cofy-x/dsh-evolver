/** Development-only release-line policy; package.json owns the selected baseline. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import semver from 'semver'

export const productManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
export const harnessSource = JSON.parse(
  readFileSync(new URL('./harness-source.json', import.meta.url), 'utf8'),
)
const isDsh = (name) => name.startsWith('@deepseek-ai/dsh-')

/** Validate exact, coherent development pins and an explicit prerelease-aware support line. */
export function compatibilityContract(pkg = productManifest, source = harnessSource) {
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
  assert.equal(source.version, baseline, 'source release must match the DSH development baseline')
  assert.equal(source.repository, 'https://github.com/deepseek-ai/deepseek-harness.git')
  assert.equal(source.tag, `dsh-v${baseline}`, 'source tag must identify the selected release')
  assert.match(source.commit, /^[a-f0-9]{40}$/, 'source release requires an exact commit')
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

/** Validate the resolved DSH dependency/peer closure, including nested package instances. */
export function validateInstalledClosure(resolveManifest, pkg = productManifest) {
  const { baseline, development } = compatibilityContract(pkg)
  const visited = new Set()
  function visit(name, parent) {
    assert.equal(pkg.devDependencies[name], baseline, `missing development pin for ${name}`)
    const { path, manifest } = resolveManifest(name, parent)
    if (visited.has(path)) return
    visited.add(path)
    assert.equal(manifest.name, name)
    assert.equal(manifest.version, baseline, `${name}: mixed installed DSH releases`)
    for (const child of new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]))
      if (isDsh(child)) visit(child, path)
  }
  for (const [name] of development) visit(name)
  return visited.size
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
