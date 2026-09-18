import { createRequire } from 'node:module'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)
const pkg = require('./package.json') as { dependencies: Record<string, string> }

/**
 * Runtime `require`s rather than bundled code. StockFlow has no native modules and no
 * browser to drive, so this list is short — but `externalizeDepsPlugin` does not work
 * under vite 8, so the predicate is built by hand from package.json.
 *
 * ESM-only helpers are deliberately excluded so they get bundled into the CJS main
 * output instead of being `require`d, which would throw at runtime.
 */
const BUNDLE_ANYWAY = new Set(['nanoid'])
const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  'electron',
  ...Object.keys(pkg.dependencies).filter((dep) => !BUNDLE_ANYWAY.has(dep))
]

/** Matches a bare specifier or any subpath import of an external package. */
const external = (id: string): boolean =>
  nodeExternals.some((dep) => id === dep || id.startsWith(`${dep}/`))

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'out/main',
      minify: false,
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        external,
        // Electron's main process needs CJS, and rolldown silently emits an *empty*
        // chunk for this entry when the format is left as ESM — so pin it explicitly.
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      minify: false,
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        external,
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
