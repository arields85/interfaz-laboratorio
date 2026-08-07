import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { saveTemporalSettingsConfig } from '../config/temporalSettings.config';
import { useTemporalSettings } from './useTemporalSettings';

describe('useTemporalSettings', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('reads the persisted settings and exposes a resolved timezone', () => {
        saveTemporalSettingsConfig({
            plantTimezone: 'America/Bogota',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' }],
        });

        const { result } = renderHook(() => useTemporalSettings());

        expect(result.current.config.plantTimezone).toBe('America/Bogota');
        expect(result.current.shifts).toHaveLength(1);
        expect(result.current.resolvedTimezone).toBe('America/Bogota');
    });

    it('preserves the shifts reference across rerenders until temporal config changes', () => {
        saveTemporalSettingsConfig({
            plantTimezone: 'America/Bogota',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' }],
        });

        const { result, rerender } = renderHook(() => useTemporalSettings());
        const initialShifts = result.current.shifts;

        rerender();

        expect(result.current.shifts).toBe(initialShifts);
    });

    it('re-renders immediately after the temporal settings save event fires', async () => {
        const { result } = renderHook(() => useTemporalSettings());

        act(() => {
            saveTemporalSettingsConfig({
                plantTimezone: 'America/Lima',
                shifts: [{ id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' }],
            });
        });

        await waitFor(() => {
            expect(result.current.config.plantTimezone).toBe('America/Lima');
        });
        expect(result.current.shifts[0]?.label).toBe('Turno B');
        expect(result.current.resolvedTimezone).toBe('America/Lima');
    });

    it('reacts to cross-tab storage updates when persisted settings change', async () => {
        const { result } = renderHook(() => useTemporalSettings());

        act(() => {
            localStorage.setItem('hmi:temporal-settings', JSON.stringify({
                plantTimezone: 'America/Mexico_City',
                shifts: [{ id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00' }],
            }));
            window.dispatchEvent(new StorageEvent('storage', { key: 'hmi:temporal-settings' }));
        });

        await waitFor(() => {
            expect(result.current.config.plantTimezone).toBe('America/Mexico_City');
        });
        expect(result.current.shifts[0]?.end).toBe('06:00');
    });
});
