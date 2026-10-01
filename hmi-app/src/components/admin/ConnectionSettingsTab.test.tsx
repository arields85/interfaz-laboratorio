import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectionSettingsTab from './ConnectionSettingsTab';
import { downloadJsonFile } from '../../utils/portableFile';

const invalidateQueries = vi.fn();

vi.mock('../../utils/portableFile', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/portableFile')>()),
    downloadJsonFile: vi.fn(),
}));

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

    it('projects dirty on edit and saved through the save ref after writes and invalidations complete', () => {
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void) };

        render(
            <ConnectionSettingsTab
                onDirtyChange={onDirtyChange}
                onSaveStatusChange={onSaveStatusChange}
                saveRef={saveRef}
            />,
        );

        fireEvent.change(screen.getByLabelText('Endpoint Snapshot'), {
            target: { value: '/api/custom' },
        });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');

        act(() => {
            saveRef.current?.();
        });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('saved');
        expect(onDirtyChange).toHaveBeenCalledWith(false);
    });

    it('projects error and keeps the tab dirty when a persistence write throws', () => {
        invalidateQueries.mockImplementation(() => {
            throw new Error('storage unavailable');
        });
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void) };

        render(
            <ConnectionSettingsTab
                onDirtyChange={onDirtyChange}
                onSaveStatusChange={onSaveStatusChange}
                saveRef={saveRef}
            />,
        );

        fireEvent.change(screen.getByLabelText('URL Base de Node-RED'), {
            target: { value: 'https://node-red.local' },
        });

        expect(() => {
            act(() => {
                saveRef.current?.();
            });
        }).not.toThrow();
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('error');
        expect(onDirtyChange).not.toHaveBeenCalledWith(false);
    });

    it('retires Leda snapshot export controls without changing industrial telemetry settings', () => {
        localStorage.setItem('hmi:snapshot-export-enabled', 'true');
        localStorage.setItem('hmi:snapshot-export-endpoint', '/legacy-leda-snapshot');
        localStorage.setItem('hmi:snapshot-export-interval-ms', '1234');

        render(<ConnectionSettingsTab />);

        expect(screen.queryByLabelText('Habilitar exportación automática del snapshot actual')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Endpoint Export Snapshot Actual')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Intervalo Export Snapshot Actual (ms)')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Endpoint Snapshot')).toBeInTheDocument();
        expect(screen.getByLabelText('Endpoint Histórico')).toBeInTheDocument();
        expect(screen.getByLabelText('Endpoint Activity-Series')).toBeInTheDocument();
        expect(localStorage.getItem('hmi:snapshot-export-enabled')).toBe('true');
        expect(localStorage.getItem('hmi:snapshot-export-endpoint')).toBe('/legacy-leda-snapshot');
        expect(localStorage.getItem('hmi:snapshot-export-interval-ms')).toBe('1234');
    });
});

