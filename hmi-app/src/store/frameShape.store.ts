import { create } from 'zustand';
import { DEFAULT_FRAME_SHAPE } from '../domain/frameShape.types';
import type { FrameShape } from '../domain/frameShape.types';

// =============================================================================
// STORE: Frame shape (Zustand)
//
// Active widget frame shape ("Forma del marco", Configuración general -> Tema).
// Puro estado de interfaz: los widgets del grid lo leen con `useFrameShape` y
// una vista previa desde la pestaña Tema los re-renderiza al instante.
// La persistencia (solo el override, en localStorage) y el atributo
// `data-frame-shape` del documento viven en `services/frameShape.service.ts`,
// que es quien escribe este store; no se persiste con el middleware de zustand
// para que una instalación nueva no deje ninguna clave y el código siga siendo
// la fuente de verdad del valor por defecto.
// =============================================================================

interface FrameShapeStore {
    shape: FrameShape;
    setShape: (shape: FrameShape) => void;
}

export const useFrameShapeStore = create<FrameShapeStore>()((set) => ({
    shape: DEFAULT_FRAME_SHAPE,
    // Returning the same state object keeps subscribers quiet when the shape does not change.
    setShape: (shape) => set((state) => (state.shape === shape ? state : { shape })),
}));
