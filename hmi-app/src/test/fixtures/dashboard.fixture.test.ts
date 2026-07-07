import { describe, expect, it } from 'vitest';
import { makeInfoCardWidget } from './dashboard.fixture';

describe('dashboard fixture info-card helpers', () => {
    it('creates a renderable static info-card fixture without catalog-variable binding', () => {
        const widget = makeInfoCardWidget();

        expect(widget).toMatchObject({
            type: 'info-card',
            title: 'INFO-CARD',
            binding: { mode: 'simulated_value', simulatedValue: 0 },
            displayOptions: {
                subtitle: 'Static summary',
                icon: 'Info',
                fields: [
                    { id: 'field-1', label: 'Batch', value: 'B-204', helpText: 'Static admin-authored information only.' },
                    { id: 'field-2', label: 'Operator', value: 'Ada' },
                ],
            },
        });
        expect(widget.binding).not.toHaveProperty('catalogVariableId');
    });

    it('allows overriding static fields while preserving info-card type safety', () => {
        const widget = makeInfoCardWidget({
            title: 'Line summary',
            displayOptions: {
                fields: [{ id: 'field-1', label: 'Line', value: 'A-01' }],
            },
        });

        expect(widget.type).toBe('info-card');
        expect(widget.title).toBe('Line summary');
        expect(widget.displayOptions?.fields).toEqual([
            { id: 'field-1', label: 'Line', value: 'A-01' },
        ]);
    });
});
