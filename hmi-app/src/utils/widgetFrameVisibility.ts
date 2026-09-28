/**
 * Where a header-capable widget (`isHeaderCompatibleWidgetType`) is being
 * rendered. The glass-panel frame/background default differs by location:
 * shown in the grid, frameless in the header (P2, 2026-09-28).
 */
export type WidgetFrameLocation = 'grid' | 'header';

/**
 * Resolves whether a header-capable widget should render its glass-panel
 * frame/background at `location`, from its optional `showFrame` display
 * option.
 *
 * - `undefined` (unset): today's look per location -- shown in the grid,
 *   frameless in the header.
 * - `true`/`false`: explicit choice, applied identically to both locations.
 */
export function resolveWidgetFrameVisible(
    showFrame: boolean | undefined,
    location: WidgetFrameLocation,
): boolean {
    if (showFrame !== undefined) {
        return showFrame;
    }

    return location === 'grid';
}
