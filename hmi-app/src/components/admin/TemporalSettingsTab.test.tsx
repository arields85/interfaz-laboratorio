import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    TEMPORAL_SETTINGS_CHANGED_EVENT,
    TEMPORAL_SETTINGS_STORAGE_KEY,
} from '../../config/temporalSettings.config';
import TemporalSettingsTab from './TemporalSettingsTab';

function createSaveRef() {
    return { current: null as null | (() => void) };
}

describe('TemporalSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('edits plant timezone and overnight shifts in draft state before save', async () => {
        const user = userEvent.setup();

        render(<TemporalSettingsTab />);

        await user.type(screen.getByLabelText('Timezone de planta'), 'America/Santiago');
        await user.click(screen.getByRole('button', { name: 'Agregar turno' }));
        await user.type(screen.getByLabelText('Nombre del turno 1'), 'Turno noche');
        await user.clear(screen.getByLabelText('Inicio del turno 1'));
        await user.type(screen.getByLabelText('Inicio del turno 1'), '22:00');
        await user.clear(screen.getByLabelText('Fin del turno 1'));
        await user.type(screen.getByLabelText('Fin del turno 1'), '06:00');

        expect(screen.getByLabelText('Timezone de planta')).toHaveValue('America/Santiago');
        expect(screen.getByLabelText('Nombre del turno 1')).toHaveValue('Turno noche');
        expect(screen.getByLabelText('Fin del turno 1')).toHaveValue('06:00');
        expect(localStorage.getItem(TEMPORAL_SETTINGS_STORAGE_KEY)).toBeNull();
    });

    it('persists settings locally and dispatches the same-session refresh event on save', async () => {
        const user = userEvent.setup();
        const saveRef = createSaveRef();
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const eventSpy = vi.fn();
        document.addEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, eventSpy);

        render(<TemporalSettingsTab saveRef={saveRef} />);

        await user.type(screen.getByLabelText('Timezone de planta'), 'UTC');
        await user.click(screen.getByRole('button', { name: 'Agregar turno' }));
        await user.type(screen.getByLabelText('Nombre del turno 1'), 'Turno A');

        act(() => {
            saveRef.current?.();
        });

        expect(localStorage.getItem(TEMPORAL_SETTINGS_STORAGE_KEY)).toContain('"plantTimezone":"UTC"');
        expect(localStorage.getItem(TEMPORAL_SETTINGS_STORAGE_KEY)).toContain('"label":"Turno A"');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(eventSpy).toHaveBeenCalledTimes(1);

        document.removeEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, eventSpy);
    });

    it('blocks save and shows validation when a shift row is incomplete instead of silently dropping it', async () => {
        const user = userEvent.setup();
        const saveRef = createSaveRef();
        const dirtySpy = vi.fn();
        const eventSpy = vi.fn();
        document.addEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, eventSpy);

        render(<TemporalSettingsTab saveRef={saveRef} onDirtyChange={dirtySpy} />);

        await user.click(screen.getByRole('button', { name: 'Agregar turno' }));
        await user.type(screen.getByLabelText('Nombre del turno 1'), 'Turno incompleto');
        await user.clear(screen.getByLabelText('Inicio del turno 1'));

        act(() => {
            saveRef.current?.();
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Completa todos los campos de cada turno antes de guardar.');
        expect(localStorage.getItem(TEMPORAL_SETTINGS_STORAGE_KEY)).toBeNull();
        expect(eventSpy).not.toHaveBeenCalled();
        expect(dirtySpy).not.toHaveBeenCalledWith(false);

        document.removeEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, eventSpy);
    });

    it('shows a save error and keeps the draft dirty when local storage fails', async () => {
        const user = userEvent.setup();
        const saveRef = createSaveRef();
        const dirtySpy = vi.fn();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        render(<TemporalSettingsTab saveRef={saveRef} onDirtyChange={dirtySpy} />);

        await user.type(screen.getByLabelText('Timezone de planta'), 'UTC');

        act(() => {
            saveRef.current?.();
        });

        expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron guardar los ajustes temporales.');
        expect(localStorage.getItem(TEMPORAL_SETTINGS_STORAGE_KEY)).toBeNull();
        expect(dirtySpy).not.toHaveBeenCalledWith(false);
    });

    it('uses semantic admin tokens instead of hardcoded white or red classes in the temporal settings UI', async () => {
        const user = userEvent.setup();
        const saveRef = createSaveRef();

        render(<TemporalSettingsTab saveRef={saveRef} />);

        await user.click(screen.getByRole('button', { name: 'Agregar turno' }));

        act(() => {
            saveRef.current?.();
        });

        const settingsHeading = screen.getByText('Ajustes');
        const shiftsHeading = screen.getByText('Turnos');
        const addShiftButton = screen.getByRole('button', { name: 'Agregar turno' });
        const removeShiftButton = screen.getByRole('button', { name: 'Eliminar turno' });
        const alert = screen.getByRole('alert');

        expect(settingsHeading).toHaveClass('text-industrial-text');
        expect(shiftsHeading).toHaveClass('text-industrial-text');
        expect(addShiftButton).toHaveClass('admin-accent-ghost');
        expect(removeShiftButton).toHaveClass('text-industrial-muted', 'hover:text-industrial-text');
        expect(alert).toHaveClass('text-status-critical');

        expect(settingsHeading.className).not.toMatch(/text-white/);
        expect(shiftsHeading.className).not.toMatch(/text-white/);
        expect(addShiftButton.className).not.toMatch(/text-white|border-white\/|bg-white\//);
        expect(removeShiftButton.className).not.toMatch(/hover:text-white/);
        expect(alert.className).not.toMatch(/text-red-300/);
    });
});
