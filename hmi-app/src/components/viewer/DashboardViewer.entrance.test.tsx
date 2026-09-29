import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardViewer from './DashboardViewer';
import { makeGroupWidget, makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import type { WidgetConfig, WidgetLayout } from '../../domain/admin.types';

// jsdom cannot run CSS animations, so this suite asserts the observable contract of the viewer
// entrance: classes, the per-item order custom property, the replay key behavior, and the
// source contract of the entrance CSS in index.css (same technique as HeaderWidgetCanvas.test.tsx).
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, '../../index.css'), 'utf-8');

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;
const resizeCallbacks = new Map<Element, Set<ResizeCallback>>();

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeCallback) {}

    public observe(target: Element): void {
        const callbacks = resizeCallbacks.get(target) ?? new Set<ResizeCallback>();
        callbacks.add(this.callback);
        resizeCallbacks.set(target, callbacks);
    }

    public unobserve(): void {}

    public disconnect(): void {}
}

vi.mock('./WidgetPresentationBoundary', () => ({
    default: (props: { widget: { id: string } }) => <div data-testid={`widget-renderer-${props.widget.id}`} />,
}));

function measure(container: HTMLElement) {
    const root = container.querySelector('[data-testid="dashboard-viewer-root"]');
    if (!root) {
        throw new Error('Dashboard viewer root was not rendered.');
    }
    const entry = { target: root, contentRect: { width: 1200, height: 675 } } as ResizeObserverEntry;
    act(() => {
        for (const callback of resizeCallbacks.get(root) ?? []) {
            callback([entry], {} as ResizeObserver);
        }
    });
}

function orderOf(widgetId: string): number {
    const value = screen.getByTestId(`dashboard-viewer-item-${widgetId}`).style.getPropertyValue('--viewer-entrance-order');
    return Number(value);
}

function sequence(values: number[]): () => number {
    let index = 0;
    return () => values[index++ % values.length];
}

const IDS = ['a', 'b', 'c', 'd'];
const widgets: WidgetConfig[] = IDS.map((id) => makeWidget({ id }));
const layout: WidgetLayout[] = IDS.map((id, index) => makeLayout({ widgetId: id, x: index * 4, y: 0 }));

function renderViewer(props: Partial<React.ComponentProps<typeof DashboardViewer>> = {}) {
    const ui = (extra: Partial<React.ComponentProps<typeof DashboardViewer>> = {}) => (
        <DashboardViewer
            widgets={widgets}
            layout={layout}
            equipmentMap={new Map()}
            cols={24}
            rows={12}
            {...props}
            {...extra}
        />
    );
    const result = render(ui());
    measure(result.container);
    return { ...result, ui };
}

