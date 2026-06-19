import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WidgetConfig, WidgetLayout } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import PropertyDock from './PropertyDock';

vi.mock('../ui/AnchoredOverlay', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

const MACHINES: ContractMachine[] = [
    {
        unitId: 101,
        name: 'Extrusora 101',
        status: 'online',
        lastSuccess: '2026-04-21T13:00:00.000Z',
        ageMs: 0,
        values: {
            temp: { value: 42, unit: '°C', timestamp: null },
            pressure: { value: 8, unit: 'bar', timestamp: null },
        },
    },
    {
        unitId: 202,
        name: 'Mezcladora 202',
        status: 'online',
        lastSuccess: '2026-04-21T13:00:00.000Z',
        ageMs: 0,
        values: {
            flow: { value: 120, unit: 'L/min', timestamp: null },
        },
    },
];

const DEFAULT_LAYOUT: WidgetLayout = {
    widgetId: 'widget-1',
    x: 0,
    y: 0,
    w: 4,
    h: 3,
};

const PROD_HISTORY_ASSET: EquipmentSummary = {
    id: 'asset-1',
    name: 'Línea 1',
    type: 'comprimidora',
    status: 'running',
    connectionState: 'online',
    primaryMetrics: [
        { label: 'Producción', value: 240, unit: 'kg' },
        { label: 'OEE', value: 86, unit: '%' },
    ],
};

function makeWidget(binding: WidgetConfig['binding'] = { mode: 'real_variable' }): WidgetConfig {
    return {
        id: 'widget-1',
        type: 'kpi',
        title: 'Temperatura',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 3 },
        binding,
        thresholds: [],
        displayOptions: {},
    };
}

function renderPropertyDock(options?: {
    binding?: WidgetConfig['binding'];
    type?: WidgetConfig['type'];
    title?: string;
    displayOptions?: WidgetConfig['displayOptions'];
    machines?: ContractMachine[];
    equipmentMap?: Map<string, EquipmentSummary>;
    dataLoading?: boolean;
    dataError?: boolean;
    dataEnabled?: boolean;
}) {
    const updates: WidgetConfig[] = [];

    function Harness() {
        const [widget, setWidget] = useState<WidgetConfig>({
            ...makeWidget(options?.binding),
            type: options?.type ?? 'kpi',
            title: options?.title ?? 'Temperatura',
            displayOptions: options?.displayOptions ?? {},
        });

        return (
            <PropertyDock
                selectedWidget={widget}
                selectedLayout={DEFAULT_LAYOUT}
                equipmentMap={options?.equipmentMap ?? new Map()}
                catalogVariables={[]}
                usedCatalogVariableIds={[]}
                machines={options?.machines ?? MACHINES}
                dataLoading={options?.dataLoading}
                dataError={options?.dataError}
                dataEnabled={options?.dataEnabled ?? true}
                onCreateVariable={vi.fn()}
                onDeleteVariable={vi.fn()}
                onUpdateWidget={(nextWidget) => {
                    updates.push(nextWidget);
                    setWidget(nextWidget);
                }}
                onUpdateLayout={vi.fn()}
                onDelete={vi.fn()}
                onDuplicate={vi.fn()}
                onDeselect={vi.fn()}
            />
        );
    }

    return {
        user: userEvent.setup(),
        updates,
        ...render(<Harness />),
    };
}

function getFieldButton(label: string) {
    const row = screen.getByText(label).closest('div');

    if (!row) {
        throw new Error(`No se encontró la fila ${label}`);
    }

    return within(row).getByRole('button');
}

function getSection(title: string) {
    const sectionHeader = screen.getByRole('button', { name: new RegExp(title, 'i') });
    const section = sectionHeader.closest('section');

    if (!section) {
        throw new Error(`No se encontró la sección ${title}`);
    }

    return section;
}

function getFieldButtonInSection(sectionTitle: string, label: string) {
    const section = getSection(sectionTitle);
    const row = within(section).getByText(label).closest('div');

    if (!row) {
        throw new Error(`No se encontró la fila ${label} en ${sectionTitle}`);
    }

    return within(row).getByRole('button');
}

function getInputInSection(sectionTitle: string, label: string) {
    const section = getSection(sectionTitle);
    const row = within(section).getByText(label).closest('div');

    if (!row) {
        throw new Error(`No se encontró la fila ${label} en ${sectionTitle}`);
    }

    const input = within(row).queryByRole('textbox');

    if (!input) {
        throw new Error(`No se encontró el input ${label} en ${sectionTitle}`);
    }

    return input;
}

