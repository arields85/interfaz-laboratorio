import { describe, expect, it } from 'vitest';
import { resolveWidgetFrameVisible } from './widgetFrameVisibility';

describe('resolveWidgetFrameVisible', () => {
    it('defaults to shown in the grid when unset (today\'s look)', () => {
        expect(resolveWidgetFrameVisible(undefined, 'grid')).toBe(true);
    });

    it('defaults to frameless in the header when unset (today\'s look)', () => {
        expect(resolveWidgetFrameVisible(undefined, 'header')).toBe(false);
    });

    it('overrides both locations when explicitly true', () => {
        expect(resolveWidgetFrameVisible(true, 'grid')).toBe(true);
        expect(resolveWidgetFrameVisible(true, 'header')).toBe(true);
    });

    it('overrides both locations when explicitly false', () => {
        expect(resolveWidgetFrameVisible(false, 'grid')).toBe(false);
        expect(resolveWidgetFrameVisible(false, 'header')).toBe(false);
    });
});
