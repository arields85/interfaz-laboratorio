import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GridFrameScope } from '../components/ui/GridFrameScope';
import { previewFrameShape, resetFrameShapeOnDocument } from '../services/frameShape.service';
import { previewIconCutout, resetIconCutoutOnDocument } from '../services/iconCutout.service';
import {
    INSTRUMENT_THEME_STYLE_ID,
    previewThemeStyleOnDocument,
    resetThemeStyleOnDocument,
} from '../services/themeStyle.service';
import { supportsIconCutout } from '../utils/widgetCapabilities';
import { useIconCutoutActive } from './useIconCutoutActive';

const inGrid = ({ children }: { children: ReactNode }) => <GridFrameScope>{children}</GridFrameScope>;

function active(widgetType: string, wrapper?: typeof inGrid) {
    return renderHook(() => useIconCutoutActive(widgetType), wrapper ? { wrapper } : undefined).result.current;
}

describe('useIconCutoutActive', () => {
    afterEach(() => {
        resetIconCutoutOnDocument();
        resetFrameShapeOnDocument();
        resetThemeStyleOnDocument();
    });

    it('is off by default', () => {
        expect(active('kpi', inGrid)).toBe(false);
    });

    it('is on for an eligible widget in a grid with the setting on, Clasico and Estandar', () => {
        previewIconCutout(true);

        expect(active('kpi', inGrid)).toBe(true);
    });

    it('is off outside a dashboard grid', () => {
        previewIconCutout(true);

        expect(active('kpi')).toBe(false);
    });

    it('is off with the Pestaña shape', () => {
        previewIconCutout(true);
        previewFrameShape('tab');

        expect(active('kpi', inGrid)).toBe(false);
    });

    it('is off with any other preset', () => {
        previewIconCutout(true);
        previewThemeStyleOnDocument(INSTRUMENT_THEME_STYLE_ID);

        expect(active('kpi', inGrid)).toBe(false);
    });

    it('is off for widget types that never take the cutout (group container, header-slot and unknown types)', () => {
        previewIconCutout(true);

        expect(active('group', inGrid)).toBe(false);
        expect(active('alert-history', inGrid)).toBe(false);
        expect(active('nope', inGrid)).toBe(false);
    });
});

describe('supportsIconCutout', () => {
    it('covers the framed widgets but not the group container', () => {
        for (const type of ['kpi', 'metric-card', 'info-card', 'machine-activity', 'trend-chart', 'trend-chart-v2', 'prod-trend', 'prod-history', 'activity-analytics']) {
            expect(supportsIconCutout(type), type).toBe(true);
        }
        expect(supportsIconCutout('group')).toBe(false);
    });
});