describe('DashboardViewer entrance', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('marks the frame and every item with the entrance scope, class and order variable', () => {
        renderViewer({ entranceKey: 'dash-1:view-a', entranceRandom: sequence([0.3, 0.6, 0.1]) });

        expect(screen.getByTestId('dashboard-viewer-frame')).toHaveAttribute('data-viewer-entrance', 'true');
        for (const id of IDS) {
            const item = screen.getByTestId(`dashboard-viewer-item-${id}`);
            expect(item).toHaveClass('hmi-viewer-entrance-item');
            expect(orderOf(id)).toBeGreaterThanOrEqual(0);
            expect(orderOf(id)).toBeLessThanOrEqual(1);
        }
        expect(IDS.map(orderOf).sort()).toEqual([0, 1 / 3, 2 / 3, 1]);
    });

    it('does not animate without an entrance key (no scope, class or variable)', () => {
        renderViewer();

        expect(screen.getByTestId('dashboard-viewer-frame')).not.toHaveAttribute('data-viewer-entrance');
        const item = screen.getByTestId('dashboard-viewer-item-a');
        expect(item).not.toHaveClass('hmi-viewer-entrance-item');
        expect(item.style.getPropertyValue('--viewer-entrance-order')).toBe('');
    });

    it('keeps DOM nodes and delays on a data refresh (same key, new props identity)', () => {
        const random = vi.fn(sequence([0.2, 0.9, 0.4]));
        const { rerender, ui } = renderViewer({ entranceKey: 'dash-1:view-a', entranceRandom: random });
        const before = screen.getByTestId('dashboard-viewer-item-a');
        const orders = IDS.map(orderOf);
        const callsBefore = random.mock.calls.length;

        rerender(ui({ widgets: [...widgets], layout: [...layout], isLoadingOverview: true }));

        expect(screen.getByTestId('dashboard-viewer-item-a')).toBe(before);
        expect(IDS.map(orderOf)).toEqual(orders);
        expect(random.mock.calls.length).toBe(callsBefore);
    });

    it('replays on a new entry: switching dashboard or view remounts the items with a fresh shuffle', () => {
        const random = sequence([0.05, 0.95, 0.5, 0.2, 0.7, 0.35]);
        const { rerender, ui } = renderViewer({ entranceKey: 'dash-1:view-a', entranceRandom: random });
        const before = screen.getByTestId('dashboard-viewer-item-a');
        const ordersBefore = IDS.map(orderOf);

        rerender(ui({ entranceKey: 'dash-1:view-b' }));

        expect(screen.getByTestId('dashboard-viewer-item-a')).not.toBe(before);
        expect(IDS.map(orderOf)).not.toEqual(ordersBefore);

        const afterView = screen.getByTestId('dashboard-viewer-item-a');
        rerender(ui({ entranceKey: 'dash-2:view-a' }));
        expect(screen.getByTestId('dashboard-viewer-item-a')).not.toBe(afterView);
    });

    it('never enters a locked group container after any of its members', () => {
        const group = makeGroupWidget({ id: 'g', locked: true, memberWidgetIds: ['a', 'b'] });
        const withGroup = [group, ...widgets];
        const withGroupLayout = [makeLayout({ widgetId: 'g', x: 0, y: 0, w: 10, h: 10 }), ...layout];

        for (const values of [[0, 0, 0], [0.99, 0.99, 0.99], [0.5, 0.1, 0.9]]) {
            const { unmount } = renderViewer({
                widgets: withGroup,
                layout: withGroupLayout,
                entranceKey: 'k',
                entranceRandom: sequence(values),
            });

            expect(orderOf('g')).toBeLessThanOrEqual(orderOf('a'));
            expect(orderOf('g')).toBeLessThanOrEqual(orderOf('b'));
            unmount();
        }
    });

    it('excludes header widgets from the stagger so the grid window has no holes', () => {
        renderViewer({ entranceKey: 'k', headerWidgetIds: new Set(['a']), entranceRandom: sequence([0.5]) });

        expect(screen.queryByTestId('dashboard-viewer-item-a')).not.toBeInTheDocument();
        expect(['b', 'c', 'd'].map(orderOf).sort()).toEqual([0, 0.5, 1]);
    });
});

describe('viewer entrance CSS contract (index.css)', () => {
    it('defines the tunable timing tokens in a single :root block', () => {
        const block = indexCss.match(/:root\s*{([^}]*--viewer-entrance-frame-duration[^}]*)}/);
        expect(block).not.toBeNull();
        const body = block?.[1] ?? '';

        expect(body).toContain('--viewer-entrance-frame-duration: 450ms;');
        expect(body).toContain('--viewer-entrance-spread: 700ms;');
        expect(body).toContain('--viewer-entrance-ease: cubic-bezier(0.22, 1, 0.36, 1);');
        expect(body).toContain('--viewer-entrance-value-duration: 900ms;');
        expect(body).toContain('--viewer-entrance-value-offset: 150ms;');
    });

    it('animates the item wrapper from tokens, scoped under the viewer frame attribute', () => {
        const rule = indexCss.match(/\[data-viewer-entrance='true'\] > \.hmi-viewer-entrance-item\s*{([\s\S]*?)}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('--viewer-entrance-item-delay: calc(var(--viewer-entrance-spread) * var(--viewer-entrance-order, 0));');
        expect(body).toContain('animation-name: hmi-viewer-frame-entrance;');
        expect(body).toContain('animation-duration: var(--viewer-entrance-frame-duration);');
        expect(body).toContain('animation-timing-function: var(--viewer-entrance-ease);');
        expect(body).toContain('animation-delay: var(--viewer-entrance-item-delay);');
        expect(body).toContain('animation-fill-mode: backwards;');
        // Never animate the themed frame tokens (they carry the hover transitions).
        expect(body).not.toContain('--frame-');
    });

    it('does not define any unscoped entrance rule (builder never animates)', () => {
        const withoutKeyframes = indexCss.replace(/@keyframes hmi-viewer-[\s\S]*?\r?\n}\r?\n/g, '');
        const unscoped = withoutKeyframes.match(/(^|\n)\.hmi-viewer-entrance-item[^{]*{/g);

        expect(unscoped).toBeNull();
    });

    it('turns the entrance off for reduced motion', () => {
        const reduced = [...indexCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\r?\n}\r?\n/g)]
            .map((match) => match[1])
            .join('\n');
        expect(reduced).toMatch(/\[data-viewer-entrance='true'\] > \.hmi-viewer-entrance-item\s*{[^}]*animation: none;/);
    });
});
