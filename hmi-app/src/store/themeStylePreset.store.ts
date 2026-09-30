import { create } from 'zustand';

// =============================================================================
// STORE: Active theme preset flag (Zustand)
//
// Whether the preset live on the document is Clasico. Only the facts that React
// components need to branch on are kept here (the icon cutout applies to Clasico
// only); the preset's tokens themselves stay CSS custom properties on the
// document. It is written by `themeStyle.service` when a preset is applied to
// the document root -- never persisted here: the stored preset id is the source
// of truth and is re-applied at boot.
// =============================================================================

interface ThemeStylePresetStore {
    classic: boolean;
    setClassic: (classic: boolean) => void;
}

export const useThemeStylePresetStore = create<ThemeStylePresetStore>()((set) => ({
    classic: true,
    // Returning the same state object keeps subscribers quiet when nothing changes.
    setClassic: (classic) => set((state) => (state.classic === classic ? state : { classic })),
}));
