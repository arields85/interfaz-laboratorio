import { describe, expect, it } from 'vitest';
import {
    ICON_CUTOUT_ATTRIBUTE,
    ICON_CUTOUT_PROPERTIES,
    clearIconCutout,
    measureIconCutout,
    writeIconCutout,
} from './iconCutout';

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function frameWithRect(frameRect: DOMRect, offsetWidth = 0): HTMLElement {
    const frame = document.createElement('div');
    frame.getBoundingClientRect = () => frameRect;
    Object.defineProperty(frame, 'offsetWidth', { configurable: true, value: offsetWidth });

    return frame;
}

function iconWithRect(iconRect: DOMRect): Element {
    const icon = document.createElement('div');
    icon.getBoundingClientRect = () => iconRect;

    return icon;
}

describe('measureIconCutout', () => {
    it('measures the icon center relative to the frame border box and half the icon size', () => {
        const frame = frameWithRect(rect(100, 50, 300, 200));
        const icon = iconWithRect(rect(360, 62, 24, 24));

        expect(measureIconCutout(frame, icon)).toEqual({ x: 272, y: 24, half: 12 });
    });

    it('uses the larger side of a non-square icon box', () => {
        const frame = frameWithRect(rect(0, 0, 300, 200));

        expect(measureIconCutout(frame, iconWithRect(rect(10, 10, 20, 30)))?.half).toBe(15);
    });

    it('converts to layout pixels when the frame is scaled (builder zoom)', () => {
        // Rendered at 50 %: 150 px wide on screen, 300 px of layout.
        const frame = frameWithRect(rect(0, 0, 150, 100), 300);
        const icon = iconWithRect(rect(120, 10, 12, 12));

        expect(measureIconCutout(frame, icon)).toEqual({ x: 252, y: 32, half: 12 });
    });

    it('rounds to two decimals so subpixel jitter does not republish', () => {
        const frame = frameWithRect(rect(0, 0, 300, 200));
        const icon = iconWithRect(rect(10.004, 10.006, 24, 24));

        expect(measureIconCutout(frame, icon)).toEqual({ x: 22, y: 22.01, half: 12 });
    });

    it('returns null for an icon that has no box (hidden)', () => {
        const frame = frameWithRect(rect(0, 0, 300, 200));

        expect(measureIconCutout(frame, iconWithRect(rect(0, 0, 0, 0)))).toBeNull();
    });

    it('returns null for a frame that has no box', () => {
        expect(measureIconCutout(frameWithRect(rect(0, 0, 0, 0)), iconWithRect(rect(0, 0, 24, 24)))).toBeNull();
    });
});

describe('writeIconCutout / clearIconCutout', () => {
    it('publishes the opt-in attribute and the center / half-size custom properties in px', () => {
        const frame = document.createElement('div');

        writeIconCutout(frame, { x: 272, y: 24, half: 12 });

        expect(frame.getAttribute(ICON_CUTOUT_ATTRIBUTE)).toBe('true');
        expect(frame.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.x)).toBe('272px');
        expect(frame.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.y)).toBe('24px');
        expect(frame.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.half)).toBe('12px');
    });

    it('removes the attribute and the properties', () => {
        const frame = document.createElement('div');
        writeIconCutout(frame, { x: 1, y: 2, half: 3 });

        clearIconCutout(frame);

        expect(frame.hasAttribute(ICON_CUTOUT_ATTRIBUTE)).toBe(false);
        expect(frame.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.x)).toBe('');
        expect(frame.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.y)).toBe('');
        expect(frame.style.getPropertyValue(ICON_CUTOUT_PROPERTIES.half)).toBe('');
    });
});
