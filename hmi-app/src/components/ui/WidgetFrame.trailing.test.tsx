import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrendingUp } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { TAB_FRAME_TITLE_HIDDEN, buildTabFramePath } from '../../utils/tabFramePath';
import { GridFrameScope } from './GridFrameScope';
import WidgetFrame from './WidgetFrame';
import WidgetHeader from './WidgetHeader';
import WidgetHeaderTemporalControls from './WidgetHeaderTemporalControls';

// Chart widgets (scale selector in `WidgetHeader.trailing`) in the tab frame shape: the selector moves
// up into the top strip, left of the icon; the title tab stops before it and is hidden when it cannot
// keep a minimal label; the header row no longer takes height. jsdom has no layout, so the box, the
// host and the tokens are injected.
const TOKENS: Record<string, string> = {
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
    '--tab-frame-pad-start': '10px',
    '--tab-frame-pad-end': '4.8px',
    '--tab-frame-trailing-gap': '15px',
    '--tab-frame-min-title': '12px',
};

function mockLayout({ frameWidth, hostWidth, tabWidth = 90 }: { frameWidth: number; hostWidth: number; tabWidth?: number }) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(frameWidth);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidthMock(this: HTMLElement) {
        if (this.dataset.testid === 'tab-frame-tab') {
            return tabWidth;
        }

        return this.dataset.testid === 'tab-frame-trailing-host' ? hostWidth : 0;
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
        getPropertyValue: (name: string) => TOKENS[name] ?? '',
        borderTopLeftRadius: '4px',
        fontSize: '16px',
        paddingTop: '20px',
        borderTopWidth: '1px',
    }) as unknown as CSSStyleDeclaration);
}

interface ChartOptions {
    widgetType?: string;
    withTrailing?: boolean;
    onSelect?: (value: string) => void;
    onTabWidth?: (width: number | null, height?: number) => void;
    subtitle?: string;
}

function chart({ widgetType = 'machine-activity', withTrailing = true, onSelect = () => undefined, subtitle }: ChartOptions = {}) {
    return (
        <WidgetFrame widgetType={widgetType} title="Temperatura" frameClassName="glass-panel" className="p-5 group relative w-full h-full">
            <WidgetHeader
                title="Temperatura"
                icon={TrendingUp}
                iconPosition="left"
                subtitle={subtitle}
                iconTestId="chart-icon"
                className="mb-0 shrink-0 min-w-0"
                trailing={withTrailing ? (
                    <WidgetHeaderTemporalControls
                        variant="pill"
                        testId="chart-selector"
                        groups={[{
                            options: [{ value: '1h', label: '1h' }, { value: '24h', label: '24h' }],
                            selectedValue: '1h',
                            onSelect,
                        }]}
                    />
                ) : undefined}
            />
            <p>Chart body</p>
        </WidgetFrame>
    );
}

function renderChart(options: ChartOptions = {}) {
    return render(<GridFrameScope onTabWidth={options.onTabWidth}>{chart(options)}</GridFrameScope>);
}

