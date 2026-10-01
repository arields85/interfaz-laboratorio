import { create } from 'zustand';

// =============================================================================
// STORE: Link corner accents (Zustand)
//
// Live value of the "Esquinas en widgets con enlace" setting (Configuración
// general -> Tema). Pure interface state: the viewer reads it with
// `useLinkCornerAccentsActive` and a preview from the Tema tab re-renders the
// grid at once. Persistence (only the override, in localStorage) lives in
// `services/linkCornerAccents.service.ts`, which is the only writer of this store.
// =============================================================================

interface LinkCornerAccentsStore {
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
}

export const useLinkCornerAccentsStore = create<LinkCornerAccentsStore>()((set) => ({
    enabled: false,
    // Returning the same state object keeps subscribers quiet when the value does not change.
    setEnabled: (enabled) => set((state) => (state.enabled === enabled ? state : { enabled })),
}));
