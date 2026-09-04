/** Versioned deterministic failure-pattern signatures. @module dsh-evolver/pattern */

import { createHash } from 'node:crypto'
import { failurePatternId, type FailurePatternId, type FailurePatternKeyVersion } from './domain.ts'

/** The immutable key algorithm used for newly observed patterns. */
export const FAILURE_PATTERN_KEY_VERSION: FailurePatternKeyVersion = 'failure-pattern-v1'

/** Remove common instance-specific differences without attempting semantic similarity. */
export function canonicalizeFailureSummary(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, '<url>')
    .replace(/\/(?:users|home)\/[^/\s]+/gu, '/<home>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gu, '<uuid>')
    .replace(/\b[0-9a-f]{8,}\b/gu, '<hex>')
    .replace(/\b\d+\b/gu, '<number>')
    .replace(/<redacted>/gu, '<credential>')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Exact versioned signature and deterministic identifier for one validated failure. */
export interface FailurePatternSignature {
  readonly id: FailurePatternId
  readonly keyVersion: FailurePatternKeyVersion
  readonly canonicalSummary: string
}

/** Hash a JSON tuple so version and field boundaries cannot be concatenation-ambiguous. */
export function deriveFailurePatternSignature(
  toolName: string,
  errorCode: string,
  boundedSummary: string,
): FailurePatternSignature {
  const canonicalSummary = canonicalizeFailureSummary(boundedSummary)
  const digest = createHash('sha256')
    .update(JSON.stringify([FAILURE_PATTERN_KEY_VERSION, toolName, errorCode, canonicalSummary]))
    .digest('hex')
  return Object.freeze({
    id: failurePatternId(`fp1_${digest}`),
    keyVersion: FAILURE_PATTERN_KEY_VERSION,
    canonicalSummary,
  })
}
