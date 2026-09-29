import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GridSelectionFrame from './components/ui/GridSelectionFrame';
import { GridFrameScope } from './components/ui/GridFrameScope';
import WidgetFrame from './components/ui/WidgetFrame';
import WidgetHeader from './components/ui/WidgetHeader';
import ViewerEntranceFrameOverlays from './components/viewer/ViewerEntranceFrameOverlays';
import { previewFrameShape, resetFrameShapeOnDocument } from './services/frameShape.service';
import { buildTabFramePath } from './utils/tabFramePath';

// One silhouette for every consumer: the frame clip, its border, the viewer entrance flash and
// outline and the builder selection ring all come from the same generator and the same geometry.
const TOKENS: Record<string, string> = {
    '--tab-frame-height': '25px',
    '--tab-frame-tab-cut': '25px',
    '--tab-frame-body-cut': '50px',
    '--tab-frame-glow-spread': '2px',
};
const GEOMETRY = { width: 300, height: 200, tabWidth: 180, tabHeight: 25, tabCut: 25, bodyCut: 50, radius: 4, glowSpread: 2 };

describe('tab frame silhouette shared by every consumer', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetFrameShapeOnDocument();
    });

    it('draws the same path in the frame clip, the border, the entrance flash and outline, and the selection ring', () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidthMock(this: HTMLElement) {
            return this.dataset.testid === 'tab-frame-tab' ? 180 : 0;
        });
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
            getPropertyValue: (name: string) => TOKENS[name] ?? '',
            borderTopLeftRadius: '4px',
            fontSize: '16px',
        }) as unknown as CSSStyleDeclaration);
        previewFrameShape('tab');

        render(
            <>
                <GridFrameScope>
                    <WidgetFrame widgetType="machine-activity" title="Actividad" frameClassName="glass-panel" className="p-5">
                        <WidgetHeader title="Actividad" icon={Activity} />
                    </WidgetFrame>
                </GridFrameScope>
                <ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={180} />
                <GridSelectionFrame isSelected tabWidth={180} radius="4px" />
            </>,
        );

        const silhouette = buildTabFramePath(GEOMETRY);
        expect(silhouette).toContain(' A ');
        expect(screen.getByTestId('tab-frame-surface').style.clipPath).toBe(`path('${silhouette}')`);
        expect(screen.getByTestId('tab-frame-border').querySelector('path')?.getAttribute('d')).toBe(silhouette);
        expect(screen.getByTestId('dashboard-viewer-entrance-flash-w').style.clipPath).toBe(`path('${silhouette}')`);
        expect(screen.getByTestId('dashboard-viewer-entrance-outline-w').querySelector('path')?.getAttribute('d')).toBe(silhouette);
        expect(document.querySelector('path[data-ring="hover"]')?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY, 0.5));
        expect(document.querySelector('path[data-ring="focus"]')?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY, 1));
    });
});
