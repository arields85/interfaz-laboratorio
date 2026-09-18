import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { applyThemeOverrides } from './components/admin/DesignSettingsTab'
import { cleanupLegacyStorage } from './utils/legacyStorageCleanup'
import { prismaSessionClient } from './services/prismaSessionClient'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      refetchOnWindowFocus: false, // HMI industrial: no refetch on alt-tab
    },
  },
})

cleanupLegacyStorage()
applyThemeOverrides()
void prismaSessionClient.bootstrap().catch(() => undefined)
window.addEventListener('pagehide', () => prismaSessionClient.reset({ keepalive: true }), { once: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
