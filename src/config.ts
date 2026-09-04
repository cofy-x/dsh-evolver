/** Loader configuration and deployment bounds. @module dsh-evolver/config */

import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'

/** User-configurable plugin settings. */
export interface Config {
  readonly dataDir?: string
  readonly maxEvidenceChars?: number
  readonly maxPromotedStrategies?: number
}

/** Fully resolved settings used by runtime modules. */
export interface ResolvedConfig {
  readonly dataDir: string
  readonly maxEvidenceChars: number
  readonly maxPromotedStrategies: number
}

/** Loader-visible schema. */
export const Config = z.object({
  dataDir: z.string(),
  maxEvidenceChars: z.natural().default(512),
  maxPromotedStrategies: z.natural().default(8),
}) as unknown as z<Config>

function positiveSafe(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`dsh-evolver: ${field} must be a positive safe integer`)
  }
  return value
}

/** Resolve defaults and reject unsafe storage or prompt bounds. */
export function resolveConfig(config: Config): ResolvedConfig {
  const maxEvidenceChars = positiveSafe(config.maxEvidenceChars ?? 512, 'maxEvidenceChars')
  if (maxEvidenceChars > 4_096) {
    throw new Error('dsh-evolver: maxEvidenceChars must not exceed 4096')
  }
  const maxPromotedStrategies = positiveSafe(
    config.maxPromotedStrategies ?? 8,
    'maxPromotedStrategies',
  )
  if (maxPromotedStrategies > 32) {
    throw new Error('dsh-evolver: maxPromotedStrategies must not exceed 32')
  }
  const dataDir = config.dataDir ?? join(resolveDshHome(), 'evolver')
  if (dataDir.trim().length === 0) throw new Error('dsh-evolver: dataDir must be non-blank')
  return { dataDir, maxEvidenceChars, maxPromotedStrategies }
}
