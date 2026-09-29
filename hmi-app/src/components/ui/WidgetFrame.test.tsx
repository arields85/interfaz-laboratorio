import { act, render, screen, within } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { GridFrameScope } from './GridFrameScope';
import WidgetFrame from './WidgetFrame';
import WidgetHeader from './WidgetHeader';

function renderFramed({
    widgetType = 'machine-activity',
    title = 'Actividad de Máquina',
    inGrid = true,
    dataMode,
}: {
    widgetType?: string;
    title?: string;
    inGrid?: boolean;
    dataMode?: 'real' | 'simulated';
} = {}) {
    const frame = (
        <WidgetFrame
            widgetType={widgetType}
            title={title}
            frameClassName="glass-panel"
            className="p-5 group relative w-full h-full"
            outerClassName="external-layout"
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

        it('draws the data-mode dot inside the tab: dark for simulated, green for real', () => {
            previewFrameShape('tab');

            const { unmount } = renderFramed({ dataMode: 'simulated' });
            const simulatedDot = within(screen.getByTestId('tab-frame-tab')).getByTestId('widget-data-mode');
            // No own color: it inherits the tab text color (`bg-current`), not the muted body gray.
            expect(simulatedDot).toHaveClass('bg-current');
            expect(simulatedDot).not.toHaveClass('text-industrial-muted');
            expect(simulatedDot.style.color).toBe('');
            unmount();

            renderFramed({ dataMode: 'real' });
            const realDot = within(screen.getByTestId('tab-frame-tab')).getByTestId('widget-data-mode');
            expect(realDot).toHaveClass('text-status-normal');
        });

        it('leaves the title color to the tab (inherits its text token) instead of the muted body color', () => {
            previewFrameShape('tab');

            renderFramed();

            const title = screen.getByText('Actividad de Máquina');
            expect(screen.getByTestId('tab-frame-tab')).toContainElement(title);
            expect(title).not.toHaveClass('text-industrial-muted');
            expect(title).not.toHaveClass('group-hover:text-white');
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

        it('treats an unmeasured tab (width 0) as unknown', () => {
            previewFrameShape('tab');
            const offsetWidth = mockTabWidth(0);
            const onTabWidth = vi.fn();

            renderReporting(onTabWidth);

            expect(onTabWidth).toHaveBeenLastCalledWith(null);
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
});