describe('WidgetFrame with header trailing content (chart selector)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetFrameShapeOnDocument();
    });

    describe('standard shape (guard: nothing changes)', () => {
        it('renders one framed element with the icon on the left and the selector in the header row', () => {
            const { container } = renderChart();

            const root = container.firstElementChild as HTMLElement;
            expect(root).toHaveClass('glass-panel', 'p-5');
            expect(container.querySelector('.hmi-tab-frame')).toBeNull();
            expect(within(root).getByTestId('chart-selector')).toBeInTheDocument();
            expect(root.querySelector('.hmi-tab-frame-header-clearance')).toBeNull();
            expect(within(root).getByText('Temperatura')).toBeInTheDocument();
            // The selector keeps the pill look with the standard frame.
            expect(within(screen.getByTestId('chart-selector')).getByRole('button', { name: '1h' }).className).toContain('theme-button');
        });
    });

    describe('tab shape', () => {
        it('portals the trailing content into a host of the shell, before the content in tab order', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });

            const { container } = renderChart();

            const shell = container.firstElementChild as HTMLElement;
            const host = within(shell).getByTestId('tab-frame-trailing-host');
            expect(host).toHaveClass('hmi-tab-frame-trailing-host');
            expect(host.parentElement).toBe(shell);
            expect(within(host).getByTestId('chart-selector')).toBeInTheDocument();
            // The painted surface stays right before the content (the content reserves the border width).
            const surface = screen.getByTestId('tab-frame-surface');
            expect(surface.nextElementSibling).toBe(screen.getByText('Chart body').parentElement);
            // The selector comes before the chart content for the keyboard.
            expect(host.compareDocumentPosition(screen.getByText('Chart body')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('draws the title in the tab and the icon in the icon host, even though the header has the icon on the left', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });

            renderChart();

            expect(within(screen.getByTestId('tab-frame-tab')).getByText('Temperatura')).toBeInTheDocument();
            expect(within(screen.getByTestId('tab-frame-icon-host')).getByTestId('chart-icon')).toBeInTheDocument();
            expect(screen.getAllByText('Temperatura')).toHaveLength(1);
        });

        it('takes no height in the body: the header keeps only the clearance under the strip', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });

            renderChart();

            const content = screen.getByText('Chart body').parentElement as HTMLElement;
            const header = content.firstElementChild as HTMLElement;
            expect(header).toHaveClass('mb-0', 'shrink-0', 'min-w-0');
            expect(header.querySelector('.invisible')).toBeNull();
            expect(header.querySelector('[data-tab-frame-slot="icon-placeholder"]')).toBeNull();
            expect(within(header).queryByTestId('chart-selector')).toBeNull();
            expect(header.querySelector('.hmi-tab-frame-header-clearance')).not.toBeNull();
        });

        it('keeps a header subtitle in the body, under the clearance (characterization: implemented with the collapsed header)', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });

            renderChart({ subtitle: 'ULTIMA HORA' });

            const subtitle = screen.getByText('ULTIMA HORA');
            const header = subtitle.parentElement as HTMLElement;
            expect(subtitle).toHaveClass('row-start-2');
            expect(header.querySelector('.hmi-tab-frame-header-clearance')).not.toBeNull();
            expect(screen.getByTestId('tab-frame-tab')).not.toContainElement(subtitle);
        });

        it('publishes the clearance: the tab height minus the padding and the border above the header (25 - 20 - 1)', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });

            const { container } = renderChart();

            expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--tab-frame-header-clearance')).toBe('4px');
        });

        it('makes the tab stop before the selector: reserve = right offset + host width + one gap', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });

            const { container } = renderChart();

            const shell = container.firstElementChild as HTMLElement;
            expect(shell.style.getPropertyValue('--tab-frame-tab-reserve')).toBe('172px');
        });

        it('leaves the icon its scaled width plus one gap at the end of the host (the selector stops one gap before it)', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });

            const { container } = renderChart();

            // 24 x 0.9 + 15
            expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--tab-frame-icon-strip-extent')).toBe('36.6px');
        });

        it('keeps the title tab and reports its measured width while there is room for the label', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157, tabWidth: 90 });
            const onTabWidth = vi.fn();

            const { container } = renderChart({ onTabWidth });

            expect(container.firstElementChild).not.toHaveAttribute('data-tab-title-hidden');
            expect(onTabWidth).toHaveBeenLastCalledWith(90);
            expect(screen.getByTestId('tab-frame-surface').style.clipPath)
                .toBe(`path('${buildTabFramePath({ width: 460, height: 200, tabWidth: 90, tabHeight: 25, tabCut: 19, bodyCut: 0, radius: 4, glowSpread: 2 })}')`);
        });

        it('hides the title tab cleanly when less than the minimum room is left, and every consumer gets the silhouette without it', () => {
            previewFrameShape('tab');
            // 172 reserve + 19 cut + 10 + 4.8 paddings = 205.8; 210 leaves 4.2 px < 12 px.
            mockLayout({ frameWidth: 210, hostWidth: 157, tabWidth: 90 });
            const onTabWidth = vi.fn();

            const { container } = renderChart({ onTabWidth });

            expect(container.firstElementChild).toHaveAttribute('data-tab-title-hidden', 'true');
            expect(onTabWidth).toHaveBeenLastCalledWith(TAB_FRAME_TITLE_HIDDEN);
            const noTab = { width: 210, height: 200, tabWidth: 0, tabHeight: 25, tabCut: 19, bodyCut: 0, radius: 4, glowSpread: 2 };
            expect(screen.getByTestId('tab-frame-surface').style.clipPath).toBe(`path('${buildTabFramePath(noTab)}')`);
            expect(screen.getByTestId('tab-frame-border').querySelector('path')?.getAttribute('d')).toBe(buildTabFramePath(noTab));
        });

        it('shows the title tab again when the frame gets wide enough (re-measured on resize)', () => {
            const callbacks: Array<() => void> = [];
            class FakeResizeObserver {
                constructor(callback: () => void) {
                    callbacks.push(callback);
                }

                observe() {}

                unobserve() {}

                disconnect() {}
            }
            vi.stubGlobal('ResizeObserver', FakeResizeObserver);
            previewFrameShape('tab');
            mockLayout({ frameWidth: 210, hostWidth: 157 });
            const { container } = renderChart();
            expect(container.firstElementChild).toHaveAttribute('data-tab-title-hidden', 'true');

            vi.restoreAllMocks();
            mockLayout({ frameWidth: 400, hostWidth: 157 });
            act(() => callbacks.forEach((callback) => callback()));

            expect(container.firstElementChild).not.toHaveAttribute('data-tab-title-hidden');
            vi.unstubAllGlobals();
        });

        it('keeps the selector clickable and focusable inside the strip host (keyboard order: selector before the chart)', async () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 460, hostWidth: 157 });
            const user = userEvent.setup();
            const onSelect = vi.fn();

            renderChart({ onSelect });

            // The first stop of the keyboard is the selector (the chart content follows it in the DOM).
            await user.tab();
            expect(within(screen.getByTestId('tab-frame-trailing-host')).getByRole('button', { name: '1h' })).toHaveFocus();

            await user.click(within(screen.getByTestId('tab-frame-trailing-host')).getByRole('button', { name: '24h' }));
            expect(onSelect).toHaveBeenCalledWith('24h');
        });

        it('leaves a frame without trailing content exactly as before: no reserve override, no hidden title, no clearance', () => {
            previewFrameShape('tab');
            mockLayout({ frameWidth: 60, hostWidth: 0 });

            const { container } = renderChart({ widgetType: 'kpi', withTrailing: false });

            const shell = container.firstElementChild as HTMLElement;
            expect(shell).not.toHaveAttribute('data-tab-title-hidden');
            expect(shell.style.getPropertyValue('--tab-frame-tab-reserve')).toBe('');
            expect(shell.style.getPropertyValue('--tab-frame-icon-strip-extent')).toBe('');
            expect(screen.getByTestId('tab-frame-trailing-host')).toBeEmptyDOMElement();
        });
    });
});
