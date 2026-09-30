import { act, render, screen, within } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { TAB_FRAME_GLOW_CLIP_MARGIN_PX, buildTabFrameGlowClipPath, buildTabFramePath } from '../../utils/tabFramePath';
import { GridFrameScope } from './GridFrameScope';
import WidgetFrame from './WidgetFrame';
import WidgetHeader from './WidgetHeader';

function renderFramed({
    widgetType = 'machine-activity',
    title = 'Actividad de Máquina',
    inGrid = true,
    dataMode,
    frameClassName = 'glass-panel',
    tabTitleFontSize,
}: {
    widgetType?: string;
    title?: string;
    inGrid?: boolean;
    dataMode?: 'real' | 'simulated';
    frameClassName?: string;
    tabTitleFontSize?: number;
} = {}) {
    const frame = (
        <WidgetFrame
            widgetType={widgetType}
            title={title}
            frameClassName={frameClassName}
            className="p-5 group relative w-full h-full"
            outerClassName="external-layout"
            tabTitleFontSize={tabTitleFontSize}
            data-state="producing"
        >
            <WidgetHeader title={title} icon={Activity} subtitle="PRODUCIENDO" dataMode={dataMode} dataModeTestId="widget-data-mode" iconTestId="frame-icon" />
            <p>Body content</p>
        </WidgetFrame>
    );

    return render(inGrid ? <GridFrameScope>{frame}</GridFrameScope> : frame);
}

