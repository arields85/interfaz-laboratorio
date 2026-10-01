import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DESIGN_COLOR_STORAGE_KEY, DESIGN_FONT_STORAGE_KEY } from '../services/designSettingsStorage.service';
import { FRAME_SHAPE_STORAGE_KEY } from '../services/frameShape.service';
import { ICON_CUTOUT_STORAGE_KEY } from '../services/iconCutout.service';
import { INSTRUMENT_THEME_STYLE, THEME_STYLE_STORAGE_KEY } from '../services/themeStyle.service';
import { useFrameShapeStore } from '../store/frameShape.store';
import { useIconCutoutStore } from '../store/iconCutout.store';
import { useThemeStylePresetStore } from '../store/themeStylePreset.store';
import { SHADER_DEFAULTS, SHADER_PARAMS_STORAGE_KEY, useShaderParamsStore } from '../store/shaderParams.store';
import { localStorageSharedConfig } from '../test/localStorageSharedConfig';
import { LS_KEY_BASE_URL } from '../config/dataConnection.config';
import { holdSharedConfigReapply } from '../services/sharedConfigReapplyHold.service';
import { applySharedConfigToDocument, startSharedConfigReapply } from './sharedConfigAppliers';

function remoteChange(key: string, value: string | null): void {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    localStorageSharedConfig.emitChange([key]);
}

describe('shared configuration appliers', () => {
    let stop: () => void;
    let queryClient: QueryClient;

    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('style');
        useFrameShapeStore.getState().setShape('standard');
        useIconCutoutStore.getState().setEnabled(false);
        queryClient = new QueryClient();
        stop = startSharedConfigReapply({ queryClient });
    });

    afterEach(() => {
        stop();
        useShaderParamsStore.getState().resetAll();
    });

    it('applies every stored value to the document at boot', () => {
        localStorage.setItem(FRAME_SHAPE_STORAGE_KEY, 'tab');
        localStorage.setItem(ICON_CUTOUT_STORAGE_KEY, 'true');
        localStorage.setItem(DESIGN_COLOR_STORAGE_KEY, JSON.stringify({ '--color-industrial-bg': '#123456' }));

        applySharedConfigToDocument();

        expect(useFrameShapeStore.getState().shape).toBe('tab');
        expect(useIconCutoutStore.getState().enabled).toBe(true);
        expect(document.documentElement.style.getPropertyValue('--color-industrial-bg')).toBe('#123456');
    });

    it('never writes to the shared configuration while applying', () => {
        localStorage.setItem(DESIGN_FONT_STORAGE_KEY, JSON.stringify({ '--font-size-system': '999' }));
        const write = vi.spyOn(localStorageSharedConfig, 'setItem');
        const remove = vi.spyOn(localStorageSharedConfig, 'removeItem');

        applySharedConfigToDocument();
        remoteChange(DESIGN_FONT_STORAGE_KEY, JSON.stringify({ '--font-size-system': '999' }));

        expect(write).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it('re-applies the frame shape and the cutout when another browser changes them', () => {
        remoteChange(FRAME_SHAPE_STORAGE_KEY, 'tab');
        remoteChange(ICON_CUTOUT_STORAGE_KEY, 'true');

        expect(useFrameShapeStore.getState().shape).toBe('tab');
        expect(useIconCutoutStore.getState().enabled).toBe(true);

        remoteChange(FRAME_SHAPE_STORAGE_KEY, null);
        expect(useFrameShapeStore.getState().shape).not.toBe('tab');
    });

    it('re-applies design colours and clears an override another browser removed', () => {
        remoteChange(DESIGN_COLOR_STORAGE_KEY, JSON.stringify({ '--color-industrial-bg': '#123456' }));
        expect(document.documentElement.style.getPropertyValue('--color-industrial-bg')).toBe('#123456');

        remoteChange(DESIGN_COLOR_STORAGE_KEY, null);
        expect(document.documentElement.style.getPropertyValue('--color-industrial-bg')).toBe('');
    });

    it('re-applies the design fonts when another browser changes them', () => {
        remoteChange(DESIGN_FONT_STORAGE_KEY, JSON.stringify({ '--font-size-system': '17' }));
        expect(document.documentElement.style.getPropertyValue('--font-size-system')).toBe('17px');

        remoteChange(DESIGN_FONT_STORAGE_KEY, null);
        expect(document.documentElement.style.getPropertyValue('--font-size-system')).toBe('');
    });

    it('re-applies the theme style and falls back to the classic one when the override is removed', () => {
        remoteChange(THEME_STYLE_STORAGE_KEY, INSTRUMENT_THEME_STYLE.id);
        expect(useThemeStylePresetStore.getState().classic).toBe(false);

        remoteChange(THEME_STYLE_STORAGE_KEY, null);
        expect(useThemeStylePresetStore.getState().classic).toBe(true);
    });

    it('rehydrates the shader parameters from the shared configuration', () => {
        const hue = SHADER_DEFAULTS.nebHue + 0.25;
        remoteChange(SHADER_PARAMS_STORAGE_KEY, JSON.stringify({ state: { params: { ...SHADER_DEFAULTS, nebHue: hue } }, version: 0 }));

        expect(useShaderParamsStore.getState().params.nebHue).toBe(hue);
    });

    it('invalidates the data queries when the data connection changes', () => {
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

        remoteChange(LS_KEY_BASE_URL, 'http://plant.invalid');

        expect(invalidate).toHaveBeenCalledTimes(3);
    });

    it('ignores changes to keys it does not own', () => {
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        useFrameShapeStore.getState().setShape('tab');

        localStorageSharedConfig.emitChange(['laboratorio_hmi_dashboards_v1']);

        expect(useFrameShapeStore.getState().shape).toBe('tab');
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('defers a remote change while an editor holds it and applies it on release', () => {
        const release = holdSharedConfigReapply();

        remoteChange(FRAME_SHAPE_STORAGE_KEY, 'tab');
        expect(useFrameShapeStore.getState().shape).not.toBe('tab');

        release();
        expect(useFrameShapeStore.getState().shape).toBe('tab');
    });

    it('keeps deferring until every hold is released, and releasing twice is harmless', () => {
        const first = holdSharedConfigReapply();
        const second = holdSharedConfigReapply();

        remoteChange(FRAME_SHAPE_STORAGE_KEY, 'tab');
        first();
        first();
        expect(useFrameShapeStore.getState().shape).not.toBe('tab');

        second();
        expect(useFrameShapeStore.getState().shape).toBe('tab');
    });

    it('stops reacting once stopped', () => {
        stop();

        remoteChange(FRAME_SHAPE_STORAGE_KEY, 'tab');

        expect(useFrameShapeStore.getState().shape).not.toBe('tab');
    });
});
