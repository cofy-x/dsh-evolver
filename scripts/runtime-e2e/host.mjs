/** Resolve public host exports once, avoiding mixed Cordis/DSH service identities. */
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateHost } from '../compatibility.mjs'

export function installHostResolution(harness) {
  const manifests = new Map()
  function discover(dir) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (pkg.name?.startsWith('@deepseek-ai/')) manifests.set(pkg.name, manifest)
      return
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !['node_modules', 'lib', 'dist'].includes(entry.name)
      )
        discover(join(dir, entry.name))
    }
  }
  for (const dir of ['packages', 'vendor', 'apps']) discover(join(harness, dir))
  validateHost(manifests)
  let resolving = false
  return registerHooks({
    resolve(specifier, context, next) {
      if (resolving || !specifier.startsWith('@deepseek-ai/')) return next(specifier, context)
      const name = specifier.split('/').slice(0, 2).join('/')
      const manifest = manifests.get(name)
      if (!manifest && name.startsWith('@deepseek-ai/node-addon-')) return next(specifier, context)
      assert.ok(manifest, `host package missing: ${name}`)
      let resolved
      resolving = true
      try {
        resolved = createRequire(manifest).resolve(specifier)
      } finally {
        resolving = false
      }
      return next(resolved, context)
    },
  })
}

/** Test-only removals; runtime/profile services remain shipped implementations. */
export const ISOLATED_ENTRIES = Object.freeze([
  'llm-deepseek',
  'llm-pi-ai',
  'session-title-llm',
  'session-telemetry-otel',
  'llm-retry',
  'skill-filesystem',
  'agent-instructions',
  'web-search-deepseek',
  'web-fetch-http',
  'plan-mode',
  'session-log-deepseek',
  'plugin-package-inventory-deepseek',
])
