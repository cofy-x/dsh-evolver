/** Isolated shipped-profile runner; real credentials require explicit live/paid opt-in. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS } from './runtime-e2e/budget.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(
    'Usage: node scripts/runtime-e2e.mjs [harness-checkout] [--deepseek-dry-run | --deepseek-live --allow-paid --model=ID]\nDefault: offline shipped profiles. Dry-run: real DeepSeek adapter, local SSE only. Live requires explicit paid authorization and DEEPSEEK_API_KEY; reports no raw child output. Smoke options: --timeout-ms=1..120000 (lower only); dry-run only: --fault=rate-limit|hang. Input admission uses UTF-8 bytes plus framing allowance, not an authoritative tokenizer. Fixed limits: ' +
      JSON.stringify(LIMITS),
  )
  process.exit(0)
}
const live = args.includes('--deepseek-live')
const optionKeys = args.filter((arg) => arg.startsWith('--')).map((arg) => arg.split('=')[0])
assert.equal(new Set(optionKeys).size, optionKeys.length, 'duplicate options')
const dry = args.includes('--deepseek-dry-run')
const fault = args.find((arg) => arg.startsWith('--fault='))?.slice(8) ?? ''
const timeoutArg = args.find((arg) => arg.startsWith('--timeout-ms='))?.slice(13)
const timeout = timeoutArg === undefined ? LIMITS.timeoutMs : Number(timeoutArg)
assert.ok(
  Number.isSafeInteger(timeout) && timeout > 0 && timeout <= LIMITS.timeoutMs,
  'timeout must be within 1..120000ms',
)
assert.ok(
  !fault || (dry && ['rate-limit', 'hang'].includes(fault)),
  'fault injection requires dry-run',
)
assert.ok(!(live && dry), 'choose one mode')
const modelArg = args.find((arg) => arg.startsWith('--model='))?.slice(8)
assert.ok(
  !live || (args.includes('--allow-paid') && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(modelArg ?? '')),
  'live mode requires --allow-paid and --model=ID',
)
assert.ok(
  live || (!args.includes('--allow-paid') && modelArg === undefined),
  'paid/model flags require live mode',
)
const known = new Set(['--deepseek-live', '--deepseek-dry-run', '--allow-paid'])
assert.ok(
  args.every(
    (arg) =>
      !arg.startsWith('--') ||
      known.has(arg) ||
      ['--model=', '--fault=', '--timeout-ms='].some((prefix) => arg.startsWith(prefix)),
  ),
  'unknown option',
)
const paths = args.filter((arg) => !arg.startsWith('--'))
assert.ok(paths.length <= 1, 'one harness checkout expected')
const harness = resolve(paths[0] ?? '../deepseek-harness')
// This is the only real credential read; all CLI validation precedes it.
const credential = live ? process.env.DEEPSEEK_API_KEY : undefined
assert.ok(!live || credential, 'DEEPSEEK_API_KEY must be supplied by the caller')
const mode = live ? 'live' : dry ? 'transport-fixture' : 'scripted'
const model = live ? modelArg : 'deepseek-v4-flash'
const deadline = Date.now() + timeout
const revision = (cwd) =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
const dirty = (cwd) =>
  execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim().length > 0
const provenance = {
  node: process.version,
  productSha: revision(fileURLToPath(new URL('..', import.meta.url))),
  harnessSha: revision(harness),
  productDirty: dirty(fileURLToPath(new URL('..', import.meta.url))),
  harnessDirty: dirty(harness),
}
const driver = fileURLToPath(new URL('./runtime-e2e/driver.mjs', import.meta.url))
for (const profile of live || dry ? ['headless'] : ['headless', 'web']) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-runtime-'))
  try {
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    for (const phase of profile === 'headless' ? ['scenario', 'recovery'] : ['smoke']) {
      const result = await new Promise((resolveResult, reject) => {
        // Deliberately do not inherit environment credentials, proxies, NODE_OPTIONS, or user profiles.
        const child = spawn(
          process.execPath,
          [driver, harness, profile, root, phase, mode, model, String(deadline), fault],
          {
            cwd: workspace,
            env: {
              PATH: process.env.PATH,
              DSH_HOME: join(root, 'dsh'),
              DSH_AGENTS_HOME: join(root, 'agents'),
              XDG_CONFIG_HOME: join(root, 'config'),
              XDG_CACHE_HOME: join(root, 'cache'),
              DSH_TELEMETRY_DISABLED: '1',
              ...(live
                ? { DEEPSEEK_API_KEY: credential, EVOLVER_LIVE_AUTHORIZED: 'yes' }
                : dry
                  ? { DEEPSEEK_API_KEY: 'OFFLINE_FIXTURE_NOT_A_CREDENTIAL' }
                  : {}),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        )
        let output = ''
        let timedOut = false
        const timer = setTimeout(
          () => {
            timedOut = true
            child.kill('SIGKILL')
          },
          live || dry ? Math.max(1, deadline - Date.now()) : 60_000,
        )
        child.stdout.on('data', (chunk) => {
          if (!live && output.length < 65536) output += chunk
        })
        child.stderr.on('data', (chunk) => {
          if (!live && output.length < 65536) output += chunk
        })
        child.on('error', () => {
          clearTimeout(timer)
          reject(new Error('runtime child failed to spawn'))
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          resolveResult({
            code,
            output: output.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'),
            timedOut,
          })
        })
      })
      process.stdout.write(result.output)
      if ((live || dry) && (result.timedOut || result.code !== 0)) {
        const reserved = await readFile(join(root, 'budget.json'), 'utf8').then(
          JSON.parse,
          () => null,
        )
        console.log(
          JSON.stringify({
            passed: false,
            phase,
            mode,
            timedOut: result.timedOut,
            reserved,
            ...provenance,
          }),
        )
      }
      assert.equal(result.timedOut, false, `${profile} exceeded deadline (including teardown)`)
      assert.equal(result.code, 0, `${profile} runtime failed`)
      if (!live) assert.match(result.output, new RegExp(`EVOLVER_E2E_PASS ${profile}`))
      if (live || dry) {
        const report = JSON.parse(await readFile(join(root, `report-${phase}.json`), 'utf8'))
        assert.equal(report.passed, true)
        console.log(JSON.stringify({ ...report, ...provenance }))
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
