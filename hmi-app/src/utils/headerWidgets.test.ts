import { describe, expect, it } from 'vitest';
import type { WidgetConfig } from '../domain/admin.types';
import { getWidgetFrameOption } from './headerWidgets';

function makeStatusWidget(showFrame: boolean | undefined): WidgetConfig {
    return {
        id: 'status-1',
        type: 'status',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 1 },
        displayOptions: { showFrame },
    };
}

function makeConnectionWidget(showFrame: boolean | undefined): WidgetConfig {
    return {
        id: 'connection-1',
        type: 'connection-status',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 1 },
        displayOptions: { showFrame },
    };
}

function makeKpiWidget(): WidgetConfig {
    return {
        id: 'kpi-1',
        type: 'kpi',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 1 },
        displayOptions: { showFrame: true } as never,
    };
}

describe('getWidgetFrameOption', () => {
    it('reads showFrame from a header-compatible status widget', () => {
        expect(getWidgetFrameOption(makeStatusWidget(true))).toBe(true);
        expect(getWidgetFrameOption(makeStatusWidget(false))).toBe(false);
        expect(getWidgetFrameOption(makeStatusWidget(undefined))).toBeUndefined();
    });

    it('reads showFrame from a header-compatible connection-status widget', () => {
        expect(getWidgetFrameOption(makeConnectionWidget(true))).toBe(true);
        expect(getWidgetFrameOption(makeConnectionWidget(undefined))).toBeUndefined();
    });

    it('returns undefined for a widget type that is not header-compatible, even if its displayOptions happens to carry showFrame', () => {
        expect(getWidgetFrameOption(makeKpiWidget())).toBeUndefined();
    });

    it('returns undefined when displayOptions is missing entirely', () => {
        const widget = makeStatusWidget(undefined);
        widget.displayOptions = undefined;
        expect(getWidgetFrameOption(widget)).toBeUndefined();
    });
});
