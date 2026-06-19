import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractMachine, DataHistoryResponseV2 } from '../domain/dataContract.types';
import type { MachineActivityWidgetConfig, TrendChartV2WidgetConfig } from '../domain/admin.types';
import { isDataHistoryEnabled } from '../config/dataConnection.config';
import { useTemporalSettings } from '../hooks/useTemporalSettings';
import { useDataHistory } from '../queries/useDataHistory';
import WidgetRenderer from './WidgetRenderer';

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
        this.callback([
            {
                target,
                contentRect: {
                    width: 320,
                    height: 180,
                    top: 0,
                    left: 0,
                    bottom: 180,
                    right: 320,
                    x: 0,
                    y: 0,
                    toJSON: () => ({}),
                },
            } as ResizeObserverEntry,
        ], this);
    }

    public unobserve(): void {}

    public disconnect(): void {}
}

vi.mock('../config/dataConnection.config', () => ({
    isDataHistoryEnabled: vi.fn(),
}));

vi.mock('../queries/useDataHistory', () => ({
    useDataHistory: vi.fn(),
}));

vi.mock('../hooks/useTemporalSettings', () => ({
    useTemporalSettings: vi.fn(),
}));

const equipmentMap = new Map();

const widget: MachineActivityWidgetConfig = {
    id: 'machine-activity-1',
    type: 'machine-activity',
    title: 'Actividad de Máquina',
    position: { x: 0, y: 0 },
    size: { w: 1, h: 2 },
    binding: {
        mode: 'real_variable',
        bindingVersion: 'node-red-v1',
        machineId: 101,
        variableKey: 'activePower',
        unit: 'kW',
    },
    displayOptions: {
        icon: 'Activity',
        kpiMode: 'circular',
        thresholdStopped: 0.15,
        thresholdProducing: 0.25,
        hysteresis: 0.05,
        confirmationTime: 2000,
        smoothingWindow: 5,
        powerMin: 0,
        powerMax: 1,
        showStateSubtitle: true,
        showPowerSubtext: true,
        showDynamicColor: true,
        showStateAnimation: true,
        labelStopped: 'Detenida',
        labelCalibrating: 'Setup',
        labelProducing: 'Produciendo',
    },
};

const machines: ContractMachine[] = [{
    unitId: 101,
    name: 'Extrusora 101',
    status: 'online',
    lastSuccess: '2026-04-23T22:00:00.000Z',
    ageMs: 0,
    values: {
        activePower: {
            value: 0.35,
            unit: 'kW',
            timestamp: '2026-04-23T22:00:00.000Z',
        },
    },
}];

function makeTrendChartV2Response(): DataHistoryResponseV2 {
    return {
        contractVersion: '1.1.0',
        machineId: 101,
        variableKey: 'temperature',
        range: '24h',
        unit: '°C',
        window: {
            start: '2026-06-18T12:00:00.000Z',
            end: '2026-06-18T14:00:00.000Z',
            timezone: 'UTC',
            bucketMs: 60_000,
        },
        series: [
            { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 45 },
            { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 52 },
        ],
        summary: {
            last: 52,
            min: 45,
            max: 52,
            avg: 48.5,
        },
    };
}

describe('WidgetRenderer', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeTrendChartV2Response(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
    });

    it('dispatches machine-activity widgets to the dedicated renderer', () => {
        render(
            <WidgetRenderer
                widget={widget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
            />,
        );

        expect(screen.getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getByText('0.35 kW')).toBeInTheDocument();
        expect(screen.getByTestId('gauge-circular')).toBeInTheDocument();
    });

    it('dispatches trend-chart-v2 widgets to the dedicated timestamp renderer without breaking legacy types', () => {
        const trendChartV2Widget: TrendChartV2WidgetConfig = {
            id: 'trend-v2-1',
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
                variableKey: 'temperature',
            },
            displayOptions: { historicalDensity: 'normal' },
        };

        render(
            <WidgetRenderer
                widget={trendChartV2Widget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
            />,
        );

        expect(screen.getByText('Trend Chart V2')).toBeInTheDocument();
        expect(screen.getByText('12:00')).toBeInTheDocument();
    });
});
