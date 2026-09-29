import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineActivityWidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import { GridFrameScope } from '../../components/ui/GridFrameScope';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import MachineActivityWidget from './MachineActivityWidget';

const equipmentMap = new Map<string, EquipmentSummary>();
const presentationData = {
    resolved: { value: 0.64, unit: 'kW' },
    activity: {
        activityIndex: 64,
        productiveState: 'producing' as const,
        stateLabel: 'Produciendo',
        stateVisuals: {
            primary: 'var(--color-status-normal)',
            gradientColors: ['var(--color-status-normal)', 'var(--color-status-normal)'] as [string, string],
            glowColor: 'var(--color-status-normal)',
            animationDuration: 500,
        },
        smoothedPower: 0.64,
        rawPower: 0.64,
        isValid: true,
    },
};

function makeWidget(overrides?: Partial<MachineActivityWidgetConfig>): MachineActivityWidgetConfig {
    return {
        id: 'machine-activity-tab',
        type: 'machine-activity',
        title: 'Actividad de Máquina',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 2 },
        binding: { mode: 'simulated_value', simulatedValue: 0.64, unit: 'kW' },
        displayOptions: { kpiMode: 'circular', showStateSubtitle: true, showPowerSubtext: true },
        ...overrides,
    } as MachineActivityWidgetConfig;
}

function renderWidget({ inGrid = true, isLoadingData = false, widget = makeWidget() } = {}) {
    const element = (
        <MachineActivityWidget
            widget={widget}
            equipmentMap={equipmentMap}
            isLoadingData={isLoadingData}
            className="w-full h-full"
            presentationData={presentationData}
        />
    );

    return render(inGrid ? <GridFrameScope>{element}</GridFrameScope> : element);
}

describe('MachineActivityWidget frame shape', () => {
    afterEach(() => {
        resetFrameShapeOnDocument();
    });

    it('renders today\'s frame when the standard shape is selected (guard)', () => {
        const { container } = renderWidget();

        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('glass-panel', 'group', 'relative', 'p-5', 'w-full', 'h-full');
        expect(root).toHaveAttribute('data-state', 'producing');
        expect(within(root).getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
    });

    it('renders the tab, the chamfered body surface and the untouched content in the tab shape', () => {
        previewFrameShape('tab');

        const { container } = renderWidget();

        const shell = container.firstElementChild as HTMLElement;
        expect(shell).toHaveAttribute('data-widget-frame-shape', 'tab');
        expect(shell).toHaveClass('hmi-tab-frame', 'w-full', 'h-full');

        const tab = screen.getByTestId('tab-frame-tab');
        expect(within(tab).getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.getByTestId('tab-frame-surface')).toHaveClass('glass-panel', 'hmi-tab-frame-surface');
        expect(screen.getByTestId('tab-frame-border')).toBeInTheDocument();

        // Same content: subtitle, footer value and gauge live in the (unclipped) content element.
        const content = shell.querySelector('[data-state="producing"]') as HTMLElement;
        expect(content).not.toBeNull();
        expect(content).not.toHaveClass('glass-panel');
        expect(within(content).getByText('Produciendo')).toBeInTheDocument();
        expect(within(content).getByText('0.64 kW')).toBeInTheDocument();
        expect(within(content).getByText('64')).toBeInTheDocument();
        expect(within(content).queryByText('Actividad de Máquina')).toBeNull();
    });

    it('keeps the icon in the header row, in the cut-corner slot', () => {
        previewFrameShape('tab');

        renderWidget();

        const slot = document.querySelector('[data-tab-frame-slot="icon"]');
        expect(slot).not.toBeNull();
        expect(slot?.querySelector('svg')).not.toBeNull();
        expect(screen.getByTestId('tab-frame-tab').querySelector('svg')).toBeNull();
    });

    it('draws the simulated data-mode dot dark inside the tab', () => {
        previewFrameShape('tab');

        renderWidget();

        const dot = screen.getByTestId('tab-frame-tab').querySelector('span.rounded-full') as HTMLElement;
        expect(dot).not.toBeNull();
        expect(dot).toHaveClass('bg-current');
        expect(dot).not.toHaveClass('text-industrial-muted');
    });

    it('also frames the loading state with the tab', () => {
        previewFrameShape('tab');

        renderWidget({ isLoadingData: true });

        expect(within(screen.getByTestId('tab-frame-tab')).getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.getByTestId('machine-activity-widget-loading')).toBeInTheDocument();
    });

    it('keeps the standard frame outside a dashboard grid even when the tab shape is selected', () => {
        previewFrameShape('tab');

        const { container } = renderWidget({ inGrid: false });

        expect(container.firstElementChild).toHaveClass('glass-panel');
        expect(screen.queryByTestId('tab-frame-tab')).toBeNull();
    });
});
