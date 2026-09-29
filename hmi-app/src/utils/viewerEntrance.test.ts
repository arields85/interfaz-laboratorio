import { afterEach, describe, expect, it } from 'vitest';
import { makeGroupWidget, makeWidget } from '../test/fixtures/dashboard.fixture';
import {
    buildViewerEntranceKey,
    countFractionDigits,
    parseCssTimeMs,
    parseCubicBezier,
    resolveCubicBezierProgress,
    readViewerEntranceCountUpTiming,
    resolveCountUpStartOffsetMs,
    resolveViewerCountUpValue,
    resolveViewerEntranceOrders,
} from './viewerEntrance';

/** Deterministic random source cycling through the given values. */
function sequence(values: number[]): () => number {
    let index = 0;
    return () => values[index++ % values.length];
}

describe('resolveViewerEntranceOrders', () => {
    it('gives every widget an order in [0, 1]', () => {
        const widgets = ['a', 'b', 'c', 'd'].map((id) => makeWidget({ id }));

        const orders = resolveViewerEntranceOrders(widgets, widgets.map((w) => w.id), sequence([0.3, 0.9, 0.1]));

        expect([...orders.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
        for (const order of orders.values()) {
            expect(order).toBeGreaterThanOrEqual(0);
            expect(order).toBeLessThanOrEqual(1);
        }
    });

    it('spreads the orders across the whole window (first at 0, last at 1)', () => {
        const widgets = ['a', 'b', 'c'].map((id) => makeWidget({ id }));

        const orders = resolveViewerEntranceOrders(widgets, ['a', 'b', 'c'], sequence([0.2, 0.7]));

        expect([...orders.values()].sort()).toEqual([0, 0.5, 1]);
    });

    it('is a shuffle: the injected random source changes who goes first', () => {
        const widgets = ['a', 'b', 'c', 'd'].map((id) => makeWidget({ id }));
        const ids = widgets.map((w) => w.id);

        const one = resolveViewerEntranceOrders(widgets, ids, sequence([0, 0, 0]));
        const two = resolveViewerEntranceOrders(widgets, ids, sequence([0.99, 0.99, 0.99]));

        expect(one).not.toEqual(two);
    });

    it('is deterministic for the same random sequence', () => {
        const widgets = ['a', 'b', 'c', 'd'].map((id) => makeWidget({ id }));
        const ids = widgets.map((w) => w.id);

        expect(resolveViewerEntranceOrders(widgets, ids, sequence([0.4, 0.8, 0.2]))).toEqual(
            resolveViewerEntranceOrders(widgets, ids, sequence([0.4, 0.8, 0.2])),
        );
    });

    it('handles a single widget and an empty dashboard', () => {
        const widget = makeWidget({ id: 'only' });

        expect(resolveViewerEntranceOrders([widget], ['only'], () => 0.5).get('only')).toBe(0);
        expect(resolveViewerEntranceOrders([], [], () => 0.5).size).toBe(0);
    });

    it('never delays a locked group container past any of its members', () => {
        const members = ['m1', 'm2', 'm3'].map((id) => makeWidget({ id }));
        const group = makeGroupWidget({ id: 'g', locked: true, memberWidgetIds: ['m1', 'm2', 'm3'] });
        const widgets = [group, ...members];
        // Random sources that push the group to every position of the shuffle.
        const sources = [[0, 0, 0], [0.99, 0.99, 0.99], [0.5, 0.1, 0.9], [0.1, 0.5, 0.3]];

        for (const values of sources) {
            const orders = resolveViewerEntranceOrders(widgets, ['g', 'm1', 'm2', 'm3'], sequence(values));
            for (const memberId of ['m1', 'm2', 'm3']) {
                expect(orders.get('g') ?? 1).toBeLessThanOrEqual(orders.get(memberId) ?? 0);
            }
        }
    });

    it('ignores unlocked groups when ordering (their members are independent)', () => {
        const member = makeWidget({ id: 'm1' });
        const group = makeGroupWidget({ id: 'g', locked: false, memberWidgetIds: ['m1'] });

        const orders = resolveViewerEntranceOrders([group, member], ['g', 'm1'], sequence([0, 0]));

        expect(orders.size).toBe(2);
    });
});

describe('buildViewerEntranceKey', () => {
    it('combines the dashboard id and the active view id', () => {
        expect(buildViewerEntranceKey('dash-1', 'view-a')).toBe('dash-1:view-a');
        expect(buildViewerEntranceKey('dash-1', undefined)).toBe('dash-1:view-default');
    });
});

describe('parseCssTimeMs', () => {
    it('reads milliseconds and seconds, tolerating surrounding whitespace', () => {
        expect(parseCssTimeMs('700ms')).toBe(700);
        expect(parseCssTimeMs(' 900ms ')).toBe(900);
        expect(parseCssTimeMs('0.5s')).toBe(500);
        expect(parseCssTimeMs('0ms')).toBe(0);
    });

    it('returns null for anything that is not a CSS time', () => {
        expect(parseCssTimeMs('')).toBeNull();
        expect(parseCssTimeMs('fast')).toBeNull();
        expect(parseCssTimeMs('12px')).toBeNull();
    });
});

describe('readViewerEntranceCountUpTiming', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('style');
    });

    function setTokens(tokens: Record<string, string>) {
        for (const [name, value] of Object.entries(tokens)) {
            document.documentElement.style.setProperty(name, value);
        }
    }

    it('reads spread, value offset and count-up duration from the entrance tokens', () => {
        setTokens({
            '--viewer-entrance-spread': '700ms',
            '--viewer-entrance-value-offset': '150ms',
            '--viewer-entrance-count-duration': '0.9s',
            '--viewer-entrance-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
        });

        expect(readViewerEntranceCountUpTiming()).toEqual({
            spreadMs: 700,
            offsetMs: 150,
            durationMs: 900,
            ease: [0.22, 1, 0.36, 1],
        });
    });

    it('falls back to a linear curve when the shared ease token is not a cubic-bezier', () => {
        setTokens({
            '--viewer-entrance-spread': '700ms',
            '--viewer-entrance-value-offset': '150ms',
            '--viewer-entrance-count-duration': '900ms',
            '--viewer-entrance-ease': 'ease-out',
        });

        expect(readViewerEntranceCountUpTiming()?.ease).toBeNull();
    });

    it('is null when the tokens are missing or the duration is not positive (no count-up)', () => {
        expect(readViewerEntranceCountUpTiming()).toBeNull();

        setTokens({
            '--viewer-entrance-spread': '700ms',
            '--viewer-entrance-value-offset': '150ms',
            '--viewer-entrance-count-duration': '0ms',
        });
        expect(readViewerEntranceCountUpTiming()).toBeNull();
    });
});

