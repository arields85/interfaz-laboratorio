import { useContext } from 'react';
import { useIconCutoutStore } from '../store/iconCutout.store';
import { useThemeStylePresetStore } from '../store/themeStylePreset.store';
import { supportsIconCutout } from '../utils/widgetCapabilities';
import { GridFrameScopeContext } from './tabFrameContext';
import { useFrameShape } from './useFrameShape';

/**
 * Single decision point of "may this widget frame take the icon cutout": the setting is on, the
 * active preset is Clasico, the frame shape is Estandar, the widget is rendered in a dashboard grid
 * and its type is eligible. Whether it has a header icon to center on is decided by measuring
 * (`useIconCutoutGeometry`).
 */
export function useIconCutoutActive(widgetType: string): boolean {
    const enabled = useIconCutoutStore((state) => state.enabled);
    const classic = useThemeStylePresetStore((state) => state.classic);
    const shape = useFrameShape();
    const inGrid = useContext(GridFrameScopeContext);

    return enabled && classic && shape === 'standard' && inGrid && supportsIconCutout(widgetType);
}