describe('ConnectionSettingsTab copy buttons', () => {
    const writeText = vi.fn<(text: string) => Promise<void>>();

    const COPY_FIELDS = [
        { copyLabel: 'Copiar URL base', fieldLabel: 'URL Base de Node-RED', value: 'https://node-red.local', copied: 'URL base copiada.' },
        { copyLabel: 'Copiar endpoint snapshot', fieldLabel: 'Endpoint Snapshot', value: '/api/custom', copied: 'Endpoint snapshot copiado.' },
        { copyLabel: 'Copiar endpoint histórico', fieldLabel: 'Endpoint Histórico', value: '/api/custom/history', copied: 'Endpoint histórico copiado.' },
        { copyLabel: 'Copiar endpoint activity-series', fieldLabel: 'Endpoint Activity-Series', value: '/api/custom/series', copied: 'Endpoint activity-series copiado.' },
    ];

    beforeEach(() => {
        localStorage.clear();
        vi.stubEnv('VITE_NODE_RED_BASE_URL', '');
        writeText.mockReset();
        writeText.mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        localStorage.clear();
        vi.unstubAllEnvs();
        Reflect.deleteProperty(navigator, 'clipboard');
    });

    it.each(COPY_FIELDS)('copies the current unsaved value of $fieldLabel', async ({ copyLabel, fieldLabel, value, copied }) => {
        render(<ConnectionSettingsTab />);

        fireEvent.change(screen.getByLabelText(fieldLabel), { target: { value } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: copyLabel }));
        });

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith(value);
        expect(screen.getByRole('status')).toHaveTextContent(copied);
    });

    it('swaps the copy icon for a check for about 1.5 seconds and then restores it', async () => {
        vi.useFakeTimers();
        render(<ConnectionSettingsTab />);
        const button = screen.getByRole('button', { name: 'Copiar URL base' });

        expect(button.querySelector('.lucide-copy')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(button);
        });

        expect(button.querySelector('.lucide-check')).toBeInTheDocument();
        expect(button.querySelector('.lucide-copy')).not.toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(1_600);
        });

        expect(button.querySelector('.lucide-copy')).toBeInTheDocument();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('announces the feedback through a polite live region', () => {
        render(<ConnectionSettingsTab />);

        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });

    it('shows a clear message when the clipboard rejects the write', async () => {
        writeText.mockRejectedValue(new Error('denied'));
        render(<ConnectionSettingsTab />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copiar URL base' }));
        });

        expect(screen.getByRole('status')).toHaveTextContent('No pudimos copiar al portapapeles.');
        expect(screen.getByRole('button', { name: 'Copiar URL base' }).querySelector('.lucide-check')).not.toBeInTheDocument();
    });

    it('shows the same message when the clipboard is unavailable', async () => {
        Reflect.deleteProperty(navigator, 'clipboard');
        render(<ConnectionSettingsTab />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copiar endpoint snapshot' }));
        });

        expect(screen.getByRole('status')).toHaveTextContent('No pudimos copiar al portapapeles.');
    });

    it('does not mark the tab dirty when copying', async () => {
        const onDirtyChange = vi.fn();
        render(<ConnectionSettingsTab onDirtyChange={onDirtyChange} />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copiar URL base' }));
        });

        expect(onDirtyChange).not.toHaveBeenCalled();
    });
});

