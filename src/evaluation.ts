/** Pure deterministic effectiveness calculations. @module dsh-evolver/evaluation */

import type { EvolutionEvaluation } from './domain.ts'

/** Recalculate an evaluation without claiming significance beyond its configured heuristic. */
export function evaluateEffectiveness(
  evaluation: Omit<EvolutionEvaluation, 'verdict' | 'failureRateDelta'>,
): EvolutionEvaluation {
  const { baseline, treatment, minimumSamples, regressionThreshold } = evaluation
  if (baseline.total < minimumSamples || treatment.total < minimumSamples) {
    return { ...evaluation, verdict: 'insufficient' }
  }
  const delta = treatment.failed / treatment.total - baseline.failed / baseline.total
  const verdict =
    delta <= -regressionThreshold
      ? 'improved'
      : delta >= regressionThreshold
        ? 'regressed'
        : 'neutral'
  return { ...evaluation, verdict, failureRateDelta: delta }
}