describe('PropertyDock Node-RED binding', () => {
    it('renders Node-RED machine names when machines are available', async () => {
        const { user } = renderPropertyDock();

        await user.click(getFieldButton('Equipo'));

        expect(screen.getByRole('button', { name: 'Extrusora 101' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mezcladora 202' })).toBeInTheDocument();
    });

    it('shows variables from machine.variables when a machine is selected', async () => {
        const { user } = renderPropertyDock();

        await user.click(getFieldButton('Equipo'));
        await user.click(screen.getByRole('button', { name: 'Extrusora 101' }));
        await user.click(getFieldButton('Variable'));

        expect(screen.getByRole('button', { name: 'temp (°C)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'pressure (bar)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '0' })).not.toBeInTheDocument();
    });

    it('resets variableKey when the selected machine changes to one that does not contain it', async () => {
        const { user, updates } = renderPropertyDock({
            binding: {
                mode: 'real_variable',
                machineId: 101,
                variableKey: 'temp',
                bindingVersion: 'node-red-v1',
            },
        });

        await user.click(getFieldButton('Equipo'));
        await user.click(screen.getByRole('button', { name: 'Mezcladora 202' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            machineId: 202,
            bindingVersion: 'node-red-v1',
        });
        expect(updates.at(-1)?.binding?.variableKey).toBeUndefined();
        expect(getFieldButton('Variable')).toHaveTextContent('Seleccione...');
    });

    it('persists machineId, variableKey and bindingVersion when saving a Node-RED binding', async () => {
        const { user, updates } = renderPropertyDock();

        await user.click(getFieldButton('Equipo'));
        await user.click(screen.getByRole('button', { name: 'Mezcladora 202' }));
        await user.click(getFieldButton('Variable'));
        await user.click(screen.getByRole('button', { name: 'flow (L/min)' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            machineId: 202,
            variableKey: 'flow',
            bindingVersion: 'node-red-v1',
        });
        expect(typeof updates.at(-1)?.binding?.machineId).toBe('number');
    });

    it('shows a loading state while Node-RED machines are loading', () => {
        renderPropertyDock({ machines: [], dataLoading: true });

        expect(screen.getAllByText('Cargando equipos...')).not.toHaveLength(0);
    });

    it('shows an error state when Node-RED loading fails', () => {
        renderPropertyDock({ machines: [], dataError: true });

        expect(screen.getAllByText('Error cargando equipos')).not.toHaveLength(0);
    });

    it('shows a not configured state when Node-RED is disabled', () => {
        renderPropertyDock({ machines: [], dataEnabled: false });

        expect(screen.getAllByText('No configurado')).not.toHaveLength(0);
    });

    it('shows an empty machine selector when Node-RED is enabled but the overview has no machines', () => {
        renderPropertyDock({ machines: [], dataEnabled: true });

        expect(getFieldButton('Equipo')).toHaveTextContent('Sin equipos');
        expect(getFieldButton('Equipo')).toBeDisabled();
        expect(getFieldButton('Variable')).toHaveTextContent('Sin variables');
        expect(getFieldButton('Variable')).toBeDisabled();
    });

    it('renders connection-status data source controls with merged origin and without generic binding fields', async () => {
        const { user } = renderPropertyDock({
            type: 'connection-status',
            title: 'Estado Conexión',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 'online',
            },
            displayOptions: {
                scope: 'global',
                showLastUpdate: true,
            },
        });

        expect(screen.getByText('Datos')).toBeInTheDocument();
        expect(screen.getByText('Origen')).toBeInTheDocument();
        expect(screen.getByText('Valor')).toBeInTheDocument();
        expect(screen.getByText('Mostrar Tiempo')).toBeInTheDocument();
        expect(screen.queryByText('Unidad')).not.toBeInTheDocument();
        expect(screen.queryByText('Fuente')).not.toBeInTheDocument();
        expect(screen.queryByText('Variable')).not.toBeInTheDocument();
        expect(screen.queryByText('Operación')).not.toBeInTheDocument();
        expect(screen.queryByText('Alcance')).not.toBeInTheDocument();

        await user.click(getFieldButton('Origen'));

        expect(screen.getAllByRole('button', { name: 'Simulado' })).not.toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Global' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Por Máquina' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Variable Real' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /textos/i }));

        expect(screen.getAllByText('Online')).not.toHaveLength(0);
        expect(screen.getAllByText('Degradado')).not.toHaveLength(0);
        expect(screen.getAllByText('Offline')).not.toHaveLength(0);
        expect(screen.getAllByText('Unknown')).not.toHaveLength(0);
        expect(screen.queryByText('Equipo')).not.toBeInTheDocument();
    });

    it('updates connection-status merged origin, machine and texts from the custom dock section', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'connection-status',
            title: 'Estado Conexión',
            displayOptions: {
                scope: 'global',
                showLastUpdate: true,
            },
        });

        await user.click(getFieldButton('Origen'));
        await user.click(screen.getByRole('button', { name: 'Por Máquina' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            mode: 'real_variable',
        });
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            scope: 'machine',
            showLastUpdate: true,
        });

        await user.click(getFieldButtonInSection('Datos', 'Equipo'));
        await user.click(screen.getByRole('button', { name: 'Mezcladora 202' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            scope: 'machine',
            machineId: 202,
            showLastUpdate: true,
        });

        await user.click(getFieldButton('Origen'));
        await user.click(screen.getByRole('button', { name: 'Global' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            mode: 'real_variable',
        });
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            scope: 'global',
            showLastUpdate: true,
        });
        expect(updates.at(-1)?.displayOptions).not.toHaveProperty('machineId');

        await user.click(getFieldButton('Origen'));
        await user.click(screen.getByRole('button', { name: 'Simulado' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            mode: 'simulated_value',
        });

        await user.click(screen.getByRole('button', { name: /textos/i }));

        const onlineInput = screen.getByPlaceholderText('Online');
        await user.clear(onlineInput);
        await user.type(onlineInput, 'Operativa');

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            scope: 'global',
            onlineText: 'Operativa',
        });
    });

    it('updates connection-status simulated value from the data section', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'connection-status',
            title: 'Indicador Conexión',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 'online',
            },
            displayOptions: {
                scope: 'global',
                showLastUpdate: true,
            },
        });

        await user.click(getFieldButton('Valor'));
        await user.click(screen.getByRole('button', { name: 'Degradado' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            mode: 'simulated_value',
            simulatedValue: 'degradado',
        });

        await user.click(getFieldButton('Origen'));
        await user.click(screen.getByRole('button', { name: 'Por Máquina' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            mode: 'real_variable',
        });
        expect(screen.getByText('Equipo')).toBeInTheDocument();
        expect(screen.queryByText('Variable')).not.toBeInTheDocument();
    });

    it('toggles connection-status showLastUpdate from the data section', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'connection-status',
            title: 'Estado Conexión',
            displayOptions: {
                scope: 'global',
                showLastUpdate: true,
            },
        });

        const toggle = screen.getByLabelText('Mostrar Tiempo');

        expect(toggle).toBeChecked();

        await user.click(toggle);

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            scope: 'global',
            showLastUpdate: false,
        });

        await user.click(toggle);

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            scope: 'global',
            showLastUpdate: true,
        });
    });
});

