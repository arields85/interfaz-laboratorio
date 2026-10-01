import { create } from 'zustand';

// Whether the Topbar's login overlay is open. Pure interface state (not persisted): the Topbar
// toggles it from the users button, and the hidden-access route opens it when it reveals the button.
interface LoginOverlayStore {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggle: () => void;
}

export const useLoginOverlayStore = create<LoginOverlayStore>()((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
    toggle: () => set((state) => ({ open: !state.open })),
}));
