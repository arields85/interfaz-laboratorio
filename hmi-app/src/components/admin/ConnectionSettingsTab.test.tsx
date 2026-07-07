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

    it('renders and saves the dashboard snapshot export controls alongside the other connection endpoints', () => {
        const saveRef = { current: null as null | (() => void) };

        render(<ConnectionSettingsTab saveRef={saveRef} />);

        expect(screen.getByLabelText('Habilitar exportación automática del snapshot actual')).not.toBeChecked();
        expect(screen.getByLabelText('Endpoint Export Snapshot Actual')).toHaveValue('');
        expect(screen.getByLabelText('Intervalo Export Snapshot Actual (ms)')).toHaveValue(5000);
        expect(screen.getByText('Deshabilitado')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Habilitar exportación automática del snapshot actual'));

        fireEvent.change(screen.getByLabelText('Endpoint Export Snapshot Actual'), {
            target: { value: '/exports/dashboard-live' },
        });
        fireEvent.change(screen.getByLabelText('Intervalo Export Snapshot Actual (ms)'), {
            target: { value: '250' },
        });

        saveRef.current?.();

        expect(localStorage.getItem('hmi:snapshot-export-enabled')).toBe('true');
        expect(localStorage.getItem('hmi:snapshot-export-endpoint')).toBe('/exports/dashboard-live');
        expect(localStorage.getItem('hmi:snapshot-export-interval-ms')).toBe('1000');
        expect(screen.getByText('URL EXPORT SNAPSHOT ACTUAL')).toBeInTheDocument();
    });
});
