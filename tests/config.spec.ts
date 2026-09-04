import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('resolveConfig()', () => {
  it('resolves explicit storage and prompt bounds', () => {
    expect(
      resolveConfig({
        dataDir: '/tmp/evolver-test',
        maxEvidenceChars: 100,
        maxPromotedStrategies: 2,
        evaluationWindowSize: 10,
        minimumEvaluationSamples: 3,
        regressionThreshold: 0.2,
      }),
    ).toEqual({
      dataDir: '/tmp/evolver-test',
      maxEvidenceChars: 100,
      maxPromotedStrategies: 2,
      evaluationWindowSize: 10,
      minimumEvaluationSamples: 3,
      regressionThreshold: 0.2,
    })
  })

  it.each([
    [{ maxEvidenceChars: 0 }, 'maxEvidenceChars'],
    [{ maxEvidenceChars: 4_097 }, 'maxEvidenceChars'],
    [{ maxPromotedStrategies: 0 }, 'maxPromotedStrategies'],
    [{ maxPromotedStrategies: 33 }, 'maxPromotedStrategies'],
    [{ evaluationWindowSize: 201 }, 'evaluationWindowSize'],
    [{ evaluationWindowSize: 4, minimumEvaluationSamples: 5 }, 'minimumEvaluationSamples'],
    [{ regressionThreshold: 0 }, 'regressionThreshold'],
    [{ regressionThreshold: 1.1 }, 'regressionThreshold'],
    [{ dataDir: ' ' }, 'dataDir'],
  ] as const)('rejects invalid config %j', (config, expected) => {
    expect(() => resolveConfig(config)).toThrow(expected)
  })
})
