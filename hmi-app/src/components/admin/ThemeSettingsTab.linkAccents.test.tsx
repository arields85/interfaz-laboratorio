import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeSettingsTab from './ThemeSettingsTab';
import { resetThemeStyleOnDocument } from '../../services/themeStyle.service';
import { resetViewerEntranceSettingsOnDocument } from '../../services/viewerEntranceStyle.service';
import { resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { resetIconCutoutOnDocument } from '../../services/iconCutout.service';
import {
    getActiveLinkCornerAccents,
    LINK_CORNER_ACCENTS_STORAGE_KEY,
    previewLinkCornerAccents,
    resetLinkCornerAccentsOnDocument,
    writeStoredLinkCornerAccents,
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
});