describe('PropertyDock text-title', () => {
    it('shows a dedicated font size control in General and keeps the widget out of Datos', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'text-title',
            title: 'Título de texto',
            binding: { mode: 'simulated_value', simulatedValue: 0 },
            displayOptions: { fontSize: 64 },
        });

        const fontSizeInput = getInputInSection('General', 'Tamaño');

        expect(fontSizeInput).toHaveValue('64');
        expect(screen.queryByRole('button', { name: /datos/i })).not.toBeInTheDocument();

        await user.clear(fontSizeInput);
        await user.type(fontSizeInput, '72');
        await user.tab();

        expect(updates.at(-1)?.displayOptions).toMatchObject({ fontSize: 72 });
    });
});

describe('PropertyDock machine-activity', () => {
    it('renders machine-activity sections with KPI-like general/data controls and default values', () => {
        renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'real_variable',
                unit: 'kW',
            },
        });

        expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /datos/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /escala visual/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /estados productivos/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /visualización/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /textos/i })).toBeInTheDocument();

        const sectionButtons = screen.getAllByRole('button').map((button) => button.textContent ?? '');
        const dataIndex = sectionButtons.findIndex((text) => /datos/i.test(text));
        const scaleIndex = sectionButtons.findIndex((text) => /escala visual/i.test(text));
        const productiveStatesIndex = sectionButtons.findIndex((text) => /estados productivos/i.test(text));

        expect(dataIndex).toBeGreaterThanOrEqual(0);
        expect(scaleIndex).toBeGreaterThan(dataIndex);
        expect(productiveStatesIndex).toBeGreaterThan(scaleIndex);

        expect(screen.getByDisplayValue('Actividad de Máquina')).toBeInTheDocument();
        expect(getFieldButtonInSection('General', 'Ícono')).toHaveTextContent('(Ícono pendiente)');
        expect(getFieldButtonInSection('General', 'Estilo')).toHaveTextContent('Radial');

        expect(getFieldButtonInSection('Datos', 'Origen')).toHaveTextContent('Variable Real');
        expect(getFieldButtonInSection('Datos', 'Equipo')).toHaveTextContent('Seleccione...');
        expect(getFieldButtonInSection('Datos', 'Variable')).toHaveTextContent('Seleccione...');
        expect(screen.getByLabelText('Unidad custom')).toBeChecked();
        expect(getFieldButtonInSection('Datos', 'Unidad')).toHaveTextContent('%');

        const productiveStatesSection = getSection('Estados Productivos');
        expect(within(productiveStatesSection).getByText('Setup ≥')).toBeInTheDocument();
        expect(within(productiveStatesSection).getByText('Prod. ≥')).toBeInTheDocument();
        expect(within(productiveStatesSection).getByText('Conf. (ms)')).toBeInTheDocument();
        expect(within(productiveStatesSection).getByDisplayValue('0.15')).toBeInTheDocument();
        expect(within(productiveStatesSection).getByDisplayValue('0.25')).toBeInTheDocument();
        expect(within(productiveStatesSection).getByDisplayValue('0.05')).toBeInTheDocument();
        expect(within(productiveStatesSection).getByDisplayValue('2000')).toBeInTheDocument();
        expect(within(productiveStatesSection).getByDisplayValue('5')).toBeInTheDocument();

        const visualScaleSection = getSection('Escala Visual');
        expect(within(visualScaleSection).getByText('kW mín')).toBeInTheDocument();
        expect(within(visualScaleSection).getByText('kW máx')).toBeInTheDocument();
        expect(within(visualScaleSection).getByDisplayValue('0')).toBeInTheDocument();
        expect(within(visualScaleSection).getByDisplayValue('1')).toBeInTheDocument();

        expect(screen.getByLabelText('Mostrar subtítulo de estado')).toBeChecked();
        expect(screen.getByLabelText('Mostrar variable en subtexto')).toBeChecked();
        expect(screen.getByLabelText('Color dinámico por estado')).toBeChecked();
        expect(screen.getByLabelText('Animación por estado')).toBeChecked();

        const textsSection = getSection('Textos');
        expect(within(textsSection).getByDisplayValue('Detenida')).toBeInTheDocument();
        expect(within(textsSection).getByDisplayValue('Setup')).toBeInTheDocument();
        expect(within(textsSection).getByDisplayValue('Produciendo')).toBeInTheDocument();
    });

    it('updates machine-activity display options from the custom property sections', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'real_variable',
                unit: 'kW',
            },
        });

        await user.click(getFieldButtonInSection('General', 'Estilo'));
        await user.click(screen.getByRole('button', { name: 'Barra' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            kpiMode: 'bar',
        });

        const productiveStatesSection = getSection('Estados Productivos');
        const confirmationInput = within(productiveStatesSection).getByDisplayValue('2000');
        await user.clear(confirmationInput);
        await user.type(confirmationInput, '3500');
        await user.tab();

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            confirmationTime: 3500,
        });

        const subtitleToggle = screen.getByLabelText('Mostrar subtítulo de estado');
        await user.click(subtitleToggle);

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            showStateSubtitle: false,
        });

        const textsSection = getSection('Textos');
        const producingInput = within(textsSection).getByDisplayValue('Produciendo');
        await user.type(producingInput, ' avanzada');

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            labelProducing: 'Produciendo avanzada',
        });
    });

    it('shows the custom unit toggle for real machine-activity bindings and enables editing only when active', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'real_variable',
                machineId: 101,
                variableKey: 'temp',
                bindingVersion: 'node-red-v1',
                unit: 'kW',
            },
            displayOptions: {
                unitOverride: false,
                unit: '%',
            },
        });

        const toggle = screen.getByLabelText('Unidad custom');
        const unitSelect = getFieldButtonInSection('Datos', 'Unidad');

        expect(toggle).not.toBeChecked();
        expect(unitSelect).toHaveTextContent('°C');
        expect(unitSelect).toBeDisabled();

        await user.click(toggle);

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            unitOverride: true,
            unit: '%',
        });
        expect(getFieldButtonInSection('Datos', 'Unidad')).toHaveTextContent('%');
        expect(getFieldButtonInSection('Datos', 'Unidad')).not.toBeDisabled();
    });

    it('keeps the unit editable without toggle for simulated machine-activity bindings', () => {
        renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 12,
                unit: '%',
            },
            displayOptions: {
                unitOverride: true,
                unit: '%',
            },
        });

        expect(screen.queryByLabelText('Unidad custom')).not.toBeInTheDocument();
        expect(getFieldButtonInSection('Datos', 'Unidad')).toHaveTextContent('%');
        expect(getFieldButtonInSection('Datos', 'Unidad')).not.toBeDisabled();
    });

    it('updates the simulated machine-activity unit atomically without reverting to the previous value', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 12,
                unit: '%',
            },
            displayOptions: {
                unitOverride: true,
                unit: '%',
            },
        });

        await user.click(getFieldButtonInSection('Datos', 'Unidad'));
        await user.click(screen.getByRole('button', { name: 'RPM' }));

        expect(updates.at(-1)).toMatchObject({
            binding: {
                mode: 'simulated_value',
                unit: 'RPM',
            },
            displayOptions: {
                unitOverride: true,
                unit: 'RPM',
            },
        });
        expect(getFieldButtonInSection('Datos', 'Unidad')).toHaveTextContent('RPM');
        expect(within(getSection('Escala Visual')).getByText('RPM mín')).toBeInTheDocument();
        expect(within(getSection('Escala Visual')).getByText('RPM máx')).toBeInTheDocument();
    });

    it('uses the selected variable unit for scale labels and falls back when no unit is available', () => {
        const { rerender } = renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'real_variable',
                machineId: 101,
                variableKey: 'temp',
                bindingVersion: 'node-red-v1',
            },
        });

        const visualScaleSection = getSection('Escala Visual');
        expect(within(visualScaleSection).getByText('°C mín')).toBeInTheDocument();
        expect(within(visualScaleSection).getByText('°C máx')).toBeInTheDocument();

        rerender(
            <PropertyDock
                selectedWidget={{
                    ...makeWidget({
                        mode: 'real_variable',
                        machineId: 101,
                        variableKey: 'temp',
                        bindingVersion: 'node-red-v1',
                    }),
                    type: 'machine-activity',
                    title: 'Actividad de Máquina',
                    displayOptions: {},
                }}
                selectedLayout={DEFAULT_LAYOUT}
                equipmentMap={new Map()}
                catalogVariables={[]}
                usedCatalogVariableIds={[]}
                machines={[
                    {
                        ...MACHINES[0],
                        values: {
                            temp: { value: 42, unit: '', timestamp: null },
                        },
                    },
                ]}
                dataEnabled
                onCreateVariable={vi.fn()}
                onDeleteVariable={vi.fn()}
                onUpdateWidget={vi.fn()}
                onUpdateLayout={vi.fn()}
                onDelete={vi.fn()}
                onDuplicate={vi.fn()}
                onDeselect={vi.fn()}
            />,
        );

        expect(within(getSection('Escala Visual')).getByText('Valor mín')).toBeInTheDocument();
        expect(within(getSection('Escala Visual')).getByText('Valor máx')).toBeInTheDocument();
    });

    it('uses the simulated unit for machine-activity scale labels even when a previous real variable exists', () => {
        renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 12,
                machineId: 101,
                variableKey: 'temp',
                bindingVersion: 'node-red-v1',
                unit: 'Hz',
            },
        });

        const visualScaleSection = getSection('Escala Visual');
        expect(within(visualScaleSection).getByText('Hz mín')).toBeInTheDocument();
        expect(within(visualScaleSection).getByText('Hz máx')).toBeInTheDocument();
        expect(within(visualScaleSection).queryByText('°C mín')).not.toBeInTheDocument();
    });

    it('falls back to the current simulated display unit for machine-activity scale labels when binding.unit is empty', () => {
        renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 12,
                unit: '',
            },
            displayOptions: {
                unit: '°F',
                unitOverride: true,
            },
        });

        const visualScaleSection = getSection('Escala Visual');
        expect(within(visualScaleSection).getByText('°F mín')).toBeInTheDocument();
        expect(within(visualScaleSection).getByText('°F máx')).toBeInTheDocument();
    });

    it('syncs the simulated unit into scale labels when switching machine-activity from real to simulated', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'real_variable',
                machineId: 101,
                variableKey: 'temp',
                bindingVersion: 'node-red-v1',
                unit: '°C',
            },
            displayOptions: {
                unitOverride: true,
                unit: 'RPM',
            },
        });

        expect(within(getSection('Escala Visual')).getByText('°C mín')).toBeInTheDocument();

        await user.click(getFieldButtonInSection('Datos', 'Origen'));
        await user.click(screen.getByRole('button', { name: 'Simulado' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            mode: 'simulated_value',
            unit: 'RPM',
        });
        expect(within(getSection('Escala Visual')).getByText('RPM mín')).toBeInTheDocument();
        expect(within(getSection('Escala Visual')).getByText('RPM máx')).toBeInTheDocument();
        expect(within(getSection('Escala Visual')).queryByText('°C mín')).not.toBeInTheDocument();
    });

    it('uses dynamic KPI scale labels for real and simulated units', () => {
        const { rerender } = renderPropertyDock({
            type: 'kpi',
            title: 'Potencia',
            binding: {
                mode: 'real_variable',
                machineId: 101,
                variableKey: 'temp',
                bindingVersion: 'node-red-v1',
            },
        });

        const scaleSection = getSection('Escala Visual');
        expect(within(scaleSection).getByText('°C mín')).toBeInTheDocument();
        expect(within(scaleSection).getByText('°C máx')).toBeInTheDocument();

        rerender(
            <PropertyDock
                selectedWidget={{
                    ...makeWidget({
                        mode: 'simulated_value',
                        simulatedValue: 12,
                        machineId: 101,
                        variableKey: 'temp',
                        bindingVersion: 'node-red-v1',
                        unit: 'bar',
                    }),
                    title: 'Potencia',
                    displayOptions: {},
                }}
                selectedLayout={DEFAULT_LAYOUT}
                equipmentMap={new Map()}
                catalogVariables={[]}
                usedCatalogVariableIds={[]}
                machines={MACHINES}
                dataEnabled
                onCreateVariable={vi.fn()}
                onDeleteVariable={vi.fn()}
                onUpdateWidget={vi.fn()}
                onUpdateLayout={vi.fn()}
                onDelete={vi.fn()}
                onDuplicate={vi.fn()}
                onDeselect={vi.fn()}
            />,
        );

        expect(within(getSection('Escala Visual')).getByText('bar mín')).toBeInTheDocument();
        expect(within(getSection('Escala Visual')).getByText('bar máx')).toBeInTheDocument();
    });

    it('falls back to the current simulated display unit for KPI scale labels when binding.unit is empty', () => {
        renderPropertyDock({
            type: 'kpi',
            title: 'Potencia',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 12,
                unit: '',
            },
            displayOptions: {
                unit: 'RPM',
                unitOverride: true,
            },
        });

        const scaleSection = getSection('Escala Visual');
        expect(within(scaleSection).getByText('RPM mín')).toBeInTheDocument();
        expect(within(scaleSection).getByText('RPM máx')).toBeInTheDocument();
    });

    it('disables smoothing and renames the subtext toggle when machine-activity uses simulated values', () => {
        renderPropertyDock({
            type: 'machine-activity',
            title: 'Actividad de Máquina',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 12,
                unit: '%',
            },
            displayOptions: {
                showPowerSubtext: true,
            },
        });

        const productiveStatesSection = getSection('Estados Productivos');
        const smoothingInput = within(productiveStatesSection).getByDisplayValue('5');

        expect(smoothingInput).toBeDisabled();
        expect(screen.getByLabelText('Mostrar valor en subtexto')).toBeChecked();
        expect(screen.queryByLabelText('Mostrar variable en subtexto')).not.toBeInTheDocument();
    });
});

