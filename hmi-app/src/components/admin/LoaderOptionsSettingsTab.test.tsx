import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import LoaderOptionsSettingsTab from './LoaderOptionsSettingsTab';
import { LOADER_OPTIONS_STORAGE_KEY } from '../../config/loaderOptions.config';

function createSaveRef() {
    return { current: null as null | (() => void) };
}

describe('LoaderOptionsSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('shows the Opciones section, helper text, and enables duration editing only while each loader is enabled', async () => {
        const user = userEvent.setup();

        render(<LoaderOptionsSettingsTab />);

        expect(screen.getByText('Opciones')).toBeInTheDocument();
        expect(screen.getAllByText('Minimo 0.2s · Maximo 15s')).toHaveLength(2);

        const shortToggle = screen.getByRole('checkbox', { name: 'Habilitar loader short' });
        const longToggle = screen.getByRole('checkbox', { name: 'Habilitar loader long' });
        const shortDurationInput = screen.getByLabelText('Duracion short (s)');
        const longDurationInput = screen.getByLabelText('Duracion long (s)');

        expect(shortToggle).toBeChecked();
        expect(longToggle).toBeChecked();
        expect(shortDurationInput).toBeEnabled();
        expect(longDurationInput).toBeEnabled();

        await user.click(longToggle);

        expect(longToggle).not.toBeChecked();
        expect(longDurationInput).toBeDisabled();
        expect(shortDurationInput).toBeEnabled();
    });

    it('falls back to default durations when persisted values are invalid', () => {
        localStorage.setItem(LOADER_OPTIONS_STORAGE_KEY, JSON.stringify({
            short: { enabled: true, durationSeconds: 'fast' },
            long: { enabled: true, durationSeconds: -4 },
        }));

        render(<LoaderOptionsSettingsTab />);

        expect(screen.getByLabelText('Duracion short (s)')).toHaveValue(2);
        expect(screen.getByLabelText('Duracion long (s)')).toHaveValue(8);
    });

    it('restores default values only in the draft until save and then persists them', async () => {
        const user = userEvent.setup();
        const saveRef = createSaveRef();

        localStorage.setItem(LOADER_OPTIONS_STORAGE_KEY, JSON.stringify({
            short: { enabled: false, durationSeconds: 4 },
            long: { enabled: true, durationSeconds: 11 },
        }));

        render(<LoaderOptionsSettingsTab saveRef={saveRef} />);

        const shortToggle = screen.getByRole('checkbox', { name: 'Habilitar loader short' });
        const shortDurationInput = screen.getByLabelText('Duracion short (s)');
        const longDurationInput = screen.getByLabelText('Duracion long (s)');

        expect(shortToggle).not.toBeChecked();
        expect(shortDurationInput).toBeDisabled();
        expect(longDurationInput).toHaveValue(11);

        await user.click(screen.getByRole('button', { name: 'Restaurar valores por defecto' }));

        expect(shortToggle).toBeChecked();
        expect(shortDurationInput).toBeEnabled();
        expect(shortDurationInput).toHaveValue(2);
        expect(longDurationInput).toHaveValue(8);
        expect(localStorage.getItem(LOADER_OPTIONS_STORAGE_KEY)).toContain('"durationSeconds":11');

        act(() => {
            saveRef.current?.();
        });

        expect(localStorage.getItem(LOADER_OPTIONS_STORAGE_KEY)).toBe(JSON.stringify({
            long: { enabled: true, durationSeconds: 8 },
            short: { enabled: true, durationSeconds: 2 },
        }));
    });
});

describe('LoaderOptionsSettingsTab save status projection', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('projects dirty when an edit marks the tab dirty', async () => {
        const user = userEvent.setup();
        const handleDirtyChange = vi.fn();
        const handleSaveStatusChange = vi.fn();

        render(
            <LoaderOptionsSettingsTab
                onDirtyChange={handleDirtyChange}
                onSaveStatusChange={handleSaveStatusChange}
            />,
        );

        await user.click(screen.getByRole('checkbox', { name: 'Habilitar loader short' }));

        expect(handleSaveStatusChange).toHaveBeenLastCalledWith('dirty');
        expect(handleDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it('projects saved after the storage write through the save ref succeeds', async () => {
        const user = userEvent.setup();
        const handleDirtyChange = vi.fn();
        const handleSaveStatusChange = vi.fn();
        const saveRef = createSaveRef();

        render(
            <LoaderOptionsSettingsTab
                onDirtyChange={handleDirtyChange}
                onSaveStatusChange={handleSaveStatusChange}
                saveRef={saveRef}
            />,
        );

        await user.click(screen.getByRole('checkbox', { name: 'Habilitar loader short' }));

        act(() => {
            saveRef.current?.();
        });

        expect(handleSaveStatusChange).toHaveBeenLastCalledWith('saved');
        expect(handleDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('projects error and leaves dirty true when the storage write throws', async () => {
        const user = userEvent.setup();
        const handleDirtyChange = vi.fn();
        const handleSaveStatusChange = vi.fn();
        const saveRef = createSaveRef();

        render(
            <LoaderOptionsSettingsTab
                onDirtyChange={handleDirtyChange}
                onSaveStatusChange={handleSaveStatusChange}
                saveRef={saveRef}
            />,
        );

        await user.click(screen.getByRole('checkbox', { name: 'Habilitar loader short' }));

        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        act(() => {
            saveRef.current?.();
        });

        expect(handleSaveStatusChange).toHaveBeenLastCalledWith('error');
        expect(handleDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it('projects dirty when restoring defaults, which only marks dirty without persisting', async () => {
        const user = userEvent.setup();
        const handleDirtyChange = vi.fn();
        const handleSaveStatusChange = vi.fn();

        localStorage.setItem(LOADER_OPTIONS_STORAGE_KEY, JSON.stringify({
            short: { enabled: false, durationSeconds: 4 },
            long: { enabled: true, durationSeconds: 11 },
        }));

        render(
            <LoaderOptionsSettingsTab
                onDirtyChange={handleDirtyChange}
                onSaveStatusChange={handleSaveStatusChange}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Restaurar valores por defecto' }));

        expect(handleSaveStatusChange).toHaveBeenLastCalledWith('dirty');
        expect(handleDirtyChange).toHaveBeenLastCalledWith(true);
        expect(localStorage.getItem(LOADER_OPTIONS_STORAGE_KEY)).toContain('"durationSeconds":11');
    });
});
