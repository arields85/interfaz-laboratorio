import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONNECTION_STORAGE_KEY = 'test:global-settings:connection';
const DESIGN_STORAGE_KEY = 'test:global-settings:design';
const LOADER_STORAGE_KEY = 'test:global-settings:loader';
const TEMPORAL_STORAGE_KEY = 'test:global-settings:temporal';
const VOICE_STORAGE_KEY = 'test:global-settings:voice';

let resolveVoiceSave: (() => void) | null = null;
let voiceSaveShouldFail = false;

vi.mock('./ConnectionSettingsTab', async () => {
    const React = await vi.importActual<typeof import('react')>('react');

    return {
        default: function MockConnectionSettingsTab({ onDirtyChange, saveRef }: { onDirtyChange?: (dirty: boolean) => void; saveRef?: { current: (() => void) | null } }) {
            const [value, setValue] = React.useState(() => localStorage.getItem(CONNECTION_STORAGE_KEY) ?? 'Persisted connection');

            if (saveRef) {
                saveRef.current = () => {
                    localStorage.setItem(CONNECTION_STORAGE_KEY, value);
                    onDirtyChange?.(false);
                };
            }

            return (
                <div>
                    <label htmlFor="connection-draft">Connection draft</label>
                    <input
                        id="connection-draft"
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            onDirtyChange?.(true);
                        }}
                    />
                </div>
            );
        },
    };
});

vi.mock('./DesignSettingsTab', async () => {
    const React = await vi.importActual<typeof import('react')>('react');

    return {
        default: function MockDesignSettingsTab({ onDirtyChange, saveRef, revertRef }: { onDirtyChange?: (dirty: boolean) => void; saveRef?: { current: (() => void) | null }; revertRef?: { current: (() => void) | null } }) {
            const persisted = () => localStorage.getItem(DESIGN_STORAGE_KEY) ?? 'Persisted design';
            const [value, setValue] = React.useState(persisted);

            if (saveRef) {
                saveRef.current = () => {
                    localStorage.setItem(DESIGN_STORAGE_KEY, value);
                    document.documentElement.dataset.designPreview = value;
                    onDirtyChange?.(false);
                };
            }

            if (revertRef) {
                revertRef.current = () => {
                    const nextValue = persisted();
                    setValue(nextValue);
                    document.documentElement.dataset.designPreview = nextValue;
                    onDirtyChange?.(false);
                };
            }

            return (
                <div>
                    <label htmlFor="design-draft">Design draft</label>
                    <input
                        id="design-draft"
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            document.documentElement.dataset.designPreview = event.target.value;
                            onDirtyChange?.(true);
                        }}
                    />
                </div>
            );
        },
    };
});

vi.mock('./LoaderOptionsSettingsTab', async () => {
    const React = await vi.importActual<typeof import('react')>('react');

    return {
        default: function MockLoaderOptionsSettingsTab({ onDirtyChange, saveRef }: { onDirtyChange?: (dirty: boolean) => void; saveRef?: { current: (() => void) | null } }) {
            const [value, setValue] = React.useState(() => localStorage.getItem(LOADER_STORAGE_KEY) ?? 'Persisted loader');

            if (saveRef) {
                saveRef.current = () => {
                    localStorage.setItem(LOADER_STORAGE_KEY, value);
                    onDirtyChange?.(false);
                };
            }

            return (
                <div>
                    <label htmlFor="loader-draft">Loader draft</label>
                    <input
                        id="loader-draft"
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            onDirtyChange?.(true);
                        }}
                    />
                </div>
            );
        },
    };
});

