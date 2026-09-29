/**
 * Shape of the widget frames of the dashboard grid, chosen in
 * Configuración general -> Tema ("Forma del marco"). Global (not per theme
 * preset): the fill, border and blur always come from the active preset.
 *
 * - `standard`: today's rounded frame with the title inside the body.
 * - `tab`: the title moves into a tab flush with the top-left corner and the
 *   body's top-right corner is chamfered (icon in the cut-off corner).
 */
export type FrameShape = 'standard' | 'tab';

/** Today's frames; a fresh install and anyone who never chooses another shape get this one. */
export const DEFAULT_FRAME_SHAPE: FrameShape = 'standard';

export function isFrameShape(value: unknown): value is FrameShape {
    return value === 'standard' || value === 'tab';
}
