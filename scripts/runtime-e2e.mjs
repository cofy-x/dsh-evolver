/** Run shipped profile tests in credential-free, isolated child processes. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const harness = resolve(process.argv[2] ?? '../deepseek-harness')
const driver = fileURLToPath(new URL('./runtime-e2e/driver.mjs', import.meta.url))
for (const profile of ['headless', 'web']) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolver-runtime-'))
  try {
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    for (const phase of profile === 'headless' ? ['scenario', 'recovery'] : ['smoke']) {
      const result = await new Promise((resolveResult, reject) => {
        // Deliberately do not inherit environment credentials, proxies, NODE_OPTIONS, or user profiles.
        const child = spawn(process.execPath, [driver, harness, profile, root, phase], {
          cwd: workspace,
          env: {
            PATH: process.env.PATH,
            DSH_HOME: join(root, 'dsh'),
            DSH_AGENTS_HOME: join(root, 'agents'),
            XDG_CONFIG_HOME: join(root, 'config'),
            XDG_CACHE_HOME: join(root, 'cache'),
            DSH_TELEMETRY_DISABLED: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let output = ''
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, 60_000)
        child.stdout.on('data', (chunk) => {
          output += chunk
        })
        child.stderr.on('data', (chunk) => {
          output += chunk
        })
        child.on('error', reject)
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
      assert.equal(result.timedOut, false, `${profile} process exceeded 60s (including teardown)`)
      assert.equal(result.code, 0, `${profile} runtime failed`)
      assert.match(result.output, new RegExp(`EVOLVER_E2E_PASS ${profile}`))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