vi.mock('./TemporalSettingsTab', async () => {
    const React = await vi.importActual<typeof import('react')>('react');

    return {
        default: function MockTemporalSettingsTab({ onDirtyChange, saveRef }: { onDirtyChange?: (dirty: boolean) => void; saveRef?: { current: (() => void) | null } }) {
            const [timezone, setTimezone] = React.useState(() => localStorage.getItem(TEMPORAL_STORAGE_KEY) ?? 'Persisted timezone');

            if (saveRef) {
                saveRef.current = () => {
                    localStorage.setItem(TEMPORAL_STORAGE_KEY, timezone);
                    document.dispatchEvent(new CustomEvent('hmi:temporal-settings-changed', {
                        detail: { plantTimezone: timezone, shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon'] }] },
                    }));
                    onDirtyChange?.(false);
                };
            }

            return (
                <div>
                    <label htmlFor="temporal-timezone">Temporal draft</label>
                    <input
                        id="temporal-timezone"
                        value={timezone}
                        onChange={(event) => {
                            setTimezone(event.target.value);
                            onDirtyChange?.(true);
                        }}
                    />
                </div>
            );
        },
    };
});

vi.mock('./VoiceSettingsTab', async () => {
    const React = await vi.importActual<typeof import('react')>('react');

    return {
        default: function MockVoiceSettingsTab({ onDirtyChange, onSaveStatusChange, saveRef }: { onDirtyChange?: (dirty: boolean) => void; onSaveStatusChange?: (status: 'dirty' | 'saving' | 'saved' | 'error' | null) => void; saveRef?: { current: (() => void | Promise<void>) | null } }) {
            const [value, setValue] = React.useState(() => localStorage.getItem(VOICE_STORAGE_KEY) ?? 'Persisted voice');

            if (saveRef) {
                saveRef.current = async () => {
                    onSaveStatusChange?.('saving');
                    await new Promise<void>((resolve) => {
                        resolveVoiceSave = resolve;
                    });
                    if (voiceSaveShouldFail) {
                        onSaveStatusChange?.('error');
                        onDirtyChange?.(true);
                        return;
                    }
                    localStorage.setItem(VOICE_STORAGE_KEY, value);
                    onDirtyChange?.(false);
                    onSaveStatusChange?.('saved');
                };
            }

            return (
                <div>
                    <label htmlFor="voice-draft">Voice draft</label>
                    <input
                        id="voice-draft"
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            onDirtyChange?.(true);
                            onSaveStatusChange?.('dirty');
                        }}
                    />
                    <label htmlFor="voice-effect-draft">Intensidad del efecto robótico</label>
                    <input
                        id="voice-effect-draft"
                        type="range"
                        min="0"
                        max="100"
                        defaultValue="50"
                        onChange={() => {
                            onDirtyChange?.(true);
                            onSaveStatusChange?.('dirty');
                        }}
                    />
                </div>
            );
        },
    };
});

import GlobalSettingsDialog from './GlobalSettingsDialog';

function Harness() {
    const [open, setOpen] = useState(true);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Reopen dialog
            </button>
            <GlobalSettingsDialog open={open} onClose={() => setOpen(false)} />
        </>
    );
}

function getSaveButton() {
    return screen.getByRole('button', { name: 'Guardar' });
}

