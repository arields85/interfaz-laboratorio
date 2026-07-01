import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { HierarchyAggregationTrace } from '../../widgets/resolvers/hierarchyResolver';
import MetricCard from './MetricCard';

const resolvedTrace: HierarchyAggregationTrace = {
    resolved: { value: 30, unit: '°C', status: 'normal', source: 'real' },
    state: 'resolved',
    catalogVariableId: 'cv-temperature',
    aggregation: 'sum',
    descendantNodeCount: 3,
    scannedDashboardCount: 2,
    included: [
        {
            nodeId: 'node-a',
            nodeName: 'Línea A',
            dashboardId: 'dashboard-a',
            dashboardName: 'Dashboard A',
            widgetId: 'widget-a',
            widgetTitle: 'Temperatura Línea A',
            value: 10,
            unit: '°C',
            status: 'normal',
            source: 'real',
        },
        {
            nodeId: 'node-b',
            nodeName: 'Línea B',
            dashboardId: 'dashboard-b',
            dashboardName: 'Dashboard B',
            widgetId: 'widget-b',
            widgetTitle: 'Temperatura Línea B',
            value: 20,
            unit: '°C',
            status: 'normal',
            source: 'real',
        },
    ],
    excluded: [
        {
            nodeId: 'node-c',
            nodeName: 'Línea C',
            dashboardId: 'dashboard-c',
            dashboardName: 'Dashboard C',
            widgetId: 'widget-c',
            widgetTitle: 'Presión Línea C',
            reason: 'catalog-mismatch',
            value: 99,
            unit: 'bar',
            status: 'normal',
            source: 'simulated',
        },
    ],
};

describe('MetricCard hierarchy trace disclosure', () => {
    it('keeps the KPI visible and exposes contributor details behind a collapsed disclosure by default', async () => {
        const user = userEvent.setup();

        render(
            <MetricCard
                label="Temperatura agregada"
                value={30}
                unit="°C"
                hierarchyTrace={resolvedTrace}
            />,
        );

        expect(screen.getByText('30')).toBeInTheDocument();
        expect(screen.getByText('°C')).toBeInTheDocument();

        const disclosure = screen.getByRole('button', {
            name: 'Ver detalle de agregación de Temperatura agregada',
        });

        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Temperatura Línea A')).not.toBeInTheDocument();

        await user.click(disclosure);

        expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Suma actual · 30 °C')).toBeInTheDocument();
        expect(screen.getByText('2 incluidos · 1 excluido · 2 dashboards')).toBeInTheDocument();
        expect(screen.getByText('Temperatura Línea A')).toBeInTheDocument();
        expect(screen.getByText('Temperatura Línea B')).toBeInTheDocument();
        expect(screen.getByText('Presión Línea C')).toBeInTheDocument();
        expect(screen.getByText('Variable distinta')).toBeInTheDocument();
        expect(screen.getByTestId('metric-card-hierarchy-trace')).toHaveClass('hmi-scrollbar');
    });

    it('renders hierarchy empty-state copy after expansion without contributor rows', async () => {
        const user = userEvent.setup();

        render(
            <MetricCard
                label="Temperatura agregada"
                value={null}
                hierarchyTrace={{
                    ...resolvedTrace,
                    resolved: { value: null, status: 'no-data', source: 'error' },
                    state: 'empty',
                    emptyReason: 'no-eligible-contributors',
                    included: [],
                    excluded: [],
                }}
            />,
        );

        const disclosure = screen.getByRole('button', {
            name: 'Ver detalle de agregación de Temperatura agregada',
        });

        await user.click(disclosure);

        expect(screen.getByText('Sin datos elegibles para esta jerarquía.')).toBeInTheDocument();
        expect(screen.getByText('No se encontró ningún contributor numérico para la variable seleccionada.')).toBeInTheDocument();
        expect(screen.queryByText('Incluidos')).not.toBeInTheDocument();
        expect(screen.queryByText('Excluidos')).not.toBeInTheDocument();
    });

    it('toggles the disclosure with keyboard activation and keeps expanded state accurate for assistive tech', async () => {
        const user = userEvent.setup();

        render(
            <MetricCard
                label="Temperatura agregada"
                value={30}
                unit="°C"
                hierarchyTrace={resolvedTrace}
            />,
        );

        const disclosure = screen.getByRole('button', {
            name: 'Ver detalle de agregación de Temperatura agregada',
        });

        disclosure.focus();

        expect(disclosure).toHaveFocus();
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');

        await user.keyboard('{Enter}');

        expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Temperatura Línea A')).toBeInTheDocument();

        await user.keyboard(' ');

        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Temperatura Línea A')).not.toBeInTheDocument();
    });
});
