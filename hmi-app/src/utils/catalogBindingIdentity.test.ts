import { describe, expect, it } from 'vitest';
import type { WidgetConfig } from '../domain/admin.types';
import { getUsedCatalogVariableIdsForWidget, hasDuplicateCatalogBindings } from './catalogBindingIdentity';

function makeMetricWidget(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
    return {
        id: 'widget-1',
        type: 'metric-card',
        title: 'Metric',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 3 },
        binding: {
            mode: 'real_variable',
            machineId: 101,
            variableKey: 'speed',
            bindingVersion: 'node-red-v1',
            catalogVariableId: 'cv-speed',
        },
        ...overrides,
    };
}

describe('catalogBindingIdentity', () => {
    it('allows reusing the same catalog variable when the machine differs', () => {
        const widgets = [
            makeMetricWidget({ id: 'widget-a' }),
            makeMetricWidget({
                id: 'widget-b',
                binding: {
                    mode: 'real_variable',
                    machineId: 202,
                    variableKey: 'speed',
                    bindingVersion: 'node-red-v1',
                    catalogVariableId: 'cv-speed',
                },
            }),
        ];

        expect(hasDuplicateCatalogBindings(widgets)).toBe(false);
        expect(getUsedCatalogVariableIdsForWidget(widgets, 'widget-b')).toEqual([]);
    });

    it('keeps blocking the same catalog variable for the same machine context', () => {
        const widgets = [
            makeMetricWidget({ id: 'widget-a' }),
            makeMetricWidget({ id: 'widget-b' }),
        ];

        expect(hasDuplicateCatalogBindings(widgets)).toBe(true);
        expect(getUsedCatalogVariableIdsForWidget(widgets, 'widget-b')).toEqual(['cv-speed']);
    });

    it('keeps hierarchy bindings unique per catalog variable', () => {
        const widgets = [
            makeMetricWidget({
                id: 'widget-a',
                hierarchyMode: true,
                binding: {
                    mode: 'real_variable',
                    catalogVariableId: 'cv-speed',
                },
            }),
            makeMetricWidget({
                id: 'widget-b',
                hierarchyMode: true,
                binding: {
                    mode: 'real_variable',
                    machineId: 202,
                    catalogVariableId: 'cv-speed',
                },
            }),
        ];

        expect(hasDuplicateCatalogBindings(widgets)).toBe(true);
        expect(getUsedCatalogVariableIdsForWidget(widgets, 'widget-b')).toEqual(['cv-speed']);
    });
});
