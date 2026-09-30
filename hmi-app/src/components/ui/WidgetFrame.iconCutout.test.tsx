import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';
import { Thermometer } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { previewIconCutout, resetIconCutoutOnDocument } from '../../services/iconCutout.service';
import {
    INSTRUMENT_THEME_STYLE_ID,
    previewThemeStyleOnDocument,
    resetThemeStyleOnDocument,
} from '../../services/themeStyle.service';
import { useThemeStylePresetStore } from '../../store/themeStylePreset.store';
import { ICON_CUTOUT_ATTRIBUTE, ICON_CUTOUT_PROPERTIES } from '../../utils/iconCutout';
import { GridFrameScope } from './GridFrameScope';
import WidgetFrame from './WidgetFrame';
import WidgetHeader from './WidgetHeader';

// jsdom has no layout: the frame and icon boxes are injected per element.
function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

let frameRect = rect(0, 0, 300, 200);
let iconRect = rect(250, 14, 24, 24);

beforeEach(() => {
    frameRect = rect(0, 0, 300, 200);
    iconRect = rect(250, 14, 24, 24);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => frameRect);
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(() => iconRect);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetIconCutoutOnDocument();
    resetFrameShapeOnDocument();
    resetThemeStyleOnDocument();
    useThemeStylePresetStore.getState().setClassic(true);
});

function renderFrame({ withIcon = true, grid = true, type = 'kpi' }: { withIcon?: boolean; grid?: boolean; type?: string } = {}) {
    const frame = (
        <WidgetFrame widgetType={type} title="Temperatura" frameClassName="glass-panel" className="p-5 group relative w-full h-full">
            <WidgetHeader title="Temperatura" icon={withIcon ? Thermometer : undefined} />
            <p>Body</p>
        </WidgetFrame>
    );
    const view = render(grid ? <GridFrameScope>{frame}</GridFrameScope> : frame);

    return { ...view, frameEl: view.container.querySelector<HTMLElement>('.glass-panel') as HTMLElement };
}

describe('WidgetFrame icon cutout', () => {
    it('leaves the frame untouched while the setting is off', () => {
        const { frameEl } = renderFrame();

        expect(frameEl).not.toHaveAttribute(ICON_CUTOUT_ATTRIBUTE);
        expect(frameEl.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.x)).toBe('');
    });

    it('opts the frame in and publishes the icon center and half size from the measured icon', () => {
        previewIconCutout(true);

        const { frameEl } = renderFrame();

        expect(frameEl).toHaveAttribute(ICON_CUTOUT_ATTRIBUTE, 'true');
        expect(frameEl.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.x)).toBe('262px');
        expect(frameEl.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.y)).toBe('26px');
        expect(frameEl.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.half)).toBe('12px');
    });

    it('does not opt in a widget without a header icon', () => {
        previewIconCutout(true);

        const { frameEl } = renderFrame({ withIcon: false });

        expect(frameEl).not.toHaveAttribute(ICON_CUTOUT_ATTRIBUTE);
    });

    it('does not opt in outside a dashboard grid', () => {
        previewIconCutout(true);

        const { frameEl } = renderFrame({ grid: false });

        expect(frameEl).not.toHaveAttribute(ICON_CUTOUT_ATTRIBUTE);
    });

    it('does not opt in another preset', () => {
        previewIconCutout(true);
        previewThemeStyleOnDocument(INSTRUMENT_THEME_STYLE_ID);

        expect(renderFrame().frameEl).not.toHaveAttribute(ICON_CUTOUT_ATTRIBUTE);
    });

    it('does not opt in the Pestaña shape', () => {
        previewIconCutout(true);
        previewFrameShape('tab');

        renderFrame();

        expect(document.querySelector(`[${ICON_CUTOUT_ATTRIBUTE}]`)).toBeNull();
    });

    it('does not opt in the group container', () => {
        previewIconCutout(true);

        expect(renderFrame({ type: 'group' }).frameEl).not.toHaveAttribute(ICON_CUTOUT_ATTRIBUTE);
    });

    it('reacts live to the setting: turning it off restores the frame', () => {
        const { frameEl } = renderFrame();
        expect(frameEl).not.toHaveAttribute(ICON_CUTOUT_ATTRIBUTE);

        act(() => previewIconCutout(true));
        expect(frameEl).toHaveAttribute(ICON_CUTOUT_ATTRIBUTE, 'true');

        act(() => previewIconCutout(false));
        expect(frameEl).not.toHaveAttribute(ICON_CUTOUT_ATTRIBUTE);
        expect(frameEl.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.x)).toBe('');
    });

    it('re-measures when the frame or the icon resize (icon position, widget size)', () => {
        let notify: () => void = () => undefined;
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: () => void) { notify = callback; }
            observe() {}
            unobserve() {}
            disconnect() {}
        });
        previewIconCutout(true);
        const { frameEl } = renderFrame();
        expect(frameEl.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.x)).toBe('262px');

        iconRect = rect(20, 14, 24, 24);
        act(() => notify());

        expect(frameEl.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.x)).toBe('32px');
    });
});
