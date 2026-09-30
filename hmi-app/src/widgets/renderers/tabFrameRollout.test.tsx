import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
    GroupWidgetConfig,
    InfoCardWidgetConfig,
    KpiWidgetConfig,
    MetricCardWidgetConfig,
} from '../../domain/admin.types';
import { GridFrameScope } from '../../components/ui/GridFrameScope';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import GroupWidget from './GroupWidget';
import InfoCardWidget from './InfoCardWidget';
import KpiWidget from './KpiWidget';
import MetricWidget from './MetricWidget';
import { DEFAULT_GROUP_TITLE_FONT_SIZE } from '../../utils/dashboardTitleTypography';

// Tab frame shape rollout (F2): kpi, metric-card, info-card and titled group take the tab shape
// inside a dashboard grid; the standard shape keeps today's single framed element.

const kpiWidget = {
    id: 'kpi-tab',
    type: 'kpi',
    title: 'Potencia',
    position: { x: 0, y: 0 },
    size: { w: 2, h: 2 },
    binding: { mode: 'simulated_value', simulatedValue: 5, unit: 'kW' },
    displayOptions: { kpiMode: 'circular', min: 0, max: 10, subtitle: 'ACTIVA', subtext: 'Pie del KPI' },
} as KpiWidgetConfig;

const metricWidget = {
    id: 'metric-tab',
    type: 'metric-card',
    title: 'Temperatura',
    position: { x: 0, y: 0 },
    size: { w: 2, h: 2 },
    binding: { mode: 'real_variable', assetId: 'missing-asset', unit: '°C' },
    displayOptions: { subtitle: 'ZONA 1', subtext: 'Límite 80' },
} as MetricCardWidgetConfig;

const metricPresentation = {
    binding: { value: 42, unit: '°C', status: 'normal' as const, source: 'real' as const },
    value: 42,
    unit: '°C',
    status: 'normal' as const,
    source: 'real' as const,
};

const infoWidget = {
    id: 'info-tab',
    type: 'info-card',
    title: 'Resumen de línea',
    position: { x: 0, y: 0 },
    size: { w: 6, h: 5 },
    displayOptions: { subtitle: 'Turno A', fields: [{ id: 'batch', label: 'Lote', value: 'B-204' }] },
} as unknown as InfoCardWidgetConfig;

function makeGroup(overrides?: Partial<GroupWidgetConfig>): GroupWidgetConfig {
    return {
        id: 'group-tab',
        type: 'group',
        title: 'Compresión 01',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        memberWidgetIds: [],
        locked: false,
        displayOptions: { icon: 'Group' },
        ...overrides,
    };
}

interface Case {
    name: string;
    title: string;
    element: () => ReactElement;
    /** Text that must stay in the body header in both shapes. */
    bodyText: string;
    frameClasses: string[];
}

const CASES: Case[] = [
    {
        name: 'kpi',
        title: 'Potencia',
        element: () => <KpiWidget widget={kpiWidget} equipmentMap={new Map()} className="w-full h-full" />,
        bodyText: 'ACTIVA',
        frameClasses: ['glass-panel'],
    },
    {
        name: 'metric-card',
        title: 'Temperatura',
        element: () => <MetricWidget widget={metricWidget} equipmentMap={new Map()} presentationData={metricPresentation} />,
        bodyText: 'ZONA 1',
        frameClasses: ['glass-panel'],
    },
    {
        name: 'info-card',
        title: 'Resumen de línea',
        element: () => <InfoCardWidget widget={infoWidget} className="w-full h-full" />,
        bodyText: 'Turno A',
        frameClasses: ['glass-panel'],
    },
    {
        name: 'group',
        title: 'Compresión 01',
        element: () => <GroupWidget widget={makeGroup()} className="custom-group" />,
        bodyText: 'group-header-icon',
        frameClasses: ['glass-panel', 'glass-panel-group'],
    },
];

function renderInGrid(element: ReactElement) {
    return render(<GridFrameScope>{element}</GridFrameScope>);
}

