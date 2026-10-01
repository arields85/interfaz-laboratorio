import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeSettingsTab from './ThemeSettingsTab';
import { CLASSIC_THEME_STYLE_ID, getThemeStylePreset, resetThemeStyleOnDocument } from '../../services/themeStyle.service';
import { resetViewerEntranceSettingsOnDocument } from '../../services/viewerEntranceStyle.service';
import { resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { resetIconCutoutOnDocument } from '../../services/iconCutout.service';
import {
    getActiveLinkCornerAccents,
    LINK_CORNER_ACCENTS_STORAGE_KEY,
    previewLinkCornerAccents,
    resetLinkCornerAccentsOnDocument,
    writeStoredLinkCornerAccents,
    LINK_ACCENT_GEOMETRY_STORAGE_KEY,
    LINK_ACCENT_LENGTHS_STORAGE_KEY,
    resetLinkAccentGeometryOnDocument,
    resetLinkAccentLengthsOnDocument,
    writeStoredLinkAccentGeometry,
    writeStoredLinkAccentLengths,
} from '../../services/linkCornerAccents.service';

function createRef<T>(): { current: T | null } {
    return { current: null };
}

describe('ThemeSettingsTab - Esquinas en widgets con enlace', () => {
    const reset = () => {
        localStorage.clear();
        resetThemeStyleOnDocument(document.documentElement);
        resetViewerEntranceSettingsOnDocument(document.documentElement);
        resetFrameShapeOnDocument(document.documentElement);
        resetIconCutoutOnDocument();
        resetLinkCornerAccentsOnDocument();
        resetLinkAccentLengthsOnDocument();
        resetLinkAccentGeometryOnDocument();
    };

    beforeEach(reset);
    afterEach(reset);

    const accentsSwitch = () => screen.getByRole('checkbox', { name: 'Esquinas en widgets con enlace' });
    const accentsSection = () => accentsSwitch().closest('section') as HTMLElement;

    it('renders an off switch with usted-register copy, below the icon cutout section', () => {
        render(<ThemeSettingsTab />);

        expect(accentsSwitch()).not.toBeChecked();
        expect(accentsSection().textContent ?? '').toMatch(/enlace/i);
        expect(accentsSection().textContent ?? '').not.toMatch(/\btu\b|\bvos\b|\btuyo\b/i);
        const cutout = screen.getByRole('checkbox', { name: 'Calado del ícono' }).closest('section') as HTMLElement;
        expect(cutout.compareDocumentPosition(accentsSection()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('does not touch storage on a fresh install', () => {
        render(<ThemeSettingsTab />);

        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBeNull();
    });

    it('starts from the persisted value', () => {
        writeStoredLinkCornerAccents(true);

        render(<ThemeSettingsTab />);

        expect(accentsSwitch()).toBeChecked();
    });

    it('previews on the whole app and marks the tab dirty, without persisting', async () => {
        const user = userEvent.setup();
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();

        render(<ThemeSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} />);

        await user.click(accentsSwitch());

        expect(getActiveLinkCornerAccents()).toBe(true);
        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBeNull();
        expect(onDirtyChange).toHaveBeenCalledWith(true);
        expect(onSaveStatusChange).toHaveBeenCalledWith('dirty');
        expect(accentsSwitch()).toBeChecked();
    });

    it('persists the override on save and clears dirty; saving it off again removes the key', async () => {
        const user = userEvent.setup();
        const saveRef = createRef<() => void>();
        const onDirtyChange = vi.fn();

        render(<ThemeSettingsTab saveRef={saveRef} onDirtyChange={onDirtyChange} />);

        await user.click(accentsSwitch());
        act(() => {
            saveRef.current?.();
        });
        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBe('true');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);

        await user.click(accentsSwitch());
        act(() => {
            saveRef.current?.();
        });
        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBeNull();
        expect(getActiveLinkCornerAccents()).toBe(false);
    });

    it('restores the saved value on revert without persisting', async () => {
        const user = userEvent.setup();
        const revertRef = createRef<() => void>();
        const onDirtyChange = vi.fn();

        render(<ThemeSettingsTab revertRef={revertRef} onDirtyChange={onDirtyChange} />);

        await user.click(accentsSwitch());
        act(() => {
            revertRef.current?.();
        });

        expect(getActiveLinkCornerAccents()).toBe(false);
        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBeNull();
        expect(accentsSwitch()).not.toBeChecked();
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('clears dirty when the switch returns to the saved value', async () => {
        const user = userEvent.setup();
        const onDirtyChange = vi.fn();

        render(<ThemeSettingsTab onDirtyChange={onDirtyChange} />);

        await user.click(accentsSwitch());
        await user.click(accentsSwitch());

        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('restores the saved value on the whole app when the tab unmounts with an unsaved preview', async () => {
        const user = userEvent.setup();

        const { unmount } = render(<ThemeSettingsTab />);

        await user.click(accentsSwitch());
        expect(getActiveLinkCornerAccents()).toBe(true);
        unmount();

        expect(getActiveLinkCornerAccents()).toBe(false);
    });

    it('says nothing is in the way with Clásico, and keeps the switch usable', () => {
        previewLinkCornerAccents(true);
        render(<ThemeSettingsTab />);

        expect(accentsSection().textContent ?? '').not.toMatch(/ahora no se aplica/i);
        expect(accentsSwitch()).toBeEnabled();
    });

    it('notes that it does not apply with another theme, without hiding the switch', async () => {
        const user = userEvent.setup();
        render(<ThemeSettingsTab />);

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));

        expect(accentsSection().textContent ?? '').toMatch(/ahora no se aplica/i);
        expect(accentsSection().textContent ?? '').toMatch(/Clásico/);
        expect(accentsSwitch()).toBeEnabled();
    });

    it('still applies with the Pestaña frame shape', async () => {
        const user = userEvent.setup();
        render(<ThemeSettingsTab />);

        await user.click(screen.getByRole('radio', { name: /Pestaña/ }));

        expect(accentsSection().textContent ?? '').not.toMatch(/ahora no se aplica/i);
    });

    describe('lengths', () => {
        const restSlider = () => screen.getByRole('slider', { name: 'Largo en reposo' });
        const hoverSlider = () => screen.getByRole('slider', { name: 'Largo con el cursor' });
        const rootValue = (name: string) => document.documentElement.style.getPropertyValue(name);

        it('renders both sliders inside the section with the default values and a usted-register hint', () => {
            render(<ThemeSettingsTab />);

            expect(accentsSection().contains(restSlider())).toBe(true);
            expect(accentsSection().contains(hoverSlider())).toBe(true);
            expect(restSlider()).toHaveValue('30');
            expect(hoverSlider()).toHaveValue('22');
            expect(accentsSection().textContent ?? '').toMatch(/cuánto de la esquina se ve, desde el centro del arco; 0 = nada/i);
            expect(accentsSection().textContent ?? '').not.toMatch(/\btu\b|\bvos\b|\btuyo\b/i);
        });

        it('starts from the persisted overrides', () => {
            writeStoredLinkAccentLengths({ restPx: 30, hoverPx: 4 });

            render(<ThemeSettingsTab />);

            expect(restSlider()).toHaveValue('30');
            expect(hoverSlider()).toHaveValue('4');
        });

        it('stays visible but disabled while the switch is off, and enabled once it is on', async () => {
            const user = userEvent.setup();
            render(<ThemeSettingsTab />);

            expect(restSlider()).toBeDisabled();
            expect(hoverSlider()).toBeDisabled();

            await user.click(accentsSwitch());

            expect(restSlider()).toBeEnabled();
            expect(hoverSlider()).toBeEnabled();
        });

        it('previews live on the document root while dragging and marks the tab dirty, without persisting', () => {
            writeStoredLinkCornerAccents(true);
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab onDirtyChange={onDirtyChange} />);

            fireEvent.change(restSlider(), { target: { value: '25' } });

            expect(rootValue('--link-accent-length-rest')).toBe('25px');
            expect(onDirtyChange).toHaveBeenCalledWith(true);
            expect(localStorage.getItem(LINK_ACCENT_LENGTHS_STORAGE_KEY)).toBeNull();
        });

        it('persists only the overrides on save and clears dirty', () => {
            writeStoredLinkCornerAccents(true);
            const saveRef = createRef<() => void>();
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab saveRef={saveRef} onDirtyChange={onDirtyChange} />);

            fireEvent.change(hoverSlider(), { target: { value: '12' } });
            act(() => {
                saveRef.current?.();
            });

            expect(JSON.parse(localStorage.getItem(LINK_ACCENT_LENGTHS_STORAGE_KEY) ?? '')).toEqual({ hoverPx: 12 });
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });

        it('restores the saved lengths on revert without persisting', () => {
            writeStoredLinkCornerAccents(true);
            const revertRef = createRef<() => void>();
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab revertRef={revertRef} onDirtyChange={onDirtyChange} />);

            fireEvent.change(restSlider(), { target: { value: '25' } });
            act(() => {
                revertRef.current?.();
            });

            expect(restSlider()).toHaveValue('30');
            expect(rootValue('--link-accent-length-rest')).toBe('');
            expect(localStorage.getItem(LINK_ACCENT_LENGTHS_STORAGE_KEY)).toBeNull();
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });

        it('clears dirty when a slider returns to the saved value', () => {
            writeStoredLinkCornerAccents(true);
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab onDirtyChange={onDirtyChange} />);

            fireEvent.change(restSlider(), { target: { value: '25' } });
            fireEvent.change(restSlider(), { target: { value: '30' } });

            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });

        it('restores the saved lengths on the document when the tab unmounts with an unsaved preview', () => {
            writeStoredLinkCornerAccents(true);
            const { unmount } = render(<ThemeSettingsTab />);

            fireEvent.change(restSlider(), { target: { value: '25' } });
            expect(rootValue('--link-accent-length-rest')).toBe('25px');
            unmount();

            expect(rootValue('--link-accent-length-rest')).toBe('');
        });
    });

    describe('distance and radius', () => {
        const distanceSlider = () => screen.getByRole('slider', { name: 'Distancia al marco' });
        const radiusSlider = () => screen.getByRole('slider', { name: 'Radio de las esquinas' });
        const resetButton = () => within(accentsSection()).getByRole('button', { name: 'Restablecer' });
        const rootValue = (name: string) => document.documentElement.style.getPropertyValue(name);
        const frameRadius = getThemeStylePreset(CLASSIC_THEME_STYLE_ID).frame.rest.radiusPx;

        it('renders both sliders inside the section, disabled while the switch is off', async () => {
            const user = userEvent.setup();
            render(<ThemeSettingsTab />);

            expect(accentsSection().contains(distanceSlider())).toBe(true);
            expect(accentsSection().contains(radiusSlider())).toBe(true);
            expect(distanceSlider()).toBeDisabled();
            expect(radiusSlider()).toBeDisabled();
            expect(resetButton()).toBeDisabled();

            await user.click(accentsSwitch());

            expect(distanceSlider()).toBeEnabled();
            expect(radiusSlider()).toBeEnabled();
        });

        it('shows the default distance and, in automatic mode, the frame radius plus the distance', () => {
            writeStoredLinkCornerAccents(true);
            render(<ThemeSettingsTab />);

            expect(distanceSlider()).toHaveValue('4');
            expect(radiusSlider()).toHaveValue(String(Math.min(48, frameRadius + 4)));
            expect(resetButton()).toBeDisabled();
        });

        it('starts from the persisted overrides', () => {
            writeStoredLinkCornerAccents(true);
            writeStoredLinkAccentGeometry({ offsetPx: 9, radiusPx: 20 });

            render(<ThemeSettingsTab />);

            expect(distanceSlider()).toHaveValue('9');
            expect(radiusSlider()).toHaveValue('20');
            expect(resetButton()).toBeEnabled();
        });

        it('previews the distance live on the root, keeping the radius automatic', () => {
            writeStoredLinkCornerAccents(true);
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab onDirtyChange={onDirtyChange} />);

            fireEvent.change(distanceSlider(), { target: { value: '10' } });

            expect(rootValue('--link-accent-offset')).toBe('10px');
            expect(rootValue('--link-accent-radius')).toBe('');
            expect(radiusSlider()).toHaveValue(String(Math.min(48, frameRadius + 10)));
            expect(onDirtyChange).toHaveBeenCalledWith(true);
            expect(localStorage.getItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY)).toBeNull();
        });

        it('sets an absolute radius live and Restablecer returns to automatic', () => {
            writeStoredLinkCornerAccents(true);
            render(<ThemeSettingsTab />);

            fireEvent.change(radiusSlider(), { target: { value: '30' } });
            expect(rootValue('--link-accent-radius')).toBe('30px');
            expect(resetButton()).toBeEnabled();

            fireEvent.click(resetButton());
            expect(rootValue('--link-accent-radius')).toBe('');
            expect(resetButton()).toBeDisabled();
        });

        it('persists only the overrides on save and clears dirty', () => {
            writeStoredLinkCornerAccents(true);
            const saveRef = createRef<() => void>();
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab saveRef={saveRef} onDirtyChange={onDirtyChange} />);

            fireEvent.change(radiusSlider(), { target: { value: '30' } });
            act(() => {
                saveRef.current?.();
            });

            expect(JSON.parse(localStorage.getItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY) ?? '')).toEqual({ radiusPx: 30 });
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });

        it('restores the saved geometry on revert without persisting', () => {
            writeStoredLinkCornerAccents(true);
            const revertRef = createRef<() => void>();
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab revertRef={revertRef} onDirtyChange={onDirtyChange} />);

            fireEvent.change(distanceSlider(), { target: { value: '10' } });
            fireEvent.change(radiusSlider(), { target: { value: '30' } });
            act(() => {
                revertRef.current?.();
            });

            expect(distanceSlider()).toHaveValue('4');
            expect(rootValue('--link-accent-offset')).toBe('');
            expect(rootValue('--link-accent-radius')).toBe('');
            expect(localStorage.getItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY)).toBeNull();
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });

        it('clears dirty when the distance returns to the saved value', () => {
            writeStoredLinkCornerAccents(true);
            const onDirtyChange = vi.fn();
            render(<ThemeSettingsTab onDirtyChange={onDirtyChange} />);

            fireEvent.change(distanceSlider(), { target: { value: '10' } });
            fireEvent.change(distanceSlider(), { target: { value: '4' } });

            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });

        it('restores the saved geometry on the document when the tab unmounts with an unsaved preview', () => {
            writeStoredLinkCornerAccents(true);
            const { unmount } = render(<ThemeSettingsTab />);

            fireEvent.change(distanceSlider(), { target: { value: '10' } });
            fireEvent.change(radiusSlider(), { target: { value: '30' } });
            unmount();

            expect(rootValue('--link-accent-offset')).toBe('');
            expect(rootValue('--link-accent-radius')).toBe('');
        });
    });
});
