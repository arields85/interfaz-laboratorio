import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const enforceCoverageThresholds = mode !== 'coverage-focused'

  return {
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
