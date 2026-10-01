// =============================================================================
// App — punto de entrada de la aplicación.
// El routing está definido en src/app/router.tsx.
// Los providers (QueryClient, BrowserRouter) viven en src/main.tsx.
// Arquitectura Técnica v1.3 §7.1
// =============================================================================
import AppRouter from './app/router';
import LedaOrbOverlay from './components/LedaOrbOverlay';
import { useAutomaticViewportZoom } from './hooks/useAutomaticViewportZoom';
import { useBootShield } from './hooks/useBootShield';
import { useHiddenAccessShortcut } from './hooks/useHiddenAccessShortcut';
import { useLedaOrbPresentation } from './hooks/useLedaOrbPresentation';
import { useLedaOrbVisualConfig } from './hooks/useLedaOrbVisualConfig';
import { useReloadShield } from './hooks/useReloadShield';
import { useVoiceEventListener } from './hooks/useVoiceEventListener';
import type { VoiceEvent } from './domain/voice.types';

function logVoiceEvent(event: VoiceEvent): void {
    console.log(`HMI voice event received: ${event.text}`);
}

export default function App() {
    const ledaOrb = useLedaOrbPresentation();
    const ledaOrbVisualConfig = useLedaOrbVisualConfig();

    useAutomaticViewportZoom();
    useBootShield();
    useReloadShield();
    useHiddenAccessShortcut();
    useVoiceEventListener((event) => {
        logVoiceEvent(event);
        ledaOrb.presentVoiceEvent(event);
    });

    return (
        <>
            <AppRouter />
            <LedaOrbOverlay
                phase={ledaOrb.phase}
                orbRef={ledaOrb.orbRef}
                config={ledaOrbVisualConfig}
            />
        </>
    );
}
