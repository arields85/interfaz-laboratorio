// =============================================================================
// App — punto de entrada de la aplicación.
// El routing está definido en src/app/router.tsx.
// Los providers (QueryClient, BrowserRouter) viven en src/main.tsx.
// Arquitectura Técnica v1.3 §7.1
// =============================================================================
import AppRouter from './app/router';
import PrismaOrbOverlay from './components/PrismaOrbOverlay';
import { useBootShield } from './hooks/useBootShield';
import { usePrismaOrbPresentation } from './hooks/usePrismaOrbPresentation';
import { usePrismaOrbVisualConfig } from './hooks/usePrismaOrbVisualConfig';
import { useReloadShield } from './hooks/useReloadShield';
import { useVoiceEventListener } from './hooks/useVoiceEventListener';
import type { VoiceEvent } from './domain/voice.types';

function logVoiceEvent(event: VoiceEvent): void {
    console.log(`HMI voice event received: ${event.text}`);
}

export default function App() {
    const prismaOrb = usePrismaOrbPresentation();
    const prismaOrbVisualConfig = usePrismaOrbVisualConfig();

    useBootShield();
    useReloadShield();
    useVoiceEventListener((event) => {
        logVoiceEvent(event);
        prismaOrb.presentVoiceEvent(event);
    });

    return (
        <>
            <AppRouter />
            <PrismaOrbOverlay
                phase={prismaOrb.phase}
                orbRef={prismaOrb.orbRef}
                config={prismaOrbVisualConfig}
            />
        </>
    );
}
