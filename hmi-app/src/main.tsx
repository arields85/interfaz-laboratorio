import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { applySharedConfigToDocument, startSharedConfigReapply } from './app/sharedConfigAppliers'
import { cleanupLegacyStorage } from './utils/legacyStorageCleanup'
import { prismaSessionClient } from './services/prismaSessionClient'
import { sharedConfigStorage } from './services/sharedConfigStorage.service'
import { startPrismaVoiceTimelineDiagnostics } from './services/prismaVoiceTimelineDiagnosticsSink'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      refetchOnWindowFocus: false, // HMI industrial: no refetch on alt-tab
    },
  },
})

// The static boot shield in index.html stays visible while the shared configuration
// loads, so no extra loading state is rendered: routes only mount once the document
// (server, cache copy or empty) is in memory and the configuration appliers can read it.
async function bootstrap(): Promise<void> {
  await sharedConfigStorage.load()
  sharedConfigStorage.startPolling()

  cleanupLegacyStorage()
  applySharedConfigToDocument()
  // Another browser's saved change reaches this one within a poll interval and is applied live.
  startSharedConfigReapply({ queryClient })
  void prismaSessionClient.bootstrap().catch(() => undefined)
  // T16: registered before the session-reset pagehide listener below, so its
  // own pagehide flush (browser voice timeline diagnostics) runs first --
  // listeners on the same target/event fire in registration order, and once
  // the session resets its capability is gone.
  startPrismaVoiceTimelineDiagnostics()
  window.addEventListener('pagehide', () => prismaSessionClient.reset({ keepalive: true }), { once: true })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
