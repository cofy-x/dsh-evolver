/** Frozen, descriptive heldout design. It neither trains candidates nor changes the grader. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TASKS, VERSION } from './tasks.mjs'
import { hash, schedule } from './report.mjs'
import { PROTOCOL_VERSION } from './protocol.mjs'
import { MODEL, LIVE_LIMITS } from './experiment-ledger.mjs'

export async function frozenPlan(stateDir, implementationHash, harnessSha) {
  const training = JSON.parse(await readFile(join(stateDir, 'training.json'), 'utf8'))
  const recovery = JSON.parse(await readFile(join(stateDir, 'recovery.json'), 'utf8'))
  assert.ok(
    training.implementationUnchanged &&
      training.rows.length === 3 &&
      training.rows.every(
        (r) =>
          r.success && r.lifecycle.trainingFromRealToolFailure && r.lifecycle.acceptedByCommand,
      ),
  )
  assert.ok(
    recovery.implementationUnchanged &&
      recovery.rows.every((r) => r.success && r.lifecycle.restartReplay),
  )
  const candidates = await Promise.all(
    training.rows.map(async (r) => {
      const family = TASKS.find((t) => t.id === r.taskId).family
      const journal = await readFile(join(stateDir, 'seeds', family, 'audit-v1.jsonl'), 'utf8')
      return {
        family,
        seedHash: hash(journal),
        selected: r.selected,
        provenance: r.lifecycle.provenance,
      }
    }),
  )
  const tasks = TASKS.filter((t) => t.split === 'heldout' && /-[12]$/.test(t.id))
  return {
    version: 'experience-heldout-v1',
    taskVersion: VERSION,
    protocol: PROTOCOL_VERSION,
    fixtureHash: hash(TASKS),
    implementationHash,
    harnessSha,
    model: MODEL,
    limits: LIVE_LIMITS,
    strategy:
      'Unchanged generic deterministic proposer; conditional guidance names the origin tool/error code. No recovery catalogue, LLM proposer, automatic review or strategy tuning.',
    partitions:
      'Development trains controlled real-model failure drills; original pilot remains unchanged; heldout instances 1 and 2 per family are evaluated once. No heldout live outcomes used to select candidates.',
    trainingMode: training.mode,
    candidates,
    scheduleSeed: 17,
    primary:
      'Unchanged exact-state grade(task, state), AND normal termination within budgets. Goal reached followed by budget exhaustion remains unsuccessful.',
    costs: [
      'requests',
      'tool calls',
      'repeated identical invalid calls',
      'reserved input admission units (not tokens)',
      'reported input including cache tokens',
      'reported output tokens',
      'child elapsed milliseconds',
    ],
    integrity:
      'Same accepted journal, initial state, protocol, model and first adapter/wire request excluding only promoted guidance; each arm has a fresh process and Session. Only treatment is promoted with public commands.',
    stopping:
      'Zero retries and no replacement. Six requests, ten tool operations and 90 seconds per arm; shared ledger and 30-second request deadline apply. Stop after two consecutive infrastructure-invalid runs. Retain every planned run, including failures, timeouts, invalid and not-run. No strategy changes or retests in this version.',
    analysis:
      'Six descriptive pairs; report both-success, treatment-only, baseline-only, both-failed and invalid counts, success-rate and cost deltas. No significance, equivalence or generalized effectiveness claim.',
    runs: schedule(tasks, 17).map((r) => ({
      ...r,
      id: `${PROTOCOL_VERSION}:heldout-v1:${r.taskId}:${r.arm}`,
      stage: 'evaluation',
      requestLimit: 6,
      toolLimit: 10,
      outputCap: 1024,
    })),
  }
}
