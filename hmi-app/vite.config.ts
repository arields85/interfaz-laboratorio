import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createLedaProxyConfig } from './vite.ledaProxy.config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const enforceCoverageThresholds = mode !== 'coverage-focused'

  return {
    // T4c: Vite clears the terminal on dev server start by default, which erases the
    // launcher's own pre-Vite messages (e.g. start-local.ps1's "Leda could not start:
    // port ... is in use by ..." warning, printed by dev.mjs before it ever spawns Vite).
    // See https://vite.dev/config/shared-options.html#clearscreen.
    clearScreen: false,
    server: {
      // T18b: fixed ports 5056/5057/5173 are a project-wide contract
      // (odd/tasks/pw-006-leda-responsiveness.md). Without strictPort, a still-shutting-down
      // previous Vite dev server left listening on 5173 makes Vite silently fall back to
      // 5174+ instead of failing loudly -- the browser (fixed on 5173) then sees
      // ERR_CONNECTION_REFUSED with no indication Vite moved. dev.mjs's leftover-listener
      // guard stops a verified previous Vite of this repo before this ever matters; strictPort
      // is the defense-in-depth backstop so a busy port is always a clear failure, never a
      // silent port drift.
      strictPort: true,
      proxy: createLedaProxyConfig(),
    },
    plugins: [
      tailwindcss(),
      react()
    ],
    test: {
      allowOnly: false,
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: enforceCoverageThresholds ? 'coverage' : '.coverage-focused',
        ...(enforceCoverageThresholds
          ? {
              thresholds: {
                lines: 70,
                branches: 70,
                functions: 70,
                statements: 70,
              },
            }
          : {}),
        exclude: [
          'src/main.tsx',
          'src/vite-env.d.ts',
          '**/*.d.ts',
          'src/test/**',
          'src/mocks/**',
        ],
      },
    },
  }
})
