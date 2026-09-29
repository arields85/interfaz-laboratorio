import type { FrameShape } from '../domain/frameShape.types';
import { useFrameShapeStore } from '../store/frameShape.store';

/**
 * Active widget frame shape ("Forma del marco"). A selector over the Zustand
 * `useFrameShapeStore`, so a preview from the Tema tab re-renders every framed widget without
 * threading a prop or a provider through the tree.
 */
export function useFrameShape(): FrameShape {
    return useFrameShapeStore((state) => state.shape);
}