describe('PropertyDock prod-history', () => {
    it('renders prod-history sections and updates general, data, series, scales and layout controls', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'prod-history',
            title: 'Histórico de producción',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 0,
            },
            displayOptions: {
                productionChartMode: 'bars',
            },
        });

        expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /datos/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /series/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /escalas/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /layout/i })).toBeInTheDocument();

        expect(getFieldButtonInSection('General', 'Producción')).toHaveTextContent('Barras');
        expect(getFieldButtonInSection('Datos', 'Unidad')).toHaveTextContent('unidades');
        expect(getFieldButtonInSection('Datos', 'Origen')).toHaveTextContent('Simulado');

        await user.click(getFieldButtonInSection('General', 'Producción'));
        await user.click(screen.getByRole('button', { name: 'Área' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            productionChartMode: 'area',
        });

        await user.click(screen.getByLabelText('Relleno bajo línea OEE'));
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            oeeShowArea: true,
        });

        await user.click(screen.getByLabelText('Puntos en OEE'));
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            oeeShowPoints: true,
        });

        const barWidthSlider = screen.getByRole('slider');
        fireEvent.change(barWidthSlider, { target: { value: '1.4' } });

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            productionBarWidth: 1.4,
        });

        await user.click(getFieldButtonInSection('Datos', 'Unidad'));
        await user.click(screen.getByRole('button', { name: 'kg' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            productionUnit: 'kg',
        });

        await user.click(getFieldButtonInSection('Datos', 'Origen'));
        await user.click(screen.getByRole('button', { name: 'Real' }));

        expect(updates.at(-1)?.binding).toMatchObject({
            mode: 'real_variable',
        });

        const productionInput = screen.getByPlaceholderText('Clave variable producción');
        await user.type(productionInput, 'prod_total');
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            productionVariableKey: 'prod_total',
        });

        const oeeInput = screen.getByPlaceholderText('Clave variable OEE');
        await user.type(oeeInput, 'oee_pct');
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            oeeVariableKey: 'oee_pct',
        });

        await user.click(screen.getByLabelText('Mostrar OEE'));
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            defaultShowOee: false,
        });

        await user.click(screen.getByLabelText('Usar eje secundario para OEE'));
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            useSecondaryAxis: false,
        });

        const autoScaleToggle = screen.getByLabelText('Autoescala');
        await user.click(autoScaleToggle);
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            autoScale: false,
        });

        const scalesSection = getSection('Escalas');
        const [prodMinInput, prodMaxInput, oeeMinInput, oeeMaxInput] = within(scalesSection).getAllByRole('textbox');

        await user.clear(prodMinInput);
        await user.type(prodMinInput, '10');
        await user.tab();
        expect(updates.at(-1)?.displayOptions).toMatchObject({ productionAxisMin: 10 });

        await user.clear(prodMaxInput);
        await user.type(prodMaxInput, '320');
        await user.tab();
        expect(updates.at(-1)?.displayOptions).toMatchObject({ productionAxisMax: 320 });

        await user.clear(oeeMinInput);
        await user.type(oeeMinInput, '15');
        await user.tab();
        expect(updates.at(-1)?.displayOptions).toMatchObject({ oeeAxisMin: 15 });

        await user.clear(oeeMaxInput);
        await user.type(oeeMaxInput, '95');
        await user.tab();
        expect(updates.at(-1)?.displayOptions).toMatchObject({ oeeAxisMax: 95 });

        await user.click(screen.getByLabelText('Mostrar grilla'));
        expect(updates.at(-1)?.displayOptions).toMatchObject({
            showGrid: false,
        });
    });

    it('shows builder-only density labels for trend-chart-v2 without exposing raw maxPoints', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            displayOptions: {},
        });

        expect(getFieldButtonInSection('General', 'Densidad')).toHaveTextContent('Normal');
        expect(screen.queryByText('400')).not.toBeInTheDocument();
        expect(screen.queryByText('800')).not.toBeInTheDocument();
        expect(screen.queryByText('1500')).not.toBeInTheDocument();

        await user.click(getFieldButtonInSection('General', 'Densidad'));
        await user.click(screen.getByRole('button', { name: 'Alta' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({ historicalDensity: 'high' });
        expect(getFieldButtonInSection('General', 'Densidad')).toHaveTextContent('Alta');
    });

    it('lets admins configure the shared header icon for trend-chart-v2 widgets', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            displayOptions: {},
        });

        expect(getFieldButtonInSection('General', 'Ícono')).toHaveTextContent('(Ícono pendiente)');

        await user.click(getFieldButtonInSection('General', 'Ícono'));
        await user.click(screen.getByRole('button', { name: 'Líneas' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({ icon: 'LineChart' });
        expect(getFieldButtonInSection('General', 'Ícono')).toHaveTextContent('Líneas');
    });

    it('lets admins choose the trend-chart-v2 shift display mode with auto as the default', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            displayOptions: {},
        });

        expect(getFieldButtonInSection('General', 'Turnos')).toHaveTextContent('Auto');

        await user.click(getFieldButtonInSection('General', 'Turnos'));
        await user.click(screen.getByRole('button', { name: 'Líneas' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({ shiftDisplayMode: 'lines' });
        expect(getFieldButtonInSection('General', 'Turnos')).toHaveTextContent('Líneas');
    });

    it('lets admins toggle trend-chart-v2 shift overlays without exposing a removed shift-summary toggle', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            displayOptions: {},
        });

        const showShiftsToggle = screen.getByLabelText('Mostrar turnos');

        expect(showShiftsToggle).not.toBeChecked();
        expect(screen.queryByLabelText('Mostrar resumen de turnos')).not.toBeInTheDocument();

        await user.click(showShiftsToggle);
        expect(updates.at(-1)?.displayOptions).toMatchObject({ showShifts: true });
    });

    it('renders trend-chart-v2 toggle controls with semantic admin tokens instead of hardcoded white utilities', () => {
        renderPropertyDock({
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            displayOptions: {},
        });

        const showShiftsToggle = screen.getByLabelText('Mostrar turnos');
        const showShiftsTrack = showShiftsToggle.nextElementSibling;
        const showShiftsLabel = screen.getByText('Mostrar turnos');

        expect(showShiftsTrack).toHaveClass('bg-industrial-hover', 'border-industrial-border', 'peer-checked:bg-admin-accent/20');
        expect(showShiftsLabel).toHaveClass('text-industrial-text-soft', 'peer-checked:text-industrial-text', 'group-hover:text-industrial-text');

        expect(showShiftsTrack?.className).not.toMatch(/bg-white\/|border-white\/|after:bg-white/);
        expect(showShiftsLabel.className).not.toMatch(/text-white|hover:text-white|rgba\(255,255,255/);
        expect(screen.queryByText('Mostrar resumen de turnos')).not.toBeInTheDocument();
    });

    it('uses prod-history metric selectors when the selected asset is available', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'prod-history',
            title: 'Histórico de producción',
            binding: {
                mode: 'real_variable',
                assetId: 'asset-1',
            },
            equipmentMap: new Map([[PROD_HISTORY_ASSET.id, PROD_HISTORY_ASSET]]),
            displayOptions: {},
        });

        await user.click(getFieldButtonInSection('Datos', 'Var. Prod.'));

        expect(screen.getByRole('button', { name: 'Producción' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'OEE' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Producción' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            productionVariableKey: 'Producción',
        });

        await user.click(getFieldButtonInSection('Datos', 'Var. OEE'));
        await user.click(screen.getByRole('button', { name: 'OEE' }));

        expect(updates.at(-1)?.displayOptions).toMatchObject({
            oeeVariableKey: 'OEE',
        });
    });
});

