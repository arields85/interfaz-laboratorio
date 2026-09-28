import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeSettingsTab from './ThemeSettingsTab';
import {
    OUTLINE_THEME_STYLE_ID,
    resetThemeStyleOnDocument,
    THEME_STYLE_STORAGE_KEY,
    writeStoredThemeStylePresetId,
} from '../../services/themeStyle.service';

function createRef<T>(): { current: T | null } {
    return { current: null };
}

describe('ThemeSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
        resetThemeStyleOnDocument(document.documentElement);
    });

    afterEach(() => {
        resetThemeStyleOnDocument(document.documentElement);
        localStorage.clear();
    });

    it('renders a radiogroup with both built-in presets, Clasico selected by default', () => {
        render(<ThemeSettingsTab />);

        const group = screen.getByRole('radiogroup', { name: /tema/i });
        const classicOption = screen.getByRole('radio', { name: /Clásico/ });
        const outlineOption = screen.getByRole('radio', { name: /Contorno/ });

        expect(group).toBeInTheDocument();
        expect(classicOption).toHaveAttribute('aria-checked', 'true');
        expect(outlineOption).toHaveAttribute('aria-checked', 'false');
    });

    it('shows a Spanish, usted-register one-line description for each preset', () => {
        render(<ThemeSettingsTab />);

        expect(screen.getByText(/efecto vidrio y brillo suave/i)).toBeInTheDocument();
        expect(screen.getByText(/bordes finos y relleno transparente/i)).toBeInTheDocument();
        // usted register: no "tu"/"vos" second-person forms in the visible copy.
        const region = screen.getByRole('radiogroup', { name: /tema/i });
        expect(region.textContent).not.toMatch(/\btu\b|\bvos\b|\btuyo\b/i);
    });

    it('starts from the persisted preset when one was already saved', () => {
        writeStoredThemeStylePresetId(OUTLINE_THEME_STYLE_ID);

        render(<ThemeSettingsTab />);

        expect(screen.getByRole('radio', { name: /Contorno/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: /Clásico/ })).toHaveAttribute('aria-checked', 'false');
    });

    it('gives each preset card its own scoped live preview, independent of the other card', () => {
        render(<ThemeSettingsTab />);

        const classicOption = screen.getByRole('radio', { name: /Clásico/ });
        const outlineOption = screen.getByRole('radio', { name: /Contorno/ });

        expect(classicOption.style.getPropertyValue('--frame-radius-rest')).toBe('24px');
        expect(outlineOption.style.getPropertyValue('--frame-radius-rest')).toBe('0px');
    });

    it('previews the selected theme on the whole app immediately and marks the tab dirty', async () => {
        const user = userEvent.setup();
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();

        render(<ThemeSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} />);

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('0px');
        expect(onDirtyChange).toHaveBeenCalledWith(true);
        expect(onSaveStatusChange).toHaveBeenCalledWith('dirty');
        expect(screen.getByRole('radio', { name: /Contorno/ })).toHaveAttribute('aria-checked', 'true');
    });

    it('persists the selected preset through the service on save', async () => {
        const user = userEvent.setup();
        const saveRef = createRef<() => void>();
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();

        render(
            <ThemeSettingsTab
                saveRef={saveRef}
                onDirtyChange={onDirtyChange}
                onSaveStatusChange={onSaveStatusChange}
            />,
        );

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));
        act(() => {
            saveRef.current?.();
        });

        expect(localStorage.getItem(THEME_STYLE_STORAGE_KEY)).toBe(OUTLINE_THEME_STYLE_ID);
        expect(onSaveStatusChange).toHaveBeenCalledWith('saved');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('restores the previously saved theme on revert without persisting anything new', async () => {
        const user = userEvent.setup();
        const revertRef = createRef<() => void>();
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();

        render(
            <ThemeSettingsTab
                revertRef={revertRef}
                onDirtyChange={onDirtyChange}
                onSaveStatusChange={onSaveStatusChange}
            />,
        );

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('0px');

        act(() => {
            revertRef.current?.();
        });

        expect(screen.getByRole('radio', { name: /Clásico/ })).toHaveAttribute('aria-checked', 'true');
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');
        expect(localStorage.getItem(THEME_STYLE_STORAGE_KEY)).toBeNull();
        expect(onSaveStatusChange).toHaveBeenLastCalledWith(null);
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('reverts back to the persisted non-default preset, not always to Clasico', async () => {
        const user = userEvent.setup();
        writeStoredThemeStylePresetId(OUTLINE_THEME_STYLE_ID);
        const revertRef = createRef<() => void>();

        render(<ThemeSettingsTab revertRef={revertRef} />);

        await user.click(screen.getByRole('radio', { name: /Clásico/ }));
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');

        act(() => {
            revertRef.current?.();
        });

        expect(screen.getByRole('radio', { name: /Contorno/ })).toHaveAttribute('aria-checked', 'true');
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('0px');
    });

    it('clears dirty and the save status when the selection returns to the saved theme', async () => {
        const user = userEvent.setup();
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();

        render(<ThemeSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} />);

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');

        await user.click(screen.getByRole('radio', { name: /Clásico/ }));

        expect(screen.getByRole('radio', { name: /Clásico/ })).toHaveAttribute('aria-checked', 'true');
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');
        // Nothing was persisted by clicking back to the saved theme, so the
        // status is a plain not-dirty clear, not a claimed `Guardado`.
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(onSaveStatusChange).toHaveBeenLastCalledWith(null);
    });

    it('restores the saved theme on the whole app when the tab unmounts with an unsaved preview', async () => {
        const user = userEvent.setup();

        const { unmount } = render(<ThemeSettingsTab />);

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('0px');

        unmount();

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');
    });

    it('does not reapply the saved theme on unmount after an explicit save (no double-apply)', async () => {
        const user = userEvent.setup();
        const saveRef = createRef<() => void>();

        const { unmount } = render(<ThemeSettingsTab saveRef={saveRef} />);

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));
        act(() => {
            saveRef.current?.();
        });
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('0px');

        unmount();

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('0px');
    });

    it('does not reapply anything on unmount after an explicit revert (no double-apply)', async () => {
        const user = userEvent.setup();
        const revertRef = createRef<() => void>();

        const { unmount } = render(<ThemeSettingsTab revertRef={revertRef} />);

        await user.click(screen.getByRole('radio', { name: /Contorno/ }));
        act(() => {
            revertRef.current?.();
        });
        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');

        unmount();

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');
    });

    it('does not put a Tailwind transition utility on the mini-preview span, which would override the merged .theme-button transition', () => {
        render(<ThemeSettingsTab />);

        const previewSpans = screen.getAllByText('Vista previa');
        expect(previewSpans.length).toBeGreaterThan(0);

        for (const previewSpan of previewSpans) {
            expect(previewSpan).toHaveClass('theme-button', 'admin-accent-ghost');

            for (const token of previewSpan.className.split(/\s+/)) {
                expect(token === 'transition' || token.startsWith('transition-')).toBe(false);
            }
        }
    });

    it('is keyboard accessible: each option is a real button reachable and activatable from the keyboard', async () => {
        const user = userEvent.setup();
        const onDirtyChange = vi.fn();

        render(<ThemeSettingsTab onDirtyChange={onDirtyChange} />);

        const outlineOption = screen.getByRole('radio', { name: /Contorno/ });
        outlineOption.focus();
        expect(outlineOption).toHaveFocus();

        await user.keyboard('{Enter}');

        expect(onDirtyChange).toHaveBeenCalledWith(true);
        expect(outlineOption).toHaveAttribute('aria-checked', 'true');
    });
});
