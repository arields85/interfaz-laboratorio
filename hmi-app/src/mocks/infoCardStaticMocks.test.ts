import { describe, expect, it } from 'vitest';
import { mockDashboards } from './admin.mock';
import { mockTemplates } from './template.mock';

describe('static info-card mock data', () => {
    it('seeds dashboards with a static info-card example without catalog-variable binding', () => {
        const infoCard = mockDashboards
            .flatMap((dashboard) => dashboard.widgets)
            .find((widget) => widget.type === 'info-card');

        expect(infoCard).toMatchObject({
            type: 'info-card',
            title: 'LINE SUMMARY',
            binding: { mode: 'simulated_value', simulatedValue: 0 },
            displayOptions: {
                valueFontSize: 35,
                fields: [
                    { id: 'field-1', label: 'Batch', value: 'B-204' },
                    { id: 'field-2', label: 'Operator', value: 'Ada' },
                ],
            },
        });
        expect(infoCard?.binding).not.toHaveProperty('catalogVariableId');
    });

    it('seeds templates with a static info-card preset that stays renderable without telemetry', () => {
        const infoCardPreset = mockTemplates
            .flatMap((template) => template.widgetPresets ?? [])
            .find((widget) => widget.type === 'info-card');

        expect(infoCardPreset).toMatchObject({
            type: 'info-card',
            title: 'LOT INFORMATION',
            binding: { mode: 'simulated_value', simulatedValue: 0 },
            displayOptions: {
                icon: 'Info',
                valueFontSize: 35,
                fields: [
                    { id: 'field-1', label: 'Line', value: 'Compression A' },
                    { id: 'field-2', label: 'Recipe', value: 'Standard' },
                ],
            },
        });
        expect(infoCardPreset?.binding).not.toHaveProperty('catalogVariableId');
    });
});
