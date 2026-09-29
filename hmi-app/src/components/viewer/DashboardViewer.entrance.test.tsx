import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, within } from '@testing-library/react';
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

// The stub reads the entrance context the way a widget's count-up hook does, so the tests can
// assert what the viewer provides to its children.
vi.mock('./WidgetPresentationBoundary', async () => {
    const { useContext } = await import('react');
    const { ViewerEntranceContext } = await import('../../hooks/useViewerEntranceCountUp');

    function WidgetStub(props: { widget: { id: string } }) {
        const order = useContext(ViewerEntranceContext);
        return (
            <div
                data-testid={`widget-renderer-${props.widget.id}`}
                data-entrance-order={order === null ? 'none' : String(order)}
            />
        );
    }

    return { default: WidgetStub };
});

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

    it('gives a widget added under the same key its own order without reshuffling or remounting the others', () => {
        const random = vi.fn(sequence([0.2, 0.9, 0.4]));
        const { rerender, ui } = renderViewer({ entranceKey: 'dash-1:view-a', entranceRandom: random });
        const before = screen.getByTestId('dashboard-viewer-item-a');
        const orders = IDS.map(orderOf);
        const added = makeWidget({ id: 'e' });

        rerender(ui({
            widgets: [...widgets, added],
            layout: [...layout, makeLayout({ widgetId: 'e', x: 0, y: 4 })],
            entranceRandom: sequence([0.75]),
        }));

        expect(screen.getByTestId('dashboard-viewer-item-a')).toBe(before);
        expect(IDS.map(orderOf)).toEqual(orders);
        expect(orderOf('e')).toBe(0.75);
        expect(screen.getByTestId('widget-renderer-e')).toHaveAttribute('data-entrance-order', '0.75');
    });

    it('keeps the orders of the remaining widgets when one is removed under the same key', () => {
        const { rerender, ui } = renderViewer({ entranceKey: 'dash-1:view-a', entranceRandom: sequence([0.2, 0.9, 0.4]) });
        const orders = new Map(IDS.map((id) => [id, orderOf(id)]));

        rerender(ui({ widgets: widgets.slice(1), layout: layout.slice(1) }));

        for (const id of ['b', 'c', 'd']) {
            expect(orderOf(id)).toBe(orders.get(id));
        }
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

describe('DashboardViewer entrance count-up context', () => {
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

    it("provides each widget with its own item's stagger order", () => {
        renderViewer({ entranceKey: 'k', entranceRandom: sequence([0.3, 0.6, 0.1]) });

        for (const id of IDS) {
            expect(Number(screen.getByTestId(`widget-renderer-${id}`).dataset.entranceOrder)).toBe(orderOf(id));
        }
    });

    it('provides no entrance to widgets without an entrance key', () => {
        renderViewer();

        expect(screen.getByTestId('widget-renderer-a').dataset.entranceOrder).toBe('none');
    });
});

describe('DashboardViewer entrance frame overlays (flash + outline)', () => {
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

    it('renders a flash layer and an outline rect inside every framed item surface', () => {
        renderViewer({ entranceKey: 'k', entranceRandom: sequence([0.5]) });

        for (const id of IDS) {
            const surface = screen.getByTestId(`dashboard-viewer-item-surface-${id}`);
            const flash = within(surface).getByTestId(`dashboard-viewer-entrance-flash-${id}`);
            const outline = within(surface).getByTestId(`dashboard-viewer-entrance-outline-${id}`);

            expect(flash).toHaveClass('hmi-viewer-entrance-flash');
            expect(flash).toHaveAttribute('aria-hidden', 'true');
            expect(outline).toHaveClass('hmi-viewer-entrance-outline');
            expect(outline).toHaveAttribute('aria-hidden', 'true');
            // The rect is normalized to a path length of 1 so the dash keyframes never depend on size.
            const rect = outline.querySelector('rect');
            expect(rect).not.toBeNull();
            expect(rect).toHaveAttribute('pathLength', '1');
            expect(rect).toHaveClass('hmi-viewer-entrance-outline-rect');
            // Overlays sit after the widget so they paint above the frame fill.
            expect(flash.compareDocumentPosition(screen.getByTestId(`widget-renderer-${id}`)))
                .toBe(Node.DOCUMENT_POSITION_PRECEDING);
        }
    });

    it('matches the frame box: same surface inset as the padding of the surface', () => {
        const group = makeGroupWidget({ id: 'g', locked: true, memberWidgetIds: ['a'] });
        renderViewer({
            widgets: [group, ...widgets],
            layout: [makeLayout({ widgetId: 'g', x: 0, y: 0, w: 10, h: 10 }), ...layout],
            entranceKey: 'k',
        });

        for (const id of ['g', 'a']) {
            const surface = screen.getByTestId(`dashboard-viewer-item-surface-${id}`);
            const expectedInset = surface.style.padding;
            expect(screen.getByTestId(`dashboard-viewer-entrance-flash-${id}`).style.inset).toBe(expectedInset);
            expect(screen.getByTestId(`dashboard-viewer-entrance-outline-${id}`).style.inset).toBe(expectedInset);
        }
        expect(screen.getByTestId('dashboard-viewer-entrance-flash-g').style.inset).toBe('0px');
        expect(screen.getByTestId('dashboard-viewer-entrance-flash-a').style.inset).toBe('var(--widget-spacing)');
    });

    it('draws no overlay on frameless text titles', () => {
        const title = makeWidget({ id: 't', type: 'text-title' });
        renderViewer({
            widgets: [title],
            layout: [makeLayout({ widgetId: 't', x: 0, y: 0 })],
            entranceKey: 'k',
        });

        expect(screen.queryByTestId('dashboard-viewer-entrance-flash-t')).not.toBeInTheDocument();
        expect(screen.queryByTestId('dashboard-viewer-entrance-outline-t')).not.toBeInTheDocument();
    });

    it('renders no overlay without an entrance key (builder-like static render)', () => {
        renderViewer();

        expect(screen.queryByTestId('dashboard-viewer-entrance-flash-a')).not.toBeInTheDocument();
        expect(screen.queryByTestId('dashboard-viewer-entrance-outline-a')).not.toBeInTheDocument();
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

    it('defines the count-up duration token in the same :root block', () => {
        const block = indexCss.match(/:root\s*{([^}]*--viewer-entrance-frame-duration[^}]*)}/);

        expect(block?.[1] ?? '').toContain('--viewer-entrance-count-duration: 900ms;');
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
        expect(reduced).toMatch(/\[data-viewer-entrance='true'\] > \.hmi-viewer-entrance-item\s*[,{][^}]*animation: none;/);
    });
    it('defines the flash and outline tokens in the same single :root block', () => {
        const block = indexCss.match(/:root\s*{([^}]*--viewer-entrance-frame-duration[^}]*)}/);
        const body = block?.[1] ?? '';

        for (const token of [
            '--viewer-entrance-flash-color',
            '--viewer-entrance-flash-peak',
            '--viewer-entrance-flash-duration',
            '--viewer-entrance-flash-offset',
            '--viewer-entrance-outline-color',
            '--viewer-entrance-outline-width',
            '--viewer-entrance-outline-opacity',
            '--viewer-entrance-outline-duration',
            '--viewer-entrance-outline-fade',
            '--viewer-entrance-outline-offset',
        ]) {
            expect(body).toContain(`${token}:`);
        }
    });

    it('flashes an overlay layer (never the --frame-* tokens) timed off the item delay', () => {
        expect(indexCss).toMatch(/@keyframes hmi-viewer-entrance-flash\s*{[\s\S]*?var\(--viewer-entrance-flash-peak\)/);
        const rule = indexCss.match(/\[data-viewer-entrance='true'\] \.hmi-viewer-entrance-flash\s*{([\s\S]*?)}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('pointer-events: none;');
        expect(body).toContain('animation-name: hmi-viewer-entrance-flash;');
        expect(body).toContain('animation-duration: var(--viewer-entrance-flash-duration);');
        expect(body).toContain('var(--viewer-entrance-item-delay, 0ms)');
        expect(body).toContain('var(--viewer-entrance-flash-offset)');
        expect(body).toContain('opacity: 0;');
        // Only the corner radius is read; the animated frame tokens (fill/border/blur) are never touched.
        expect(body).not.toMatch(/--frame-(fill|border|blur|accent)/);
        expect(body).not.toContain('transition');
    });

    it('traces the outline with a normalized dash offset and then fades it out', () => {
        expect(indexCss).toMatch(/@keyframes hmi-viewer-entrance-outline-draw\s*{[\s\S]*?stroke-dashoffset: 1;[\s\S]*?stroke-dashoffset: 0;/);
        expect(indexCss).toMatch(/@keyframes hmi-viewer-entrance-outline-fade\s*{[\s\S]*?opacity: var\(--viewer-entrance-outline-opacity\);[\s\S]*?opacity: 0;/);
        const rule = indexCss.match(/\[data-viewer-entrance='true'\] \.hmi-viewer-entrance-outline-rect\s*{([\s\S]*?)}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        // Corner radius follows the theme's frame radius (SVG geometry property), not a literal.
        expect(body).toContain('rx: var(--frame-radius-rest);');
        expect(body).toContain('ry: var(--frame-radius-rest);');
        expect(body).toContain('stroke-dasharray: 1 1;');
        expect(body).toContain('stroke: var(--viewer-entrance-outline-color);');
        expect(body).toContain('stroke-width: var(--viewer-entrance-outline-width);');
        expect(body).toContain('hmi-viewer-entrance-outline-draw');
        expect(body).toContain('hmi-viewer-entrance-outline-fade');
        expect(body).toContain('var(--viewer-entrance-item-delay, 0ms)');
        expect(body).toContain('opacity: 0;');
    });

    it('keeps the outline fade backwards-filled so the opacity token applies through the draw phase', () => {
        const rule = indexCss.match(/\[data-viewer-entrance='true'\] \.hmi-viewer-entrance-outline-rect\s*{([\s\S]*?)}/);
        const body = rule?.[1] ?? '';

        // Draw and fade share the element: without `backwards` on the fade, the line would be drawn at
        // the base opacity (0) instead of the configured --viewer-entrance-outline-opacity peak.
        expect(body).toMatch(/animation-fill-mode:\s*backwards,\s*backwards;/);
    });

    it('turns the flash and the outline off for reduced motion', () => {
        const reduced = [...indexCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\r?\n}\r?\n/g)]
            .map((match) => match[1])
            .join('\n');
        expect(reduced).toMatch(/\[data-viewer-entrance='true'\] \.hmi-viewer-entrance-flash\s*[,{][^}]*animation: none;/);
        expect(reduced).toMatch(/\[data-viewer-entrance='true'\] \.hmi-viewer-entrance-outline-rect\s*[,{][^}]*animation: none;/);
    });

    it('scopes EVERY entrance class rule under the viewer frame attribute (builder-safety guard)', () => {
        // Drop comments and keyframes bodies, then inspect every selector that mentions an
        // entrance class: each comma-separated part must carry the viewer scope.
        const withoutNoise = indexCss
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/@keyframes [\w-]+\s*{(?:[^{}]*{[^{}]*})*[^{}]*}/g, '');
        const selectors = [...withoutNoise.matchAll(/([^{}]+){/g)].map((match) => match[1].trim());
        const entranceSelectors = selectors
            .filter((selector) => selector.includes('.hmi-viewer-') && !selector.startsWith('@'))
            .flatMap((selector) => selector.split(','))
            .map((part) => part.trim())
            .filter((part) => part.includes('.hmi-viewer-'));

        expect(entranceSelectors.length).toBeGreaterThan(8);
        for (const part of entranceSelectors) {
            expect(part).toContain("[data-viewer-entrance='true']");
        }
    });
});
