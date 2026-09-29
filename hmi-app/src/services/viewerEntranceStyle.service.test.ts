import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    applyViewerEntranceOverrides,
    applyViewerEntranceSettingsToDocument,
    DEFAULT_VIEWER_ENTRANCE_SETTINGS,
    readStoredViewerEntranceSettings,
    resetViewerEntranceSettingsOnDocument,
    VIEWER_ENTRANCE_LIMITS,
    VIEWER_ENTRANCE_STORAGE_KEY,
    viewerEntranceSettingsToCssProperties,
    writeStoredViewerEntranceSettings,
} from './viewerEntranceStyle.service';

const root = document.documentElement;

describe('viewerEntranceStyle.service', () => {
    beforeEach(() => {
        localStorage.clear();
        resetViewerEntranceSettingsOnDocument(root);
    });

    afterEach(() => {
        localStorage.clear();
        resetViewerEntranceSettingsOnDocument(root);
    });

    it('keeps the code defaults equal to the values in the index.css :root block', () => {
        const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf-8');
        const block = css.match(/:root\s*{([^}]*--viewer-entrance-frame-duration[^}]*)}/)?.[1] ?? '';
        const properties = viewerEntranceSettingsToCssProperties(DEFAULT_VIEWER_ENTRANCE_SETTINGS);

        for (const [name, value] of Object.entries(properties)) {
            expect(block).toMatch(new RegExp(`${name}:\\s*${value};`));
        }
    });

    it('maps the three settings to the --viewer-entrance-* tokens', () => {
        expect(
            viewerEntranceSettingsToCssProperties({
                outlineWidthPx: 2.5,
                outlineOpacityPercent: 60,
                flashIntensityPercent: 35,
            }),
        ).toEqual({
            '--viewer-entrance-outline-width': '2.5px',
            '--viewer-entrance-outline-opacity': '0.6',
            '--viewer-entrance-flash-peak': '0.35',
        });
    });

    it('resolves to the defaults when nothing is stored', () => {
        expect(readStoredViewerEntranceSettings()).toEqual(DEFAULT_VIEWER_ENTRANCE_SETTINGS);
    });

    it('stores only the overrides that differ from the defaults', () => {
        writeStoredViewerEntranceSettings({ ...DEFAULT_VIEWER_ENTRANCE_SETTINGS, flashIntensityPercent: 30 });

        expect(JSON.parse(localStorage.getItem(VIEWER_ENTRANCE_STORAGE_KEY) ?? 'null')).toEqual({
            flashIntensityPercent: 30,
        });
        expect(readStoredViewerEntranceSettings()).toEqual({
            ...DEFAULT_VIEWER_ENTRANCE_SETTINGS,
            flashIntensityPercent: 30,
        });
    });

    it('removes the storage key when every value is back to its default', () => {
        writeStoredViewerEntranceSettings({ ...DEFAULT_VIEWER_ENTRANCE_SETTINGS, outlineWidthPx: 2 });
        writeStoredViewerEntranceSettings(DEFAULT_VIEWER_ENTRANCE_SETTINGS);

        expect(localStorage.getItem(VIEWER_ENTRANCE_STORAGE_KEY)).toBeNull();
    });

    it('ignores corrupt or out-of-type stored data and clamps out-of-range numbers', () => {
        localStorage.setItem(VIEWER_ENTRANCE_STORAGE_KEY, '{not json');
        expect(readStoredViewerEntranceSettings()).toEqual(DEFAULT_VIEWER_ENTRANCE_SETTINGS);

        localStorage.setItem(
            VIEWER_ENTRANCE_STORAGE_KEY,
            JSON.stringify({ outlineWidthPx: 'wide', outlineOpacityPercent: 500, flashIntensityPercent: null }),
        );
        expect(readStoredViewerEntranceSettings()).toEqual({
            ...DEFAULT_VIEWER_ENTRANCE_SETTINGS,
            outlineOpacityPercent: VIEWER_ENTRANCE_LIMITS.outlineOpacityPercent.max,
        });
    });

    it('sets a property only for overridden values and removes the ones back at default', () => {
        applyViewerEntranceSettingsToDocument({ ...DEFAULT_VIEWER_ENTRANCE_SETTINGS, outlineWidthPx: 2 }, root);

        expect(root.style.getPropertyValue('--viewer-entrance-outline-width')).toBe('2px');
        expect(root.style.getPropertyValue('--viewer-entrance-outline-opacity')).toBe('');
        expect(root.style.getPropertyValue('--viewer-entrance-flash-peak')).toBe('');

        applyViewerEntranceSettingsToDocument(DEFAULT_VIEWER_ENTRANCE_SETTINGS, root);

        expect(root.style.getPropertyValue('--viewer-entrance-outline-width')).toBe('');
    });

    it('re-applies the stored overrides at boot and leaves a fresh install untouched', () => {
        applyViewerEntranceOverrides();
        expect(root.style.getPropertyValue('--viewer-entrance-flash-peak')).toBe('');

        writeStoredViewerEntranceSettings({ ...DEFAULT_VIEWER_ENTRANCE_SETTINGS, flashIntensityPercent: 25 });
        applyViewerEntranceOverrides();

        expect(root.style.getPropertyValue('--viewer-entrance-flash-peak')).toBe('0.25');
    });
});
