import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { useDataHistory } from '../../queries/useDataHistory';
import { ScalarPresentationController, TrendChartV2Controller } from './PresentationControllers';

vi.mock('../../queries/useDataHistory', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../queries/useDataHistory')>(),
    useDataHistory: vi.fn(() => ({
        data: { machineId: 101, variableKey: 'temperature', range: 'hora', unit: '°C', points: [] },
        isLoading: false,
        isError: false,
        error: null,
        isEnabled: true,
        isFetching: false,
        isPlaceholderData: false,
        isRefreshing: false,
    })),
}));

describe('presentation controllers', () => {
    it('runs the scalar binding seam before rendering', () => {
        render(
            <ScalarPresentationController
                widget={makeWidget({ id: 'scalar-2', binding: { mode: 'simulated_value', simulatedValue: 42 } })}
                equipmentMap={new Map()}
                render={(entry) => <output data-testid="entry">{String(entry.payload.value)}</output>}
            />,
        );

        expect(screen.getByTestId('entry')).toHaveTextContent('42');
    });

    it('keeps trend V2 prefetch ownership in its controller seam', () => {
        const prefetchQuery = vi.fn().mockResolvedValue(undefined);
        const widget = { ...makeWidget({ id: 'trend-v2' }), type: 'trend-chart-v2' as const, binding: { mode: 'real_variable' as const, machineId: 101, variableKey: 'temperature' } };
        render(
            <TrendChartV2Controller
                widget={widget}
                equipmentMap={new Map()}
                queryClient={{ prefetchQuery } as never}
                render={(entry) => <output data-testid="entry">{entry.capability}</output>}
            />,
        );

        expect(screen.getByTestId('entry')).toHaveTextContent('trend-chart-v2');
        expect(useDataHistory).toHaveBeenCalledTimes(1);
        expect(prefetchQuery).toHaveBeenCalledTimes(1);
        expect(prefetchQuery.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ queryKey: ['data', 'history', 101, 'temperature', '24h', null, null, null] }));
    });

    it('does not prefetch without a real binding', () => {
        const prefetchQuery = vi.fn();
        render(<TrendChartV2Controller widget={{ ...makeWidget({ id: 'trend-v2-sim', type: 'trend-chart-v2', binding: { mode: 'simulated_value', simulatedValue: 1 } }) }} equipmentMap={new Map()} queryClient={{ prefetchQuery } as never} render={() => null} />);
        expect(prefetchQuery).not.toHaveBeenCalled();
    });
});
