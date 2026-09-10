/** One credential-free, isolated experience lifecycle with a single persistent ledger. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const controller = fileURLToPath(new URL('../experience.mjs', import.meta.url))
const state = await mkdtemp(join(tmpdir(), 'experience-loop-'))
try {
  for (const phase of [
    'development',
    'training',
    'lifecycle',
    'recovery',
    'freeze',
    'evaluation',
  ]) {
    if (phase === 'evaluation') {
      const planPath = join(state, 'plan.json')
      const original = await readFile(planPath, 'utf8')
      const altered = JSON.parse(original)
      altered.runs[0].requestLimit++
      await writeFile(planPath, JSON.stringify(altered))
      const ledger = await readFile(join(state, 'budget.json'), 'utf8')
      const rejected = spawnSync(
        process.execPath,
        [
          controller,
          '--mode=offline',
          '--phase=evaluation',
          `--state=${state}`,
          `--plan=${planPath}`,
        ],
        {
          env: { PATH: process.env.PATH, DSH_TEST_HARNESS: process.env.DSH_TEST_HARNESS },
          encoding: 'utf8',
          timeout: 10000,
        },
      )
      assert.notEqual(rejected.status, 0)
      assert.equal(await readFile(join(state, 'budget.json'), 'utf8'), ledger)
      await writeFile(planPath, original)
    }
    const child = spawnSync(
      process.execPath,
      [
        controller,
        '--mode=offline',
        `--phase=${phase}`,
        `--state=${state}`,
        ...(['freeze', 'evaluation'].includes(phase) ? [`--plan=${join(state, 'plan.json')}`] : []),
      ],
      {
        env: { PATH: process.env.PATH, DSH_TEST_HARNESS: process.env.DSH_TEST_HARNESS },
        encoding: 'utf8',
        timeout: 120000,
      },
    )
    const report = JSON.parse(child.stdout)
    if (phase === 'freeze') {
      assert.equal(child.status, 0)
      assert.equal(report.pairs, 6)
      continue
    }
    assert.equal(
      child.status,
      0,
      JSON.stringify({ phase, rows: report.rows, budget: report.budget }),
    )
    assert.ok(report.implementationUnchanged)
    if (phase === 'evaluation') {
      assert.equal(report.summary.validPairs, 6)
      assert.equal(report.summary.successRateDelta, 0)
    }
    console.log(
      JSON.stringify({
        phase,
        rows: report.rows.map((r) => ({ success: r.success, lifecycle: r.lifecycle })),
        budget: report.budget,
      }),
    )
  }
} finally {
  await rm(state, { recursive: true, force: true })
}