describe('ConnectionSettingsTab export and import', () => {
    const VALUES = {
        baseUrl: 'https://node-red.prod.local:1880',
        endpoint: '/api/prod',
        historyEndpoint: '/api/prod/history',
        activitySeriesEndpoint: '/api/prod/series',
    };

    function connectionFile(connection: Record<string, unknown> = VALUES): File {
        return new File(
            [JSON.stringify({
                format: 'interfaz-laboratorio-data-connection',
                schemaVersion: 1,
                exportedAt: '2026-10-01T12:00:00.000Z',
                connection,
            })],
            'connection.json',
            { type: 'application/json' },
        );
    }

    function chooseFile(file: File) {
        const input = screen.getByLabelText('Seleccionar archivo de conexión') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [file] } });
        return input;
    }

    beforeEach(() => {
        localStorage.clear();
        vi.stubEnv('VITE_NODE_RED_BASE_URL', '');
        vi.mocked(downloadJsonFile).mockReset();
    });

    afterEach(() => {
        invalidateQueries.mockReset();
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('exports the current (unsaved) form values as a connection file', () => {
        render(<ConnectionSettingsTab />);

        fireEvent.change(screen.getByLabelText('URL Base de Node-RED'), { target: { value: VALUES.baseUrl } });
        fireEvent.change(screen.getByLabelText('Endpoint Snapshot'), { target: { value: VALUES.endpoint } });
        fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

        expect(downloadJsonFile).toHaveBeenCalledTimes(1);
        const [fileName, json] = vi.mocked(downloadJsonFile).mock.calls[0];
        expect(fileName).toMatch(/^interfaz-laboratorio-connection-\d{8}-\d{4}\.json$/);
        expect(JSON.parse(json)).toMatchObject({
            format: 'interfaz-laboratorio-data-connection',
            schemaVersion: 1,
            connection: {
                baseUrl: VALUES.baseUrl,
                endpoint: VALUES.endpoint,
                historyEndpoint: '/api/hmi-data/history',
                activitySeriesEndpoint: '/api/hmi-data/activity-series',
            },
        });
        expect(localStorage.length).toBe(0);
    });

    it('explains that the export uses the current form values', () => {
        render(<ConnectionSettingsTab />);

        expect(screen.getByText(/valores actuales del formulario/i)).toBeInTheDocument();
    });

    it('refuses to export invalid values and says why', () => {
        render(<ConnectionSettingsTab />);

        fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

        expect(downloadJsonFile).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('No se puede exportar: La URL base es obligatoria.');
    });

    it('opens the file picker from the Importar button', () => {
        render(<ConnectionSettingsTab />);
        const input = screen.getByLabelText('Seleccionar archivo de conexión') as HTMLInputElement;
        const click = vi.spyOn(input, 'click');

        fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

        expect(click).toHaveBeenCalledTimes(1);
    });

    it('fills the form from a valid file and marks the tab dirty without saving', async () => {
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();
        render(<ConnectionSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} />);

        chooseFile(connectionFile());

        await waitFor(() => {
            expect(screen.getByLabelText('URL Base de Node-RED')).toHaveValue(VALUES.baseUrl);
        });
        expect(screen.getByLabelText('Endpoint Snapshot')).toHaveValue(VALUES.endpoint);
        expect(screen.getByLabelText('Endpoint Histórico')).toHaveValue(VALUES.historyEndpoint);
        expect(screen.getByLabelText('Endpoint Activity-Series')).toHaveValue(VALUES.activitySeriesEndpoint);
        expect(onDirtyChange).toHaveBeenCalledWith(true);
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');
        expect(localStorage.length).toBe(0);
        expect(invalidateQueries).not.toHaveBeenCalled();
        expect(screen.getByText(/presione Guardar/)).toBeInTheDocument();
    });

    it('saves the imported values only when Guardar runs the save ref', async () => {
        const saveRef = { current: null as null | (() => void) };
        render(<ConnectionSettingsTab saveRef={saveRef} />);

        chooseFile(connectionFile());
        await waitFor(() => {
            expect(screen.getByLabelText('Endpoint Snapshot')).toHaveValue(VALUES.endpoint);
        });
        act(() => {
            saveRef.current?.();
        });

        expect(localStorage.getItem('hmi:node-red-base-url')).toBe(VALUES.baseUrl);
        expect(localStorage.getItem('hmi:node-red-endpoint')).toBe(VALUES.endpoint);
    });

    it('rejects an invalid file with a clear message and changes nothing', async () => {
        const onDirtyChange = vi.fn();
        render(<ConnectionSettingsTab onDirtyChange={onDirtyChange} />);

        fireEvent.change(screen.getByLabelText('URL Base de Node-RED'), { target: { value: 'https://keep.local' } });
        onDirtyChange.mockClear();

        chooseFile(connectionFile({ ...VALUES, baseUrl: 'not-a-url' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'No pudimos importar el archivo: La URL base debe ser una URL absoluta http o https.',
        );
        expect(screen.getByLabelText('URL Base de Node-RED')).toHaveValue('https://keep.local');
        expect(screen.getByLabelText('Endpoint Snapshot')).toHaveValue('/api/hmi-data');
        expect(onDirtyChange).not.toHaveBeenCalled();
    });

    it('rejects a file that is not JSON', async () => {
        render(<ConnectionSettingsTab />);

        chooseFile(new File(['{nope'], 'bad.json', { type: 'application/json' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'No pudimos importar el archivo: El archivo no es un JSON válido.',
        );
    });

    it('resets the file input so the same file can be chosen again', async () => {
        render(<ConnectionSettingsTab />);

        const input = chooseFile(connectionFile());

        await waitFor(() => {
            expect(input.value).toBe('');
        });
    });
});