describe('PropertyDock KPI thresholds', () => {
    it('enables, edits and disables KPI thresholds with deadband', async () => {
        const { user, updates } = renderPropertyDock({
            type: 'kpi',
            title: 'Potencia',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 42,
                unit: 'kW',
            },
        });

        const thresholdsSection = getSection('Umbrales');
        const toggle = screen.getByLabelText('Activar Umbrales');
        const [warningInput, criticalInput, deadbandInput] = within(thresholdsSection).getAllByRole('textbox');

        expect(toggle).not.toBeChecked();
        expect(warningInput).toBeDisabled();
        expect(criticalInput).toBeDisabled();
        expect(deadbandInput).toBeDisabled();

        await user.click(toggle);

        expect(updates.at(-1)).toMatchObject({
            thresholds: [
                { severity: 'warning', value: 0 },
                { severity: 'critical', value: 0 },
            ],
            deadbandPercent: 5,
        });

        await user.clear(warningInput);
        await user.type(warningInput, '60');
        await user.tab();
        expect(updates.at(-1)?.thresholds).toEqual([
            { severity: 'warning', value: 60 },
            { severity: 'critical', value: 0 },
        ]);

        await user.clear(criticalInput);
        await user.type(criticalInput, '85');
        await user.tab();
        expect(updates.at(-1)?.thresholds).toEqual([
            { severity: 'warning', value: 60 },
            { severity: 'critical', value: 85 },
        ]);

        await user.clear(deadbandInput);
        await user.type(deadbandInput, '7');
        await user.tab();
        expect(updates.at(-1)).toMatchObject({
            deadbandPercent: 7,
        });

        await user.click(toggle);

        expect(updates.at(-1)?.thresholds).toEqual([]);
    });
});