describe('WidgetFrame', () => {
    afterEach(() => {
        resetFrameShapeOnDocument();
    });

    describe('standard shape (default)', () => {
        it('renders exactly one framed element carrying every class and no tab structure', () => {
            const { container } = renderFramed();

            const root = container.firstElementChild as HTMLElement;
            expect(root.tagName).toBe('DIV');
            expect(root).toHaveClass('glass-panel', 'p-5', 'group', 'relative', 'w-full', 'h-full', 'external-layout');
            expect(root).toHaveAttribute('data-state', 'producing');
            expect(container.querySelector('[data-testid="tab-frame-tab"]')).toBeNull();
            expect(container.querySelector('.hmi-tab-frame')).toBeNull();
            expect(within(root).getByText('Actividad de Máquina')).toBeInTheDocument();
        });

        it('keeps the title inside the body header, next to the icon row', () => {
            renderFramed();

            const title = screen.getByText('Actividad de Máquina');
            expect(title.closest('.glass-panel')).not.toBeNull();
            expect(screen.getByText('PRODUCIENDO')).toBeInTheDocument();
        });
    });

    describe('tab shape', () => {
        it('renders shell, painted surface, content and tab as siblings, keeping the outer size classes on the shell', () => {
            previewFrameShape('tab');

            const { container } = renderFramed();

            const shell = container.firstElementChild as HTMLElement;
            expect(shell).toHaveAttribute('data-widget-frame-shape', 'tab');
            expect(shell).toHaveClass('hmi-tab-frame', 'group', 'relative', 'w-full', 'h-full', 'external-layout');

            const surface = screen.getByTestId('tab-frame-surface');
            expect(surface).toHaveClass('glass-panel', 'hmi-tab-frame-surface');
            expect(surface).toHaveAttribute('aria-hidden', 'true');
            expect(surface.parentElement).toBe(shell);

            const border = within(surface).getByTestId('tab-frame-border');
            expect(border).toHaveClass('hmi-tab-frame-border');

            const content = screen.getByText('Body content').parentElement as HTMLElement;
            expect(content).toHaveClass('p-5', 'group', 'relative', 'w-full', 'h-full');
            expect(content).not.toHaveClass('glass-panel');
            expect(content).toHaveAttribute('data-state', 'producing');
            expect(content.parentElement).toBe(shell);
        });

        it('moves the title into the tab and keeps it out of the body header', () => {
            previewFrameShape('tab');

            renderFramed();

            const tab = screen.getByTestId('tab-frame-tab');
            expect(within(tab).getByText('Actividad de Máquina')).toBeInTheDocument();
            expect(screen.getAllByText('Actividad de Máquina')).toHaveLength(1);
        });

        it('keeps the subtitle and the icon in the body header (same structure, icon in the cut-corner slot)', () => {
            previewFrameShape('tab');

            renderFramed();

            const tab = screen.getByTestId('tab-frame-tab');
            const subtitle = screen.getByText('PRODUCIENDO');
            expect(tab).not.toContainElement(subtitle);
            expect(subtitle.closest('.hmi-tab-frame-surface')).toBeNull();

            const icon = screen.getByTestId('frame-icon');
            const slot = icon.closest('[data-tab-frame-slot="icon"]');
            expect(slot).not.toBeNull();
            expect(slot).toHaveClass('hmi-tab-frame-icon');
            expect(tab).not.toContainElement(icon);
        });

        it('reserves the title row height with an invisible spacer so nothing below it moves', () => {
            previewFrameShape('tab');

            renderFramed();

            const subtitle = screen.getByText('PRODUCIENDO');
            const header = subtitle.parentElement as HTMLElement;
            const rowOne = header.firstElementChild as HTMLElement;
            const spacer = rowOne.querySelector('.invisible');

            expect(spacer).not.toBeNull();
            expect(spacer).toHaveAttribute('aria-hidden', 'true');
            expect(subtitle).toHaveClass('row-start-2');
        });

        it('draws the data-mode dot inside the tab: muted for simulated, green for real', () => {
            previewFrameShape('tab');

            const { unmount } = renderFramed({ dataMode: 'simulated' });
            const simulatedDot = within(screen.getByTestId('tab-frame-tab')).getByTestId('widget-data-mode');
            // No own color class: it inherits the tab color (`bg-current`, the muted token), like the standard dot.
            expect(simulatedDot).toHaveClass('bg-current');
            expect(simulatedDot).not.toHaveClass('text-industrial-muted');
            expect(simulatedDot.style.color).toBe('');
            unmount();

            renderFramed({ dataMode: 'real' });
            const realDot = within(screen.getByTestId('tab-frame-tab')).getByTestId('widget-data-mode');
            expect(realDot).toHaveClass('text-status-normal');
        });

        it('gives the tab title the standard title behavior (muted, white on widget hover) through the tab text tokens', () => {
            previewFrameShape('tab');

            renderFramed();

            const title = screen.getByText('Actividad de Máquina');
            expect(screen.getByTestId('tab-frame-tab')).toContainElement(title);
            expect(title).toHaveClass('text-(color:--tab-frame-text)', 'group-hover:text-(color:--tab-frame-text-hover)', 'transition-colors');
            expect(title).not.toHaveClass('text-industrial-muted');
            expect(title.style.color).toBe('');
        });

        it('follows the shape live when it is toggled', () => {
            const { container } = renderFramed();
            expect(screen.queryByTestId('tab-frame-tab')).toBeNull();

            act(() => previewFrameShape('tab'));
            expect(screen.getByTestId('tab-frame-tab')).toBeInTheDocument();

            act(() => previewFrameShape('standard'));
            expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
            expect((container.firstElementChild as HTMLElement)).toHaveClass('glass-panel');
        });
    });

    describe('shape eligibility (tab selected)', () => {
        it('keeps the standard frame outside a dashboard grid (pages, dialogs)', () => {
            previewFrameShape('tab');

            const { container } = renderFramed({ inGrid: false });

            expect(container.firstElementChild).toHaveClass('glass-panel');
            expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
        });

        it.each(['activity-analytics', 'prod-trend', 'prod-history', 'trend-chart', 'trend-chart-v2', 'status', 'text-title', 'connection-status', 'alert-history'])(
            'keeps the standard frame for %s',
            (widgetType) => {
                previewFrameShape('tab');

                const { container } = renderFramed({ widgetType });

                expect(container.firstElementChild).toHaveClass('glass-panel');
                expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
            },
        );

        it('keeps the standard frame for an untitled widget', () => {
            previewFrameShape('tab');

            const { container } = renderFramed({ title: '   ' });

            expect(container.firstElementChild).toHaveClass('glass-panel');
            expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
        });
    });

    describe('tab width reporting (for the layers that follow the silhouette)', () => {
        function mockTabWidth(width: number) {
            return vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidthMock(this: HTMLElement) {
                return this.dataset.testid === 'tab-frame-tab' ? width : 0;
            });
        }

        function renderReporting(onTabWidth: (width: number | null) => void) {
            return render(
                <GridFrameScope onTabWidth={onTabWidth}>
                    <WidgetFrame widgetType="machine-activity" title="Actividad" frameClassName="glass-panel" className="p-5">
                        <WidgetHeader title="Actividad" icon={Activity} />
                    </WidgetFrame>
                </GridFrameScope>,
            );
        }

        it('reports the tab width while the tab shape is rendered and null when it goes away', () => {
            previewFrameShape('tab');
            const offsetWidth = mockTabWidth(180);
            const onTabWidth = vi.fn();

            const { unmount } = renderReporting(onTabWidth);

            expect(onTabWidth).toHaveBeenLastCalledWith(180);

            unmount();
            expect(onTabWidth).toHaveBeenLastCalledWith(null);
            offsetWidth.mockRestore();
        });

        it('reports an unmeasured tab (width 0) as PENDING (0), never as the standard shape (null)', () => {
            previewFrameShape('tab');
            const offsetWidth = mockTabWidth(0);
            const onTabWidth = vi.fn();

            renderReporting(onTabWidth);

            expect(onTabWidth).toHaveBeenCalledWith(0);
            expect(onTabWidth).not.toHaveBeenCalledWith(null);
            offsetWidth.mockRestore();
        });

        it('reports nothing in the standard shape', () => {
            const onTabWidth = vi.fn();

            renderReporting(onTabWidth);

            expect(onTabWidth).not.toHaveBeenCalled();
        });

        it('reports null when the shape switches back to standard', () => {
            previewFrameShape('tab');
            const offsetWidth = mockTabWidth(180);
            const onTabWidth = vi.fn();

            renderReporting(onTabWidth);
            expect(onTabWidth).toHaveBeenLastCalledWith(180);

            act(() => previewFrameShape('standard'));
            expect(onTabWidth).toHaveBeenLastCalledWith(null);
            offsetWidth.mockRestore();
        });
    });

    describe('unified silhouette (measured box)', () => {
        const GEOMETRY = { width: 300, height: 200, tabWidth: 180, tabHeight: 25, tabCut: 25, bodyCut: 50, radius: 4, glowSpread: 2 };
        const TOKENS: Record<string, string> = {
            '--tab-frame-height': '25px',
            '--tab-frame-tab-cut': '25px',
            '--tab-frame-body-cut': '50px',
            '--tab-frame-glow-spread': '2px',
        };

        function mockLayout(tabWidth = 180) {
            vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
            vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
            vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidthMock(this: HTMLElement) {
                return this.dataset.testid === 'tab-frame-tab' ? tabWidth : 0;
            });
            vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
                getPropertyValue: (name: string) => TOKENS[name] ?? '',
                borderTopLeftRadius: '4px',
                fontSize: '16px',
            }) as unknown as CSSStyleDeclaration);
        }

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('clips the painted surface to the rounded unified path (tab + body), not to a polygon', () => {
            previewFrameShape('tab');
            mockLayout();

            renderFramed();

            expect(screen.getByTestId('tab-frame-surface').style.clipPath).toBe(`path('${buildTabFramePath(GEOMETRY)}')`);
        });

        it('draws the rest border as a stroke of the same path, inside the surface', () => {
            previewFrameShape('tab');
            mockLayout();

            renderFramed();

            const border = screen.getByTestId('tab-frame-border');
            expect(border.closest('[data-testid="tab-frame-surface"]')).not.toBeNull();
            expect(border).toHaveClass('hmi-tab-frame-border');
            expect(border.querySelector('path')?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY));
        });

        it('paints the tab fill inside the surface so it takes the same silhouette', () => {
            previewFrameShape('tab');
            mockLayout();

            renderFramed();

            const fill = screen.getByTestId('tab-frame-fill');
            expect(fill).toHaveClass('hmi-tab-frame-fill');
            expect(fill.closest('[data-testid="tab-frame-surface"]')).not.toBeNull();
        });

        it('keeps the CSS fallback (no inline path, no border stroke) while the tab is not measured', () => {
            previewFrameShape('tab');
            mockLayout(0);

            renderFramed();

            expect(screen.getByTestId('tab-frame-surface').style.clipPath).toBe('');
            expect(screen.getByTestId('tab-frame-border').querySelector('path')).toBeNull();
        });

        it('has no alert glow for a normal widget', () => {
            previewFrameShape('tab');
            mockLayout();

            const { container } = renderFramed();

            expect(container.querySelector('[data-testid="tab-frame-glow"]')).toBeNull();
            expect(container.firstElementChild).not.toHaveAttribute('data-alert-state');
        });

        it.each(['warning', 'critical'])('marks the shell and draws the %s glow along the unified silhouette, only outside it', (state) => {
            previewFrameShape('tab');
            mockLayout();

            const { container } = renderFramed({ frameClassName: `widget-state-${state}` });

            expect(container.firstElementChild).toHaveAttribute('data-alert-state', state);

            const glow = screen.getByTestId('tab-frame-glow');
            expect(glow).toHaveClass('hmi-tab-frame-glow');
            expect(glow).toHaveAttribute('data-alert-state', state);
            expect(glow.style.clipPath).toBe(`path(evenodd, '${buildTabFrameGlowClipPath(GEOMETRY, TAB_FRAME_GLOW_CLIP_MARGIN_PX)}')`);
            // The glow layer sits BEHIND the surface and its shape is the silhouette grown by the spread.
            expect(glow.nextElementSibling).toBe(screen.getByTestId('tab-frame-surface'));
            const shape = within(glow).getByTestId('tab-frame-glow-shape');
            expect(shape.style.clipPath).toBe(`path('${buildTabFramePath(GEOMETRY, -2)}')`);
        });

        it('colors the tab title with the alert color and follows the state live', () => {
            previewFrameShape('tab');
            mockLayout();

            const framed = (frameClassName: string) => (
                <GridFrameScope>
                    <WidgetFrame widgetType="machine-activity" title="Actividad" frameClassName={frameClassName} className="p-5">
                        <WidgetHeader title="Actividad" icon={Activity} />
                    </WidgetFrame>
                </GridFrameScope>
            );
            const { rerender } = render(framed('widget-state-warning'));
            expect(screen.getByText('Actividad')).toHaveClass('text-status-warning');
            expect(document.querySelector('.hmi-tab-frame')).toHaveAttribute('data-alert-state', 'warning');

            rerender(framed('widget-state-critical'));
            expect(screen.getByText('Actividad')).toHaveClass('text-status-critical');
            expect(document.querySelector('.hmi-tab-frame')).toHaveAttribute('data-alert-state', 'critical');

            rerender(framed('glass-panel'));
            expect(screen.getByText('Actividad')).not.toHaveClass('text-status-critical');
            expect(screen.getByText('Actividad')).toHaveClass('text-(color:--tab-frame-text)');
            expect(document.querySelector('.hmi-tab-frame')).not.toHaveAttribute('data-alert-state');
        });
    });

    describe('header icon placement (tab shape)', () => {
        const BASE_TOKENS: Record<string, string> = {
            '--tab-frame-height': '25px',
            '--tab-frame-tab-cut': '19px',
            '--tab-frame-body-cut': '0px',
            '--tab-frame-glow-spread': '2px',
            '--tab-frame-icon-right': '0px',
            '--tab-frame-icon-gap': '4px',
            '--tab-frame-icon-clearance': '3px',
            '--tab-frame-icon-min-top': '0px',
            '--tab-frame-icon-tab-gap': '8px',
            '--tab-frame-icon-scale': '0.9',
        };

        function mockTokens(overrides: Record<string, string> = {}) {
            const tokens = { ...BASE_TOKENS, ...overrides };
            vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
            vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
            vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
                getPropertyValue: (name: string) => tokens[name] ?? '',
                borderTopLeftRadius: '5px',
                fontSize: '16px',
            }) as unknown as CSSStyleDeclaration);
        }

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('draws the icon in a host of the shell (its border box) and keeps an invisible placeholder in the header row', () => {
            previewFrameShape('tab');
            mockTokens();

            const { container } = renderFramed();

            const shell = container.firstElementChild as HTMLElement;
            const host = within(shell).getByTestId('tab-frame-icon-host');
            expect(host).toHaveClass('hmi-tab-frame-icon-host');
            expect(host.parentElement).toBe(shell);
            expect(within(host).getByTestId('frame-icon')).toBeInTheDocument();

            const subtitle = screen.getByText('PRODUCIENDO');
            const rowOne = (subtitle.parentElement as HTMLElement).firstElementChild as HTMLElement;
            const placeholder = rowOne.querySelector('[data-tab-frame-slot="icon-placeholder"]') as HTMLElement;
            expect(placeholder).not.toBeNull();
            expect(placeholder).toHaveClass('invisible');
            expect(placeholder).toHaveAttribute('aria-hidden', 'true');
            expect(within(rowOne).queryByTestId('frame-icon')).toBeNull();
        });

        it('with no body chamfer the icon sits in the tab strip at the top edge and the tab reserves its width', () => {
            previewFrameShape('tab');
            mockTokens();

            const { container } = renderFramed();

            const shell = container.firstElementChild as HTMLElement;
            expect(shell.style.getPropertyValue('--tab-frame-icon-top')).toBe('0px');
            // right 0 + icon 24 x 0.9 + gap 8
            expect(shell.style.getPropertyValue('--tab-frame-icon-reserve')).toBe('29.6px');
        });

        it('with a large body chamfer the icon sits just below the body top line and the tab only clears the chamfer', () => {
            previewFrameShape('tab');
            mockTokens({ '--tab-frame-body-cut': '100px' });

            const { container } = renderFramed();

            const shell = container.firstElementChild as HTMLElement;
            expect(shell.style.getPropertyValue('--tab-frame-icon-top')).toBe('29px');
            expect(shell.style.getPropertyValue('--tab-frame-icon-reserve')).toBe('100px');
        });

        it('with a small chamfer the icon moves up just enough to stay inside the cut triangle', () => {
            previewFrameShape('tab');
            mockTokens({ '--tab-frame-body-cut': '50px' });

            const { container } = renderFramed();

            // maxTop = 25 + 50 - 0 - 2 x 21.6 - 3 = 28.8, just above the preferred 29
            expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--tab-frame-icon-top')).toBe('28.8px');
        });

        it('publishes no icon placement in the standard shape', () => {
            mockTokens();

            const { container } = renderFramed();

            expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--tab-frame-icon-top')).toBe('');
            expect(screen.queryByTestId('tab-frame-icon-host')).toBeNull();
        });
    });

    describe('title with its own size (group): a taller tab', () => {
        const OWN_SIZE_TOKENS: Record<string, string> = {
            '--tab-frame-height': '25px',
            '--tab-frame-tab-cut': '19px',
            '--tab-frame-body-cut': '0px',
            '--tab-frame-glow-spread': '2px',
            '--tab-frame-title-pad-y': '4.25px',
            '--tab-frame-icon-right': '0px',
            '--tab-frame-icon-gap': '4px',
            '--tab-frame-icon-clearance': '3px',
            '--tab-frame-icon-min-top': '0px',
            '--tab-frame-icon-tab-gap': '8px',
            '--tab-frame-icon-scale': '0.9',
        };

        function mockOwnSizeLayout(overrides: Record<string, string> = {}, tabWidth = 180) {
            const tokens = { ...OWN_SIZE_TOKENS, ...overrides };
            vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
            vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
            vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidthMock(this: HTMLElement) {
                return this.dataset.testid === 'tab-frame-tab' ? tabWidth : 0;
            });
            vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
                getPropertyValue: (name: string) => tokens[name] ?? '',
                borderTopLeftRadius: '4px',
                fontSize: '16px',
            }) as unknown as CSSStyleDeclaration);
        }

        const shellOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('sets the effective tab height on the shell: the title line box plus the breathing space above and below', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            const { container } = renderFramed({ tabTitleFontSize: 35 });

            // 35 x 1.1 + 2 x 4.25
            expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('47px');
        });

        it('keeps the slanted side at the angle of the standard tab: the shell publishes the cut scaled with the height (19 x 47 / 25)', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            const { container } = renderFramed({ tabTitleFontSize: 35 });

            expect(shellOf(container).style.getPropertyValue('--tab-frame-tab-cut')).toBe('35.72px');
        });

        it('follows the title size live with the cut', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();
            const framed = (size: number) => (
                <GridFrameScope>
                    <WidgetFrame widgetType="group" title="Grupo" frameClassName="glass-panel" className="p-5" tabTitleFontSize={size}>
                        <WidgetHeader title="Grupo" icon={Activity} />
                    </WidgetFrame>
                </GridFrameScope>
            );
            const { container, rerender } = render(framed(35));
            expect(shellOf(container).style.getPropertyValue('--tab-frame-tab-cut')).toBe('35.72px');

            rerender(framed(60));

            expect(shellOf(container).style.getPropertyValue('--tab-frame-tab-cut')).toBe('56.62px');
        });

        it('keeps the token cut when the own size does not make the tab taller than the standard one', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            const { container } = renderFramed({ tabTitleFontSize: 12 });

            expect(shellOf(container).style.getPropertyValue('--tab-frame-tab-cut')).toBe('19px');
        });

        it('publishes no cut for a tab without its own size (the token applies untouched)', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            const { container } = renderFramed();

            expect(shellOf(container).style.getPropertyValue('--tab-frame-tab-cut')).toBe('');
            expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('');
        });

        it('publishes a finite token cut when the base height token cannot scale (zero)', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout({ '--tab-frame-height': '0px' });

            const { container } = renderFramed({ tabTitleFontSize: 35 });

            expect(shellOf(container).style.getPropertyValue('--tab-frame-tab-cut')).toBe('19px');
        });

        it('never makes the tab shorter than the standard tab height', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            const { container } = renderFramed({ tabTitleFontSize: 12 });

            expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('25px');
        });

        it('follows the title size live', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();
            const framed = (size: number) => (
                <GridFrameScope>
                    <WidgetFrame widgetType="group" title="Grupo" frameClassName="glass-panel" className="p-5" tabTitleFontSize={size}>
                        <WidgetHeader title="Grupo" icon={Activity} />
                    </WidgetFrame>
                </GridFrameScope>
            );
            const { container, rerender } = render(framed(35));
            expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('47px');

            rerender(framed(60));

            expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('74.5px');
        });

        it('draws the unified silhouette with the taller tab (clip, border, glow)', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();
            const geometry = { width: 300, height: 200, tabWidth: 180, tabHeight: 47, tabCut: 35.72, bodyCut: 0, radius: 4, glowSpread: 2 };

            renderFramed({ tabTitleFontSize: 35, frameClassName: 'widget-state-warning' });

            expect(screen.getByTestId('tab-frame-surface').style.clipPath).toBe(`path('${buildTabFramePath(geometry)}')`);
            expect(screen.getByTestId('tab-frame-border').querySelector('path')?.getAttribute('d')).toBe(buildTabFramePath(geometry));
            expect(screen.getByTestId('tab-frame-glow').style.clipPath).toBe(
                `path(evenodd, '${buildTabFrameGlowClipPath(geometry, TAB_FRAME_GLOW_CLIP_MARGIN_PX)}')`,
            );
        });

        it('places the header icon by the icon rule with the taller tab', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout({ '--tab-frame-body-cut': '100px' });

            const { container } = renderFramed({ tabTitleFontSize: 35 });

            // preferred top = tab height 47 + gap 4 (25 + 4 = 29 with the standard tab)
            expect(shellOf(container).style.getPropertyValue('--tab-frame-icon-top')).toBe('51px');
        });

        it('reports the tab height next to the tab width for the layers outside the shell', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();
            const onTabWidth = vi.fn();

            render(
                <GridFrameScope onTabWidth={onTabWidth}>
                    <WidgetFrame widgetType="group" title="Grupo" frameClassName="glass-panel" className="p-5" tabTitleFontSize={35}>
                        <WidgetHeader title="Grupo" icon={Activity} />
                    </WidgetFrame>
                </GridFrameScope>,
            );

            expect(onTabWidth).toHaveBeenLastCalledWith(180, 47);
        });

        describe('on a widget too short for the requested tab', () => {
            afterEach(() => {
                vi.unstubAllGlobals();
            });

            it('caps the tab on the new shell when the shape switches to tab while mounted', () => {
                mockOwnSizeLayout();
                vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);

                const { container } = renderFramed({ tabTitleFontSize: 200 });
                act(() => previewFrameShape('tab'));
                expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('52px');

                act(() => previewFrameShape('standard'));
                act(() => previewFrameShape('tab'));
                expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('52px');
            });

            it('caps the tab at the shell height minus the minimum body (chamfer + 2 x radius)', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout();
                vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);

                const { container } = renderFramed({ tabTitleFontSize: 200 });

                // 60 - (0 + 2 x 4) instead of 200 x 1.1 + 2 x 4.25 = 228.5
                expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('52px');
            });

            it('uses the body chamfer token in the minimum body', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout({ '--tab-frame-body-cut': '10px' });
                vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);

                const { container } = renderFramed({ tabTitleFontSize: 200 });

                expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('42px');
            });

            it('draws the silhouette, the border and the glow with the capped height, never inverted', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout();
                vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
                const geometry = { width: 300, height: 60, tabWidth: 180, tabHeight: 52, tabCut: 39.52, bodyCut: 0, radius: 4, glowSpread: 2 };

                renderFramed({ tabTitleFontSize: 200, frameClassName: 'widget-state-warning' });

                expect(screen.getByTestId('tab-frame-surface').style.clipPath).toBe(`path('${buildTabFramePath(geometry)}')`);
                expect(screen.getByTestId('tab-frame-border').querySelector('path')?.getAttribute('d')).toBe(buildTabFramePath(geometry));
                expect(screen.getByTestId('tab-frame-glow').style.clipPath).toBe(
                    `path(evenodd, '${buildTabFrameGlowClipPath(geometry, TAB_FRAME_GLOW_CLIP_MARGIN_PX)}')`,
                );
            });

            it('scales the cut with the capped height, not with the requested one', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout();
                vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);

                const { container } = renderFramed({ tabTitleFontSize: 200 });

                // 19 x 52 / 25 (the uncapped 228.5 px tab would ask for 173.66).
                expect(shellOf(container).style.getPropertyValue('--tab-frame-tab-cut')).toBe('39.52px');
            });

            it('reports the SAME capped, finite height to the layers outside the shell', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout();
                vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
                const onTabWidth = vi.fn();

                const { container } = render(
                    <GridFrameScope onTabWidth={onTabWidth}>
                        <WidgetFrame widgetType="group" title="Grupo" frameClassName="glass-panel" className="p-5" tabTitleFontSize={200}>
                            <WidgetHeader title="Grupo" icon={Activity} />
                        </WidgetFrame>
                    </GridFrameScope>,
                );

                const shellHeight = Number.parseFloat(shellOf(container).style.getPropertyValue('--tab-frame-height'));
                expect(Number.isFinite(shellHeight)).toBe(true);
                expect(shellHeight).toBe(52);
                expect(onTabWidth).toHaveBeenLastCalledWith(180, shellHeight);
            });

            it('places the icon with the capped height', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout({ '--tab-frame-body-cut': '10px' });
                vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);

                const { container } = renderFramed({ tabTitleFontSize: 200 });

                // The preferred top is the capped tab (42) + gap (4); the uncapped tab would put it at 232.5.
                const top = Number.parseFloat(shellOf(container).style.getPropertyValue('--tab-frame-icon-top'));
                expect(Number.isFinite(top)).toBe(true);
                expect(top).toBeLessThanOrEqual(42 + 4);
            });

            it('re-caps live when the widget is resized', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout();
                const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
                const observers: Array<() => void> = [];
                vi.stubGlobal('ResizeObserver', class {
                    constructor(callback: () => void) {
                        observers.push(callback);
                    }
                    observe() {}
                    disconnect() {}
                    unobserve() {}
                });

                const { container } = renderFramed({ tabTitleFontSize: 200 });
                expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('228.5px');

                clientHeight.mockReturnValue(100);
                act(() => observers.forEach((callback) => callback()));

                expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('92px');
            });

            it('leaves the requested tab untouched on a normal-size widget (no cap, same 47 px)', () => {
                previewFrameShape('tab');
                mockOwnSizeLayout();

                const { container } = renderFramed({ tabTitleFontSize: 35 });

                expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('47px');
            });
        });

        it('gives the tab title the typography of the text-title widget, without uppercase', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            renderFramed({ title: 'Área compresión', tabTitleFontSize: 35 });

            const title = within(screen.getByTestId('tab-frame-tab')).getByText('Área compresión');
            expect(title.style.fontFamily).toBe('var(--font-dashboard-title)');
            expect(title.style.fontWeight).toBe('var(--font-weight-dashboard-title)');
            expect(title.style.letterSpacing).toBe('var(--tracking-dashboard-title)');
            expect(title.style.fontSize).toBe('35px');
            expect(title.style.lineHeight).toBe('1.1');
            expect(title).not.toHaveClass('uppercase');
        });

        it('keeps the tab title colors of the other tabs (rest, hover, transition)', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            renderFramed({ title: 'Área compresión', tabTitleFontSize: 35 });

            const title = within(screen.getByTestId('tab-frame-tab')).getByText('Área compresión');
            expect(title).toHaveClass('text-(color:--tab-frame-text)', 'group-hover:text-(color:--tab-frame-text-hover)', 'transition-colors');
            expect(title.style.color).toBe('');
        });

        it('gives the title its own breathing space as padding so the truncation never clips ascenders or descenders', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();

            renderFramed({ title: 'Área compresión', tabTitleFontSize: 35 });

            const title = within(screen.getByTestId('tab-frame-tab')).getByText('Área compresión');
            expect(title.style.paddingTop).toBe('var(--tab-frame-title-pad-y)');
            expect(title.style.paddingBottom).toBe('var(--tab-frame-title-pad-y)');
        });

        it('leaves every other tab frame exactly as before (no own size: no height override, uppercase title)', () => {
            previewFrameShape('tab');
            mockOwnSizeLayout();
            const onTabWidth = vi.fn();

            const { container } = render(
                <GridFrameScope onTabWidth={onTabWidth}>
                    <WidgetFrame widgetType="machine-activity" title="Actividad" frameClassName="glass-panel" className="p-5">
                        <WidgetHeader title="Actividad" icon={Activity} />
                    </WidgetFrame>
                </GridFrameScope>,
            );

            expect(shellOf(container).style.getPropertyValue('--tab-frame-height')).toBe('');
            expect(onTabWidth).toHaveBeenLastCalledWith(180);
            const title = screen.getByText('Actividad');
            expect(title).toHaveClass('uppercase');
            expect(title.style.fontSize).toBe('');
        });

        it('has no effect in the standard shape (same single element, title inside the body)', () => {
            mockOwnSizeLayout();

            const { container } = renderFramed({ tabTitleFontSize: 35 });

            const root = container.firstElementChild as HTMLElement;
            expect(root).toHaveClass('glass-panel');
            expect(root.style.getPropertyValue('--tab-frame-height')).toBe('');
            expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
            expect(screen.getByText('Actividad de Máquina')).toHaveClass('uppercase');
            expect(screen.getByText('Actividad de Máquina').style.fontSize).toBe('');
        });
    });
});
