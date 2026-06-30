import { fireEvent, render, screen, within } from '@testing-library/react';
import DesignSettingsTab from './DesignSettingsTab';

function getTypographyGroup(...contents: string[]) {
    const group = Array.from(document.querySelectorAll('section.rounded-lg')).find((section) => (
        contents.every((content) => section.textContent?.includes(content))
    ));

    if (!group) {
        throw new Error(`No se encontro el grupo para ${contents.join(' / ')}`);
    }

    return group;
}

describe('DesignSettingsTab typography controls', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('style');
    });

    it('renames typography groups, removes descriptions, and persists size/tracking controls for the system font', () => {
        render(<DesignSettingsTab />);

        const systemGroup = getTypographyGroup('TEXTOS EN GENERAL');
        const [sizeInput, trackingInput] = within(systemGroup).getAllByRole('textbox');

        expect(screen.getByText('TEXTOS TÉCNICOS')).toBeInTheDocument();
        expect(screen.getByText('TEXTOS WIDGET GRÁFICOS')).toBeInTheDocument();
        expect(screen.getByText('TÍTULOS DE DASHBOARD')).toBeInTheDocument();
        expect(screen.getAllByText('VALORES NUMERICOS MOSTRADOS POR:')).toHaveLength(3);
        expect(getTypographyGroup('VALOR FLOTANTE FINAL MOSTRADO POR:', 'ACTIVITY-ANALYTICS', '% PROD')).toBeInTheDocument();

        expect(screen.queryByText('Textos, titulos, UI')).not.toBeInTheDocument();
        expect(screen.queryByText('Codigo, URLs, valores')).not.toBeInTheDocument();
        expect(screen.queryByText('TEXTOS TÉCNICOS (IDs, conteos, valores)')).not.toBeInTheDocument();
        expect(screen.queryByText('TEXTOS WIDGET GRÁFICOS (Ejes, labels de charts)')).not.toBeInTheDocument();
        expect(screen.queryByText('Titulo principal de cada dashboard')).not.toBeInTheDocument();
        expect(screen.queryByText('Valor numerico en KPI y Metric Card')).not.toBeInTheDocument();

        expect(sizeInput).toHaveValue('11');
        expect(trackingInput).toHaveValue('0');

        fireEvent.change(sizeInput, { target: { value: '14' } });
        fireEvent.change(trackingInput, { target: { value: '0.6' } });

        expect(document.documentElement.style.getPropertyValue('--font-size-system')).toBe('14px');
        expect(document.documentElement.style.getPropertyValue('--tracking-system')).toBe('0.6px');
    });

    it('adds size and tracking controls for the mono font and persists the CSS variables', () => {
        render(<DesignSettingsTab />);

        const monoGroup = getTypographyGroup('TEXTOS TÉCNICOS', 'IBMPlexMono');
        const [sizeInput, trackingInput] = within(monoGroup).getAllByRole('textbox');

        expect(sizeInput).toHaveValue('11');
        expect(trackingInput).toHaveValue('0');

        fireEvent.change(sizeInput, { target: { value: '13' } });
        fireEvent.change(trackingInput, { target: { value: '0.8' } });

        expect(document.documentElement.style.getPropertyValue('--font-size-mono')).toBe('13px');
        expect(document.documentElement.style.getPropertyValue('--tracking-mono')).toBe('0.8px');
    });

    it('persists dashboard title size and tracking overrides', () => {
        render(<DesignSettingsTab />);

        const titleGroup = getTypographyGroup('TÍTULOS DE DASHBOARD');
        const [sizeInput, trackingInput] = within(titleGroup).getAllByRole('textbox');

        fireEvent.change(sizeInput, { target: { value: '52' } });
        fireEvent.change(trackingInput, { target: { value: '1.5' } });

        expect(document.documentElement.style.getPropertyValue('--font-size-dashboard-title')).toBe('52px');
        expect(document.documentElement.style.getPropertyValue('--tracking-dashboard-title')).toBe('1.5px');
    });

    it('renders font and weight selector buttons for all five typography selectors', () => {
        render(<DesignSettingsTab />);

        const groupContents = [
            ['TEXTOS EN GENERAL'],
            ['TEXTOS TÉCNICOS'],
            ['TEXTOS WIDGET GRÁFICOS'],
            ['TÍTULOS DE DASHBOARD'],
            ['VALORES NUMERICOS MOSTRADOS POR:', 'METRIC-CARD'],
            ['VALORES NUMERICOS MOSTRADOS POR:', 'ACTIVITY-ANALYTICS'],
            ['VALOR FLOTANTE FINAL MOSTRADO POR:', 'ACTIVITY-ANALYTICS', '% PROD'],
        ] as const;

        for (const contents of groupContents) {
            const group = getTypographyGroup(...contents);
            const fontSelect = within(group).getAllByRole('button').find((button) => (
                ['JetBrainsMono', 'IBMPlexMono', 'Magistral'].includes(button.textContent?.trim() ?? '')
            ));
            const weightSelect = within(group).getAllByRole('button').find((button) => (
                /\(\d+\)/.test(button.textContent?.trim() ?? '')
            ));

            expect(fontSelect).toBeDefined();
            expect(weightSelect).toBeDefined();
        }
    });

    it('renders the current dashboard title font and weight triggers', () => {
        render(<DesignSettingsTab />);

        const titleGroup = getTypographyGroup('TÍTULOS DE DASHBOARD');
        const buttons = within(titleGroup).getAllByRole('button');
        const fontSelect = buttons.find((button) => button.textContent?.trim() === 'Magistral');
        const weightSelect = buttons.find((button) => button.textContent?.trim() === 'Book (400)');

        expect(fontSelect).toBeDefined();
        expect(weightSelect).toBeDefined();
    });

    it('expands typography size ranges for body, titles, and widget values', () => {
        render(<DesignSettingsTab />);

        const [systemSizeInput] = within(getTypographyGroup('TEXTOS EN GENERAL')).getAllByRole('textbox');
        const [titleSizeInput] = within(getTypographyGroup('TÍTULOS DE DASHBOARD')).getAllByRole('textbox');
        const [metricValueInput, metricTrackingInput, metricUnitInput] = within(getTypographyGroup('VALORES NUMERICOS MOSTRADOS POR:', 'METRIC-CARD')).getAllByRole('textbox');
        const [gaugeValueInput, gaugeTrackingInput, gaugeUnitInput] = within(getTypographyGroup('VALORES NUMERICOS MOSTRADOS POR:', 'KPI', 'MACHINE-ACTIVITY')).getAllByRole('textbox');
        const [activityAnalyticsValueInput, activityAnalyticsTrackingInput] = within(getTypographyGroup('VALORES NUMERICOS MOSTRADOS POR:', 'ACTIVITY-ANALYTICS')).getAllByRole('textbox');
        const [activityAnalyticsProdTrendValueInput, activityAnalyticsProdTrendTrackingInput] = within(getTypographyGroup('VALOR FLOTANTE FINAL MOSTRADO POR:', 'ACTIVITY-ANALYTICS', '% PROD')).getAllByRole('textbox');

        expect(systemSizeInput).toHaveValue('11');
        expect(titleSizeInput).toHaveValue('48');
        expect(metricValueInput).toHaveValue('35');
        expect(metricTrackingInput).toHaveValue('0');
        expect(metricUnitInput).toHaveValue('20');
        expect(gaugeValueInput).toHaveValue('35');
        expect(gaugeTrackingInput).toHaveValue('0');
        expect(gaugeUnitInput).toHaveValue('20');
        expect(activityAnalyticsValueInput).toHaveValue('20');
        expect(activityAnalyticsTrackingInput).toHaveValue('0');
        expect(activityAnalyticsProdTrendValueInput).toHaveValue('10');
        expect(activityAnalyticsProdTrendTrackingInput).toHaveValue('0');

        fireEvent.change(systemSizeInput, { target: { value: '20' } });
        fireEvent.change(titleSizeInput, { target: { value: '10' } });
        fireEvent.change(metricValueInput, { target: { value: '72' } });
        fireEvent.change(metricUnitInput, { target: { value: '24' } });
        fireEvent.change(gaugeValueInput, { target: { value: '68' } });
        fireEvent.change(gaugeTrackingInput, { target: { value: '1.2' } });
        fireEvent.change(gaugeUnitInput, { target: { value: '28' } });
        fireEvent.change(activityAnalyticsValueInput, { target: { value: '24' } });
        fireEvent.change(activityAnalyticsTrackingInput, { target: { value: '0.4' } });
        fireEvent.change(activityAnalyticsProdTrendValueInput, { target: { value: '15' } });
        fireEvent.change(activityAnalyticsProdTrendTrackingInput, { target: { value: '0.7' } });

        expect(document.documentElement.style.getPropertyValue('--font-size-system')).toBe('20px');
        expect(document.documentElement.style.getPropertyValue('--font-size-dashboard-title')).toBe('10px');
        expect(document.documentElement.style.getPropertyValue('--font-size-widget-value')).toBe('72px');
        expect(document.documentElement.style.getPropertyValue('--font-size-widget-unit')).toBe('24px');
        expect(document.documentElement.style.getPropertyValue('--font-size-widget-value-gauge')).toBe('68px');
        expect(document.documentElement.style.getPropertyValue('--tracking-widget-value-gauge')).toBe('1.2px');
        expect(document.documentElement.style.getPropertyValue('--font-size-widget-unit-gauge')).toBe('28px');
        expect(document.documentElement.style.getPropertyValue('--font-size-widget-value-activity-analytics')).toBe('24px');
        expect(document.documentElement.style.getPropertyValue('--tracking-widget-value-activity-analytics')).toBe('0.4px');
        expect(document.documentElement.style.getPropertyValue('--font-size-widget-value-activity-analytics-prod-trend')).toBe('15px');
        expect(document.documentElement.style.getPropertyValue('--tracking-widget-value-activity-analytics-prod-trend')).toBe('0.7px');
    });

    it('wraps the KPI and machine-activity controls without horizontal overflow', () => {
        render(<DesignSettingsTab />);

        const [gaugeSizeInput, , gaugeUnitInput] = within(getTypographyGroup('VALORES NUMERICOS MOSTRADOS POR:', 'KPI', 'MACHINE-ACTIVITY')).getAllByRole('textbox');
        const gaugeSizeRow = gaugeSizeInput.parentElement?.parentElement?.parentElement;
        const gaugeUnitRow = gaugeUnitInput.parentElement?.parentElement?.parentElement;

        expect(gaugeSizeRow).toHaveClass('flex-wrap', 'overflow-hidden');
        expect(gaugeSizeRow).not.toHaveClass('flex-nowrap', 'overflow-x-auto');
        expect(gaugeUnitRow).toHaveClass('flex-wrap', 'overflow-hidden');
        expect(gaugeUnitRow).not.toHaveClass('flex-nowrap', 'overflow-x-auto');
    });
});
