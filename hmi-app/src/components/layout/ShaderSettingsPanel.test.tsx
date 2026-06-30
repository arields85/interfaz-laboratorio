import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShaderSettingsPanel from './ShaderSettingsPanel';
import {
    SHADER_BLEND_DEFAULTS,
    SHADER_CONFIG_SCHEMA,
    SHADER_CONFIG_VERSION,
    SHADER_DEFAULTS,
    useShaderParamsStore,
} from '../../store/shaderParams.store';

vi.mock('../admin/BackgroundSettingsTab', () => ({
    default: () => <div>Background settings</div>,
}));

function resetShaderStore() {
    act(() => {
        useShaderParamsStore.setState({
            params: { ...SHADER_DEFAULTS },
            blendModes: { ...SHADER_BLEND_DEFAULTS },
        });
    });
}

describe('ShaderSettingsPanel', () => {
    beforeEach(() => {
        localStorage.clear();
        resetShaderStore();
    });

    afterEach(() => {
        resetShaderStore();
        vi.restoreAllMocks();
    });

    it('pairs the import and export buttons with the expected icons', () => {
        render(<ShaderSettingsPanel open onClose={vi.fn()} />);

        const exportButton = screen.getByRole('button', { name: 'Exportar configuración de fondo' });
        const importButton = screen.getByRole('button', { name: 'Importar configuración de fondo' });

        expect(exportButton.querySelector('.lucide-upload')).toBeInTheDocument();
        expect(importButton.querySelector('.lucide-download')).toBeInTheDocument();
    });

    it('exports the current background config as a portable json file', async () => {
        const createObjectURLMock = vi.fn(() => 'blob:hmi-background-config');
        const revokeObjectURLMock = vi.fn();
        const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        Object.assign(URL, {
            createObjectURL: createObjectURLMock,
            revokeObjectURL: revokeObjectURLMock,
        });

        act(() => {
            useShaderParamsStore.getState().updateParam('starHue', 0.37);
        });

        render(<ShaderSettingsPanel open onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Exportar configuración de fondo' }));

        expect(createObjectURLMock).toHaveBeenCalledWith(expect.any(Blob));

        const exportBlob = createObjectURLMock.mock.calls[0]?.[0] as Blob;
        const exportJson = JSON.parse(await exportBlob.text()) as {
            schema: string;
            version: number;
            params: { starHue: number };
        };

        expect(exportJson.schema).toBe(SHADER_CONFIG_SCHEMA);
        expect(exportJson.version).toBe(SHADER_CONFIG_VERSION);
        expect(exportJson.params.starHue).toBeCloseTo(0.37);
        expect(anchorClickSpy).toHaveBeenCalledTimes(1);
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:hmi-background-config');
    });

    it('imports a portable background config file and applies it to the store', async () => {
        render(<ShaderSettingsPanel open onClose={vi.fn()} />);

        const input = document.querySelector('input[type="file"]');

        if (!(input instanceof HTMLInputElement)) {
            throw new Error('Expected file input to exist');
        }

        const file = new File(
            [
                JSON.stringify({
                    schema: SHADER_CONFIG_SCHEMA,
                    version: SHADER_CONFIG_VERSION,
                    exportedAt: '2026-06-30T00:00:00.000Z',
                    params: {
                        starHue: 0.91,
                        ringIntensity: 1.75,
                    },
                    blendModes: {
                        stars: 'multiply',
                    },
                }),
            ],
            'hmi-background-config.json',
            { type: 'application/json' },
        );

        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(useShaderParamsStore.getState().params.starHue).toBeCloseTo(0.91);
        });

        expect(useShaderParamsStore.getState().params.ringIntensity).toBeCloseTo(1.75);
        expect(useShaderParamsStore.getState().blendModes).toEqual(SHADER_BLEND_DEFAULTS);
        expect(screen.getByRole('status')).toHaveTextContent('CONFIGURACION IMPORTADA');
    });

    it('shows an error status for invalid import files without throwing', async () => {
        render(<ShaderSettingsPanel open onClose={vi.fn()} />);

        const input = document.querySelector('input[type="file"]');

        if (!(input instanceof HTMLInputElement)) {
            throw new Error('Expected file input to exist');
        }

        const file = new File(['{"badJson":'], 'broken.json', { type: 'application/json' });

        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('NO SE PUDO LEER EL JSON');
        });
    });
});