describe('GlobalSettingsDialog', () => {
    beforeEach(() => {
        localStorage.clear();
        delete document.documentElement.dataset.designPreview;
        resolveVoiceSave = null;
        voiceSaveShouldFail = false;
    });

    it('renders VOZ as the final peer tab in the required order', () => {
        render(<Harness />);

        const dialog = screen.getByRole('dialog', { name: 'CONFIGURACION GENERAL' });
        const tabNames = Array.from(dialog.querySelectorAll('button')).slice(0, 5).map((button) => button.textContent);

        expect(tabNames).toEqual(['Conexion', 'Diseno', 'Opciones', 'Ajustes', 'Voz']);
    });

    it('keeps every tab draft alive while switching tabs in the open dialog', async () => {
        const user = userEvent.setup();

        render(<Harness />);

        await user.clear(screen.getByLabelText('Connection draft'));
        await user.type(screen.getByLabelText('Connection draft'), 'Connection unsaved');

        await user.click(screen.getByRole('button', { name: 'Diseno' }));
        await user.clear(screen.getByLabelText('Design draft'));
        await user.type(screen.getByLabelText('Design draft'), 'Design unsaved');

        await user.click(screen.getByRole('button', { name: 'Opciones' }));
        await user.clear(screen.getByLabelText('Loader draft'));
        await user.type(screen.getByLabelText('Loader draft'), 'Loader unsaved');

        await user.click(screen.getByRole('button', { name: 'Ajustes' }));
        await user.clear(screen.getByLabelText('Temporal draft'));
        await user.type(screen.getByLabelText('Temporal draft'), 'Temporal unsaved');

        await user.click(screen.getByRole('button', { name: 'Voz' }));
        await user.clear(screen.getByLabelText('Voice draft'));
        await user.type(screen.getByLabelText('Voice draft'), 'Voice unsaved');

        await user.click(screen.getByRole('button', { name: 'Conexion' }));
        expect(screen.getByLabelText('Connection draft')).toHaveValue('Connection unsaved');

        await user.click(screen.getByRole('button', { name: 'Diseno' }));
        expect(screen.getByLabelText('Design draft')).toHaveValue('Design unsaved');

        await user.click(screen.getByRole('button', { name: 'Opciones' }));
        expect(screen.getByLabelText('Loader draft')).toHaveValue('Loader unsaved');

        await user.click(screen.getByRole('button', { name: 'Ajustes' }));
        expect(screen.getByLabelText('Temporal draft')).toHaveValue('Temporal unsaved');

        await user.click(screen.getByRole('button', { name: 'Voz' }));
        expect(screen.getByLabelText('Voice draft')).toHaveValue('Voice unsaved');
    });

    it('keeps the tab content in a scrollable panel', () => {
        render(<Harness />);

        const dialog = screen.getByRole('dialog', { name: 'CONFIGURACION GENERAL' });
        const scrollPanel = dialog.querySelector('.hmi-scrollbar');

        expect(scrollPanel).toBeInTheDocument();
        expect(scrollPanel).toHaveClass('overflow-y-auto');
        expect(scrollPanel).toHaveClass('min-h-0');
    });

    it('projects the dirty Prisma effect status immediately before Save in the footer only on VOZ', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'Voz' }));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });

        const actions = screen.getByRole('group', { name: 'Acciones de configuración general' });
        const content = screen.getByRole('region', { name: 'Contenido de configuración general' });
        const status = within(actions).getByText('Cambios sin guardar');
        expect(status).toHaveClass('text-status-warning');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveAttribute('aria-atomic', 'true');
        expect(getSaveButton().previousElementSibling).toBe(status);
        expect(within(content).queryByText('Cambios sin guardar')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Conexion' }));
        expect(within(actions).queryByText('Cambios sin guardar')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Voz' }));
        expect(within(actions).getByText('Cambios sin guardar')).toHaveClass('text-status-warning');
    });

    it('projects saving and saved with their semantic tones in the same footer position', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Voz' }));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });

        await user.click(getSaveButton());

        const actions = screen.getByRole('group', { name: 'Acciones de configuración general' });
        const saving = within(actions).getByText('Guardando...');
        expect(saving).toHaveClass('text-admin-accent');
        expect(getSaveButton().previousElementSibling).toBe(saving);

        await act(async () => resolveVoiceSave?.());

        const saved = await within(actions).findByText('Guardado');
        expect(saved).toHaveClass('text-status-normal');
        expect(getSaveButton().previousElementSibling).toBe(saved);
    });

    it('projects save errors as critical and clears the projected status on close', async () => {
        const user = userEvent.setup();
        voiceSaveShouldFail = true;
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Voz' }));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });
        await user.click(getSaveButton());

        await act(async () => resolveVoiceSave?.());

        const actions = screen.getByRole('group', { name: 'Acciones de configuración general' });
        const error = await within(actions).findByText('Error al guardar');
        expect(error).toHaveClass('text-status-critical');
        expect(getSaveButton().previousElementSibling).toBe(error);

        await user.click(screen.getByRole('button', { name: 'Cerrar' }));
        await user.click(screen.getByRole('button', { name: 'Reopen dialog' }));
        await user.click(screen.getByRole('button', { name: 'Voz' }));

        await waitFor(() => {
            expect(screen.queryByText('Error al guardar')).not.toBeInTheDocument();
        });
    });

    it('discards mounted drafts on close without save and restores persisted values on reopen', async () => {
        const user = userEvent.setup();

        localStorage.setItem(CONNECTION_STORAGE_KEY, 'Persisted connection');
        localStorage.setItem(DESIGN_STORAGE_KEY, 'Persisted design');
        localStorage.setItem(LOADER_STORAGE_KEY, 'Persisted loader');
        localStorage.setItem(TEMPORAL_STORAGE_KEY, 'Persisted timezone');
        localStorage.setItem(VOICE_STORAGE_KEY, 'Persisted voice');
        document.documentElement.dataset.designPreview = 'Persisted design';

        render(<Harness />);

        await user.clear(screen.getByLabelText('Connection draft'));
        await user.type(screen.getByLabelText('Connection draft'), 'Connection unsaved');

        await user.click(screen.getByRole('button', { name: 'Diseno' }));
        await user.clear(screen.getByLabelText('Design draft'));
        await user.type(screen.getByLabelText('Design draft'), 'Design unsaved');

        await user.click(screen.getByRole('button', { name: 'Opciones' }));
        await user.clear(screen.getByLabelText('Loader draft'));
        await user.type(screen.getByLabelText('Loader draft'), 'Loader unsaved');

        await user.click(screen.getByRole('button', { name: 'Ajustes' }));
        await user.clear(screen.getByLabelText('Temporal draft'));
        await user.type(screen.getByLabelText('Temporal draft'), 'Temporal unsaved');

        await user.click(screen.getByRole('button', { name: 'Voz' }));
        await user.clear(screen.getByLabelText('Voice draft'));
        await user.type(screen.getByLabelText('Voice draft'), 'Voice unsaved');

        await user.click(screen.getByRole('button', { name: 'Cerrar' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.documentElement.dataset.designPreview).toBe('Persisted design');
        expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).toBe('Persisted connection');
        expect(localStorage.getItem(DESIGN_STORAGE_KEY)).toBe('Persisted design');
        expect(localStorage.getItem(LOADER_STORAGE_KEY)).toBe('Persisted loader');
        expect(localStorage.getItem(TEMPORAL_STORAGE_KEY)).toBe('Persisted timezone');
        expect(localStorage.getItem(VOICE_STORAGE_KEY)).toBe('Persisted voice');

        await user.click(screen.getByRole('button', { name: 'Reopen dialog' }));

        await user.click(screen.getByRole('button', { name: 'Conexion' }));
        expect(screen.getByLabelText('Connection draft')).toHaveValue('Persisted connection');

        await user.click(screen.getByRole('button', { name: 'Diseno' }));
        expect(screen.getByLabelText('Design draft')).toHaveValue('Persisted design');

        await user.click(screen.getByRole('button', { name: 'Opciones' }));
        expect(screen.getByLabelText('Loader draft')).toHaveValue('Persisted loader');

        await user.click(screen.getByRole('button', { name: 'Ajustes' }));
        expect(screen.getByLabelText('Temporal draft')).toHaveValue('Persisted timezone');

        await user.click(screen.getByRole('button', { name: 'Voz' }));
        expect(screen.getByLabelText('Voice draft')).toHaveValue('Persisted voice');
    });

    it('saves the active connection draft through the connection save branch only', async () => {
        const user = userEvent.setup();

        localStorage.setItem(CONNECTION_STORAGE_KEY, 'Persisted connection');
        localStorage.setItem(DESIGN_STORAGE_KEY, 'Persisted design');
        localStorage.setItem(LOADER_STORAGE_KEY, 'Persisted loader');

        render(<Harness />);

        await user.clear(screen.getByLabelText('Connection draft'));
        await user.type(screen.getByLabelText('Connection draft'), 'Connection saved');

        expect(getSaveButton()).toBeEnabled();

        await user.click(getSaveButton());

        expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).toBe('Connection saved');
        expect(localStorage.getItem(DESIGN_STORAGE_KEY)).toBe('Persisted design');
        expect(localStorage.getItem(LOADER_STORAGE_KEY)).toBe('Persisted loader');
        expect(getSaveButton()).toBeDisabled();
    });

    it('saves the active design draft through the design save branch and keeps the preview applied', async () => {
        const user = userEvent.setup();

        localStorage.setItem(DESIGN_STORAGE_KEY, 'Persisted design');
        document.documentElement.dataset.designPreview = 'Persisted design';

        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'Diseno' }));
        await user.clear(screen.getByLabelText('Design draft'));
        await user.type(screen.getByLabelText('Design draft'), 'Design saved');

        expect(getSaveButton()).toBeEnabled();

        await user.click(getSaveButton());

        expect(localStorage.getItem(DESIGN_STORAGE_KEY)).toBe('Design saved');
        expect(document.documentElement.dataset.designPreview).toBe('Design saved');
        expect(getSaveButton()).toBeDisabled();
    });

    it('saves the active Ajustes draft through the temporal settings save branch', async () => {
        const user = userEvent.setup();
        const eventSpy = vi.fn();
        document.addEventListener('hmi:temporal-settings-changed', eventSpy);

        localStorage.setItem(TEMPORAL_STORAGE_KEY, 'Persisted timezone');

        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'Ajustes' }));
        await user.clear(screen.getByLabelText('Temporal draft'));
        await user.type(screen.getByLabelText('Temporal draft'), 'UTC');

        expect(getSaveButton()).toBeEnabled();

        await user.click(getSaveButton());

        expect(localStorage.getItem(TEMPORAL_STORAGE_KEY)).toBe('UTC');
        expect(eventSpy).toHaveBeenCalledTimes(1);
        expect(getSaveButton()).toBeDisabled();

        document.removeEventListener('hmi:temporal-settings-changed', eventSpy);
    });

    it('saves the active Voz draft through the voice settings save branch', async () => {
        const user = userEvent.setup();

        localStorage.setItem(VOICE_STORAGE_KEY, 'Persisted voice');
        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'Voz' }));
        await user.clear(screen.getByLabelText('Voice draft'));
        await user.type(screen.getByLabelText('Voice draft'), '/voice/new');
        await user.click(getSaveButton());
        await act(async () => resolveVoiceSave?.());

        await waitFor(() => {
            expect(localStorage.getItem(VOICE_STORAGE_KEY)).toBe('/voice/new');
        });
        expect(getSaveButton()).toBeDisabled();
    });
});
