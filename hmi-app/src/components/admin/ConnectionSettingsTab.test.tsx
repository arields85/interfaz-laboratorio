import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectionSettingsTab from './ConnectionSettingsTab';

const invalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries }),
}));

describe('ConnectionSettingsTab activity-series settings', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubEnv('VITE_NODE_RED_BASE_URL', '');
    });

    afterEach(() => {
        invalidateQueries.mockReset();
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('renders the default activity-series endpoint and final url summary', () => {
        render(<ConnectionSettingsTab />);

        expect(screen.getByLabelText('Endpoint Activity-Series')).toHaveValue('/api/hmi-data/activity-series');
        expect(screen.getByText('URL ACTIVITY-SERIES')).toBeInTheDocument();
        expect(screen.getAllByText('Sin URL base configurada')).toHaveLength(3);
    });

    it('saves an empty activity-series endpoint and invalidates the future activity query key', () => {
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void) };

        render(<ConnectionSettingsTab onDirtyChange={onDirtyChange} saveRef={saveRef} />);

        fireEvent.change(screen.getByLabelText('URL Base de Node-RED'), {
            target: { value: 'https://node-red.local' },
        });
        fireEvent.change(screen.getByLabelText('Endpoint Activity-Series'), {
            target: { value: '' },
        });

        saveRef.current?.();

        expect(localStorage.getItem('hmi:activity-series-endpoint')).toBe('');
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['data', 'activity-series'] });
        expect(onDirtyChange).toHaveBeenCalledWith(false);
    });
});
