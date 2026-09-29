/**
 * User-adjustable values of the viewer entrance animation, edited from
 * Configuración general -> Tema. Global (not per theme preset).
 */
export interface ViewerEntranceSettings {
    /** Thickness of the animated outline, in px. */
    outlineWidthPx: number;
    /** Peak opacity of the animated outline line (not the theme's rest border), in %. */
    outlineOpacityPercent: number;
    /** Peak opacity of the frame background flash, in %. */
    flashIntensityPercent: number;
}
