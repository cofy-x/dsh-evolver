/** Fail the normal quality gate on incompatible or partially upgraded installed dependencies. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import semver from 'semver'
import { compatibilityContract, productManifest } from './compatibility.mjs'

const require = createRequire(new URL('../package.json', import.meta.url))
const { baseline, range, development } = compatibilityContract()
for (const [name, version] of Object.entries(productManifest.devDependencies).filter(([name]) =>
  name.startsWith('@deepseek-ai/'),
)) {
  const installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
  assert.equal(
    installed.version,
    version,
    `${name}: installed version differs from development pin`,
  )
  for (const [peer, wanted] of Object.entries(installed.peerDependencies ?? {})) {
    if (!(peer in productManifest.devDependencies)) continue
    assert.ok(
      semver.satisfies(productManifest.devDependencies[peer], wanted),
      `${name}: incompatible development peer ${peer}`,
    )
  }
}
console.log(
  `DSH compatibility: ${development.length} coherent pins at ${baseline}; supported ${range}`,
)