describe('resolveCountUpStartOffsetMs', () => {
    it('is the item delay (spread x order) plus the value offset, the same clock as the gauge fills', () => {
        const timing = { spreadMs: 700, offsetMs: 150, durationMs: 900, ease: null };

        expect(resolveCountUpStartOffsetMs(0, timing)).toBe(150);
        expect(resolveCountUpStartOffsetMs(0.5, timing)).toBe(500);
        expect(resolveCountUpStartOffsetMs(1, timing)).toBe(850);
    });
});

describe('countFractionDigits', () => {
    it('counts the decimals a number is displayed with', () => {
        expect(countFractionDigits(72)).toBe(0);
        expect(countFractionDigits(72.5)).toBe(1);
        expect(countFractionDigits(3.14159)).toBe(5);
        expect(countFractionDigits(-0.25)).toBe(2);
    });

    it('treats exponent notation as an integer display', () => {
        expect(countFractionDigits(1e21)).toBe(0);
    });
});

describe('resolveViewerCountUpValue', () => {
    it('returns the untouched target once progress completes (exact final formatting)', () => {
        expect(resolveViewerCountUpValue(72.4567, 1, 1)).toBe(72.4567);
        expect(resolveViewerCountUpValue(72.4567, 2, 1)).toBe(72.4567);
    });

    it('rises from zero, rounded to the target decimals', () => {
        expect(resolveViewerCountUpValue(100, 0, 0)).toBe(0);
        expect(resolveViewerCountUpValue(100, 0.333, 0)).toBe(33);
        expect(resolveViewerCountUpValue(72.4, 0.5, 1)).toBe(36.2);
    });

    it('handles negative targets and clamps negative progress to zero', () => {
        expect(resolveViewerCountUpValue(-40, 0.5, 0)).toBe(-20);
        expect(resolveViewerCountUpValue(40, -1, 0)).toBe(0);
    });
});

describe('parseCubicBezier', () => {
    it('reads the four control values of a cubic-bezier()', () => {
        expect(parseCubicBezier('cubic-bezier(0.22, 1, 0.36, 1)')).toEqual([0.22, 1, 0.36, 1]);
        expect(parseCubicBezier(' cubic-bezier(0,0,1,1) ')).toEqual([0, 0, 1, 1]);
    });

    it('is null for keywords, malformed values and an x outside 0..1 (invalid in CSS)', () => {
        expect(parseCubicBezier('ease-out')).toBeNull();
        expect(parseCubicBezier('cubic-bezier(0.2, 1, 0.3)')).toBeNull();
        expect(parseCubicBezier('cubic-bezier(1.5, 0, 0.3, 1)')).toBeNull();
        expect(parseCubicBezier('')).toBeNull();
    });
});

describe('resolveCubicBezierProgress', () => {
    it('is linear without a curve and pins both ends', () => {
        expect(resolveCubicBezierProgress(null, 0.3)).toBe(0.3);
        expect(resolveCubicBezierProgress([0.22, 1, 0.36, 1], 0)).toBe(0);
        expect(resolveCubicBezierProgress([0.22, 1, 0.36, 1], 1)).toBe(1);
    });

    it('follows the CSS curve: the shared ease-out rises well ahead of linear', () => {
        const eased = resolveCubicBezierProgress([0.22, 1, 0.36, 1], 0.25);

        expect(eased).toBeGreaterThan(0.6);
        expect(eased).toBeLessThan(1);
    });

    it('matches a straight-line bezier', () => {
        expect(resolveCubicBezierProgress([0, 0, 1, 1], 0.4)).toBeCloseTo(0.4, 4);
    });
});
