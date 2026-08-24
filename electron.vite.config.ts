import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

/** Minimal `.env` reader so build-time secrets need no extra dependency. */
function loadDotEnv(file = '.env'): void {
  const path = resolve(file)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line)
    if (!match || line.trimStart().startsWith('#')) continue
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

loadDotEnv('.env.local')
loadDotEnv('.env')

/**
 * Antigravity's desktop OAuth client is baked into the Antigravity binary, so
 * it has to be supplied to reach Google's token endpoint. It is kept out of the
 * repo (GitHub's secret scanner flags Google client secrets regardless of
 * RFC 8252 §8.5) and injected from the environment at build time instead.
 * See `.env.example`.
 */
const antigravityOAuth = {
  __ANTIGRAVITY_CLIENT_ID__: JSON.stringify(process.env.HELM_ANTIGRAVITY_CLIENT_ID ?? ''),
  __ANTIGRAVITY_CLIENT_SECRET__: JSON.stringify(process.env.HELM_ANTIGRAVITY_CLIENT_SECRET ?? '')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    define: antigravityOAuth,
    build: {
      rollupOptions: {
        // heavy deps stay external (loaded from node_modules at runtime)
        external: ['sql.js', 'playwright-core']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    }
  }
})
