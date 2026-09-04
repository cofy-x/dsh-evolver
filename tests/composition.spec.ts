import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { afterEach, describe, expect, it } from 'vitest'
import * as EvolverPlugin from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const TestCommands = {
  name: 'test-commands',
  apply(ctx: Context) {
    const commands: CommandDefinition[] = []
    ctx.provide('commands', {
      register(definition: CommandDefinition) {
        commands.push(definition)
        return () => {
          const index = commands.indexOf(definition)
          if (index >= 0) commands.splice(index, 1)
        }
      },
      definitions: commands,
    } as unknown as CommandRuntime)
  },
}

async function boot(profile: 'Web' | 'Headless'): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), `dsh-evolver-${profile.toLowerCase()}-`))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(
    configPath,
    [
      `# ${profile} profile fixture after applying cordis.patch.yml`,
      '- name: test-commands',
      '- id: dsh-evolver',
      '  name: dsh-evolver',
      '  config:',
      `    dataDir: ${JSON.stringify(join(root, 'data'))}`,
      '',
    ].join('\n'),
  )
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-commands', TestCommands],
    ['dsh-evolver', EvolverPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('Web and Headless Loader composition', () => {
  it.each(['Web', 'Headless'] as const)('boots the optional %s profile patch', async (profile) => {
    const ctx = await boot(profile)
    expect(ctx.get('evolver')).toBeDefined()
    const commands = ctx.commands as unknown as { definitions: CommandDefinition[] }
    expect(commands.definitions.map((command) => command.name)).toEqual(['evolve'])
  })
})
