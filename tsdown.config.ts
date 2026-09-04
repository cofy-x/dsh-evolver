import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/domain.ts', 'src/store.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  clean: false,
  dts: false,
  deps: { neverBundle: (specifier) => specifier.startsWith('@deepseek-ai/') },
})
