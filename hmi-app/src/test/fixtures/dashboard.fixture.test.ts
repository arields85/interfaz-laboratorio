import { describe, expect, it } from 'vitest';
import { makeGroupWidget, makeInfoCardWidget } from './dashboard.fixture';

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

describe('dashboard fixture group helpers', () => {
    it('creates an unlocked, member-less group fixture without a data binding', () => {
        const widget = makeGroupWidget();

        expect(widget).toMatchObject({
            type: 'group',
            title: 'Contenedor',
            memberWidgetIds: [],
            locked: false,
            displayOptions: { icon: 'Group' },
        });
        expect(widget.binding).toBeUndefined();
    });

    it('allows overriding members and lock state while preserving group type safety', () => {
        const widget = makeGroupWidget({
            memberWidgetIds: ['widget-a', 'widget-b'],
            locked: true,
        });

        expect(widget.type).toBe('group');
        expect(widget.memberWidgetIds).toEqual(['widget-a', 'widget-b']);
        expect(widget.locked).toBe(true);
    });
});
