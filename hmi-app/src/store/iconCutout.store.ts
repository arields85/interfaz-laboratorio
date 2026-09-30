import { create } from 'zustand';

// =============================================================================
// STORE: Icon cutout (Zustand)
//
// Live value of the "Calado del ícono" setting (Configuración general -> Tema).
// Pure interface state: framed widgets read it with `useIconCutoutActive` and a
// preview from the Tema tab re-renders them at once. Persistence (only the
// override, in localStorage) lives in `services/iconCutout.service.ts`, which is
// the only writer of this store.
// =============================================================================

interface IconCutoutStore {
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
}

export const useIconCutoutStore = create<IconCutoutStore>()((set) => ({
    enabled: false,
    // Returning the same state object keeps subscribers quiet when the value does not change.
    setEnabled: (enabled) => set((state) => (state.enabled === enabled ? state : { enabled })),
}));
