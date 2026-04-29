// =============================================================================
// App — punto de entrada de la aplicación.
// El routing está definido en src/app/router.tsx.
// Los providers (QueryClient, BrowserRouter) viven en src/main.tsx.
// Arquitectura Técnica v1.3 §7.1
// =============================================================================
import AppRouter from './app/router';
import { useBootShield } from './hooks/useBootShield';
import { useReloadShield } from './hooks/useReloadShield';

export default function App() {
    useBootShield();
    useReloadShield();

    return <AppRouter />;
}
