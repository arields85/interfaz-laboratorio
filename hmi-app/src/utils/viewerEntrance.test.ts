import { describe, expect, it } from 'vitest';
import { makeGroupWidget, makeWidget } from '../test/fixtures/dashboard.fixture';
import { buildViewerEntranceKey, resolveViewerEntranceOrders } from './viewerEntrance';

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
