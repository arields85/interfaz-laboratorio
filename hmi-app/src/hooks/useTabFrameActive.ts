import { useContext } from 'react';
import { GridFrameScopeContext } from './tabFrameContext';
import { supportsTabFrame } from '../utils/widgetCapabilities';
import { useFrameShape } from './useFrameShape';

/**
 * Single decision point of "does this widget frame take the tab shape": the tab shape is selected,
 * the widget is rendered in a dashboard grid, its type is eligible (`supportsTabFrame`) and it has
 * a title to put in the tab.
 */
export function useTabFrameActive(widgetType: string, title: string | undefined): boolean {
    const shape = useFrameShape();
    const inGrid = useContext(GridFrameScopeContext);

    return shape === 'tab'
        && inGrid
        && supportsTabFrame(widgetType)
        && (title?.trim().length ?? 0) > 0;
}
