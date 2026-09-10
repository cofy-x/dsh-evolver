/** Pack once, install the actual artifact outside the checkout, and test its public surface. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveHarness } from './harness-source.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
assert.ok(
  args.every((arg) => arg === '--runtime' || (arg.startsWith('--harness=') && arg.length > 10)),
  'expected --runtime or --harness=PATH',
)
assert.ok(args.length <= 1)
const harness = args.length
  ? resolveHarness(args[0] === '--runtime' ? undefined : args[0].slice(10))
  : undefined
assert.equal(pkg.name, 'dsh-evolver')
assert.notEqual(pkg.private, true)
assert.equal(pkg.publishConfig.tag, 'alpha')
assert.match(pkg.version, /^\d+\.\d+\.\d+-alpha\.\d+$/)
const output = join(root, '.cache', 'release')
mkdirSync(output, { recursive: true })
const [packed] = JSON.parse(
  execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
    cwd: root,
    encoding: 'utf8',
  }),
)
const files = new Set(packed.files.map((file) => file.path))
for (const name of [
  'package.json',
  'LICENSE',
  'README.md',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/domain.js',
  'lib/store.js',
  'lib/types/index.d.ts',
])
  assert.ok(files.has(name), `missing package file: ${name}`)
for (const name of files)
  assert.ok(
    !/(^|\/)(node_modules|\.cache|\.git|\.env)(\/|$)/.test(name),
    `unexpected package file: ${name}`,
  )
const tarball = join(output, packed.filename)
const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
assert.equal(integrity, packed.integrity)
const scratch = mkdtempSync(join(tmpdir(), 'evolver-package-'))
try {
  // A fresh consumer receives only the archive and explicit public host peers, not source links.
  const peers = Object.fromEntries(
    Object.entries(pkg.devDependencies).filter(([name]) => name.startsWith('@deepseek-ai/')),
  )
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { ...peers, 'dsh-evolver': `file:${tarball}` },
    }),
  )
  const env = {
    PATH: process.env.PATH,
    HOME: scratch,
    npm_config_userconfig: join(scratch, 'empty.npmrc'),
    npm_config_cache: join(scratch, 'npm-cache'),
  }
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
    ],
    { cwd: scratch, env, stdio: 'inherit', timeout: 180000 },
  )
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import assert from 'node:assert/strict'; const m = await import('dsh-evolver'); assert.equal(m.name, 'dsh-evolver'); assert.equal(typeof m.apply, 'function'); assert.equal(typeof m.EvolutionStore, 'function'); await import('dsh-evolver/domain'); await import('dsh-evolver/store')",
    ],
    { cwd: scratch, env, stdio: 'inherit' },
  )
  const installed = join(scratch, 'node_modules/dsh-evolver')
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(
    readFileSync(join(installed, 'cordis.patch.yml'), 'utf8'),
    readFileSync(join(root, 'cordis.patch.yml'), 'utf8'),
  )
  writeFileSync(
    join(scratch, 'consumer.mts'),
    "import { EvolutionStore, type EvolutionState } from 'dsh-evolver'; import { proposalId } from 'dsh-evolver/domain'; import { EvolutionStore as Store } from 'dsh-evolver/store'; const state: EvolutionState = (await EvolutionStore.open('unused')).snapshot(); void [state, Store, proposalId('example')];\n",
  )
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2023',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      join(scratch, 'consumer.mts'),
    ],
    { cwd: scratch, env, stdio: 'inherit' },
  )
  if (harness)
    execFileSync(
      process.execPath,
      [
        join(root, 'scripts/runtime-e2e.mjs'),
        harness,
        `--package-dir=${join(scratch, 'node_modules/dsh-evolver')}`,
      ],
      { cwd: root, env, stdio: 'inherit', timeout: 180000 },
    )
  const report = {
    node: process.version,
    version: pkg.version,
    tarball: packed.filename,
    integrity,
    productSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    productDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    ),
    runtime: Boolean(harness),
    ...(harness
      ? {
          harnessSha: execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: harness,
            encoding: 'utf8',
          }).trim(),
        }
      : {}),
  }
  writeFileSync(join(output, 'verified.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