describe('tab frame shape rollout', () => {
    afterEach(() => {
        resetFrameShapeOnDocument();
    });

    describe.each(CASES)('$name', ({ title, element, bodyText, frameClasses }) => {
        it('keeps today\'s single framed element with the title in the body when the standard shape is selected (guard)', () => {
            const { container } = renderInGrid(element());

            expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
            const framed = container.querySelector('.glass-panel') as HTMLElement;
            expect(framed).not.toBeNull();
            expect(framed).toHaveClass(...frameClasses, 'group');
            expect(within(framed).getByText(title)).toBeInTheDocument();
            expect(container.querySelector('[data-widget-frame-shape]')).toBeNull();
        });

        it('moves the title into the tab and paints the frame on a chamfered surface in the tab shape', () => {
            previewFrameShape('tab');

            const { container } = renderInGrid(element());

            const shell = container.querySelector('[data-widget-frame-shape="tab"]') as HTMLElement;
            expect(shell).not.toBeNull();
            expect(shell).toHaveClass('hmi-tab-frame', 'group');

            const tab = screen.getByTestId('tab-frame-tab');
            expect(within(tab).getByText(title)).toBeInTheDocument();
            expect(screen.getAllByText(title)).toHaveLength(1);

            const surface = screen.getByTestId('tab-frame-surface');
            expect(surface).toHaveClass(...frameClasses, 'hmi-tab-frame-surface');
            expect(surface.parentElement).toBe(shell);
            expect(shell.querySelectorAll('.glass-panel')).toHaveLength(1);

            // Body text (subtitle / icon) stays in the content, not in the tab.
            const bodyNode = bodyText === 'group-header-icon'
                ? screen.getByTestId(bodyText)
                : screen.getByText(bodyText);
            expect(tab).not.toContainElement(bodyNode);
            expect(surface).not.toContainElement(bodyNode);
        });
    });

    it('kpi keeps its footer subtext and value in the content of the tab shape', () => {
        previewFrameShape('tab');

        renderInGrid(<KpiWidget widget={kpiWidget} equipmentMap={new Map()} />);

        expect(screen.getByText('Pie del KPI')).toBeInTheDocument();
        expect(screen.getByTestId('tab-frame-tab')).not.toContainElement(screen.getByText('Pie del KPI'));
    });

    it('metric-card keeps its measured card ref on the padded content element in the tab shape', () => {
        previewFrameShape('tab');

        renderInGrid(<MetricWidget widget={metricWidget} equipmentMap={new Map()} presentationData={metricPresentation} />);

        const header = screen.getByTestId('metric-card-header');
        const content = header.parentElement as HTMLElement;
        expect(content).toHaveClass('p-5', 'flex', 'flex-col');
        expect(content).not.toHaveClass('glass-panel');
        expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('metric-card keeps the warning state class on the painted surface (border overlay follows it)', () => {
        previewFrameShape('tab');

        renderInGrid(
            <MetricWidget
                widget={metricWidget}
                equipmentMap={new Map()}
                presentationData={{ ...metricPresentation, binding: { ...metricPresentation.binding, status: 'warning' } }}
            />,
        );

        expect(screen.getByTestId('tab-frame-surface')).toHaveClass('widget-state-warning', 'hmi-tab-frame-surface');
    });

    it('metric-card loading skeleton and error card keep the standard look in the tab shape', () => {
        previewFrameShape('tab');

        renderInGrid(<MetricWidget widget={metricWidget} equipmentMap={new Map()} isLoadingData />);

        expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
    });

    it('info-card keeps the scroller and its content stack in the content of the tab shape', () => {
        previewFrameShape('tab');

        renderInGrid(<InfoCardWidget widget={infoWidget} />);

        const scroller = screen.getByTestId('info-card-content-scroller');
        expect(within(scroller).getByText('B-204')).toBeInTheDocument();
        expect(screen.getByTestId('info-card-header')).toBeInTheDocument();
    });

    it('a group without a title keeps the standard frame even in the tab shape', () => {
        previewFrameShape('tab');

        const { container } = renderInGrid(<GroupWidget widget={makeGroup({ title: '' })} />);

        expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
        expect(container.firstElementChild).toHaveClass('glass-panel', 'glass-panel-group');
    });

    describe('group tab title (own typography and taller tab)', () => {
        it('shows the title in the tab with the text-title typography at the default size, as typed', () => {
            previewFrameShape('tab');

            renderInGrid(<GroupWidget widget={makeGroup()} />);

            const title = within(screen.getByTestId('tab-frame-tab')).getByText('Compresión 01');
            expect(title.style.fontFamily).toBe('var(--font-dashboard-title)');
            expect(title.style.fontWeight).toBe('var(--font-weight-dashboard-title)');
            expect(title.style.letterSpacing).toBe('var(--tracking-dashboard-title)');
            expect(title.style.fontSize).toBe('30px');
            expect(title.style.lineHeight).toBe('1.1');
            expect(title).not.toHaveClass('uppercase');
            expect(title).toHaveClass('text-(color:--tab-frame-text)', 'group-hover:text-(color:--tab-frame-text-hover)', 'transition-colors');
        });

        it('uses the size configured in displayOptions.titleFontSize and grows the tab with it', () => {
            previewFrameShape('tab');

            const { container } = renderInGrid(<GroupWidget widget={makeGroup({ displayOptions: { icon: 'Group', titleFontSize: 50 } })} />);

            const title = within(screen.getByTestId('tab-frame-tab')).getByText('Compresión 01');
            expect(title.style.fontSize).toBe('50px');
            // No CSS in jsdom: the tokens read as 0, so the tab is the bare line box (50 x 1.1).
            expect((container.querySelector('[data-widget-frame-shape="tab"]') as HTMLElement).style.getPropertyValue('--tab-frame-height')).toBe('55px');
        });

        it('never publishes a NaN tab height for an invalid stored size (falls back to the default size)', () => {
            previewFrameShape('tab');
            const stored = { icon: 'Group', titleFontSize: Number.NaN } as GroupWidgetConfig['displayOptions'];

            const { container } = renderInGrid(<GroupWidget widget={makeGroup({ displayOptions: stored })} />);

            const shell = container.querySelector('[data-widget-frame-shape="tab"]') as HTMLElement;
            expect(within(screen.getByTestId('tab-frame-tab')).getByText('Compresión 01').style.fontSize).toBe(`${DEFAULT_GROUP_TITLE_FONT_SIZE}px`);
            // Tokens read as 0 in jsdom: 30 x 1.1.
            expect(shell.style.getPropertyValue('--tab-frame-height')).toBe('33px');
        });

        it('clamps a stored size outside the allowed range', () => {
            previewFrameShape('tab');
            const huge = renderInGrid(<GroupWidget widget={makeGroup({ displayOptions: { icon: 'Group', titleFontSize: 5000 } })} />);

            expect(within(screen.getByTestId('tab-frame-tab')).getByText('Compresión 01').style.fontSize).toBe('200px');
            expect((huge.container.querySelector('[data-widget-frame-shape="tab"]') as HTMLElement).style.getPropertyValue('--tab-frame-height')).toBe('220px');
        });

        it('gives the group title in the standard shape the same typography, size, as-typed text and colors as the tab', () => {
            const { container } = renderInGrid(<GroupWidget widget={makeGroup({ displayOptions: { icon: 'Group', titleFontSize: 50 } })} />);

            const title = screen.getByText('Compresión 01');
            expect(title.style.fontFamily).toBe('var(--font-dashboard-title)');
            expect(title.style.fontWeight).toBe('var(--font-weight-dashboard-title)');
            expect(title.style.letterSpacing).toBe('var(--tracking-dashboard-title)');
            expect(title.style.fontSize).toBe('50px');
            expect(title.style.lineHeight).toBe('1.1');
            expect(title).not.toHaveClass('uppercase');
            expect(title).toHaveClass('text-(color:--tab-frame-text)', 'group-hover:text-(color:--tab-frame-text-hover)', 'transition-colors');
            expect(title).not.toHaveClass('text-industrial-muted');
            expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
            // The outer frame keeps the standard element: no tab height is published.
            expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--tab-frame-height')).toBe('');
        });

        it('uses the group default size (30) in the standard shape and falls back to it for an invalid stored size', () => {
            renderInGrid(<GroupWidget widget={makeGroup()} />);
            expect(screen.getByText('Compresión 01').style.fontSize).toBe('30px');
            cleanup();

            const stored = { icon: 'Group', titleFontSize: Number.NaN } as GroupWidgetConfig['displayOptions'];
            renderInGrid(<GroupWidget widget={makeGroup({ displayOptions: stored })} />);
            expect(screen.getByText('Compresión 01').style.fontSize).toBe(`${DEFAULT_GROUP_TITLE_FONT_SIZE}px`);
        });

        it('keeps the group title size in the standard shape outside a dashboard grid too', () => {
            render(<GroupWidget widget={makeGroup({ displayOptions: { icon: 'Group', titleFontSize: 40 } })} />);

            const title = screen.getByText('Compresión 01');
            expect(title.style.fontSize).toBe('40px');
            expect(title).not.toHaveClass('uppercase');
        });

        it('leaves another widget type with its uppercase muted standard title', () => {
            renderInGrid(<KpiWidget widget={kpiWidget} equipmentMap={new Map()} className="w-full h-full" />);

            const title = screen.getByText('Potencia');
            expect(title).toHaveClass('uppercase', 'text-industrial-muted', 'group-hover:text-white');
            expect(title.style.fontSize).toBe('');
        });

        it('leaves the other tab widgets with their uppercase standard tab title and token height', () => {
            previewFrameShape('tab');

            const { container } = renderInGrid(<KpiWidget widget={kpiWidget} equipmentMap={new Map()} className="w-full h-full" />);

            const title = within(screen.getByTestId('tab-frame-tab')).getByText('Potencia');
            expect(title).toHaveClass('uppercase');
            expect(title.style.fontSize).toBe('');
            expect((container.querySelector('[data-widget-frame-shape="tab"]') as HTMLElement).style.getPropertyValue('--tab-frame-height')).toBe('');
        });
    });

    it('outside a dashboard grid every widget keeps the standard frame', () => {
        previewFrameShape('tab');

        const { container } = render(<KpiWidget widget={kpiWidget} equipmentMap={new Map()} />);

        expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
        expect(container.firstElementChild).toHaveClass('glass-panel');
    });
});
