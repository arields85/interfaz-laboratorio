import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeSettingsTab from './ThemeSettingsTab';
import {
    INSTRUMENT_THEME_STYLE_ID,
    OUTLINE_THEME_STYLE_ID,
    resetThemeStyleOnDocument,
    THEME_STYLE_STORAGE_KEY,
    writeStoredThemeStylePresetId,
} from '../../services/themeStyle.service';
import {
    DEFAULT_VIEWER_ENTRANCE_SETTINGS,
    resetViewerEntranceSettingsOnDocument,
    VIEWER_ENTRANCE_STORAGE_KEY,
    writeStoredViewerEntranceSettings,
} from '../../services/viewerEntranceStyle.service';

function createRef<T>(): { current: T | null } {
    return { current: null };
}

describe('ThemeSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
        resetThemeStyleOnDocument(document.documentElement);
        resetViewerEntranceSettingsOnDocument(document.documentElement);
    });

    afterEach(() => {
        resetThemeStyleOnDocument(document.documentElement);
        resetViewerEntranceSettingsOnDocument(document.documentElement);
        localStorage.clear();
    });

    it('renders a radiogroup with all three built-in presets, Clasico selected by default', () => {
        render(<ThemeSettingsTab />);

        const group = screen.getByRole('radiogroup', { name: /tema/i });
        const classicOption = screen.getByRole('radio', { name: /Clásico/ });
        const outlineOption = screen.getByRole('radio', { name: /Contorno/ });
        const instrumentOption = screen.getByRole('radio', { name: /Instrumento/ });

        expect(group).toBeInTheDocument();
        expect(screen.getAllByRole('radio')).toHaveLength(3);
        expect(classicOption).toHaveAttribute('aria-checked', 'true');
        expect(outlineOption).toHaveAttribute('aria-checked', 'false');
        expect(instrumentOption).toHaveAttribute('aria-checked', 'false');
    });

    it('shows a Spanish, usted-register one-line description for each preset', () => {
        render(<ThemeSettingsTab />);

        expect(screen.getByText(/efecto vidrio y brillo suave/i)).toBeInTheDocument();
        expect(screen.getByText(/bordes finos y relleno transparente/i)).toBeInTheDocument();
        expect(screen.getByText(/vidrio sobrio con esquinas apenas redondeadas/i)).toBeInTheDocument();
        // usted register: no "tu"/"vos" second-person forms in the visible copy.
        const region = screen.getByRole('radiogroup', { name: /tema/i });
        expect(region.textContent).not.toMatch(/\btu\b|\bvos\b|\btuyo\b/i);
    });

    it('selects and previews the Instrumento preset', async () => {
        const user = userEvent.setup();

        render(<ThemeSettingsTab />);

        await user.click(screen.getByRole('radio', { name: /Instrumento/ }));

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('3px');
        expect(document.documentElement.style.getPropertyValue('--tag-tint')).toBe('14%');
        expect(screen.getByRole('radio', { name: /Instrumento/ })).toHaveAttribute('aria-checked', 'true');
    });

    it('starts from the persisted Instrumento preset when it was already saved', () => {
        writeStoredThemeStylePresetId(INSTRUMENT_THEME_STYLE_ID);

        render(<ThemeSettingsTab />);

        expect(screen.getByRole('radio', { name: /Instrumento/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: /Clásico/ })).toHaveAttribute('aria-checked', 'false');
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

    describe('Animación de entrada', () => {
        const rootStyle = () => document.documentElement.style;

        it('renders the section with three sliders, their ranges, units and current default values', () => {
            render(<ThemeSettingsTab />);

            expect(screen.getByText('Animación de entrada')).toBeInTheDocument();

            const width = screen.getByRole('slider', { name: 'Grosor del contorno' });
            expect(width).toHaveAttribute('min', '0.5');
            expect(width).toHaveAttribute('max', '3');
            expect(width).toHaveAttribute('step', '0.25');
            expect(width).toHaveValue('1');
            expect(screen.getByRole('textbox', { name: 'Valor de grosor del contorno' })).toHaveValue('1');

            const opacity = screen.getByRole('slider', { name: 'Opacidad del contorno' });
            expect(opacity).toHaveAttribute('min', '0');
            expect(opacity).toHaveAttribute('max', '100');
            expect(opacity).toHaveAttribute('step', '5');
            expect(opacity).toHaveValue('100');

            const flash = screen.getByRole('slider', { name: 'Intensidad del destello' });
            expect(flash).toHaveAttribute('min', '0');
            expect(flash).toHaveAttribute('max', '50');
            expect(flash).toHaveAttribute('step', '1');
            expect(flash).toHaveValue('16');

            expect(screen.getByText('px')).toBeInTheDocument();
            expect(screen.getAllByText('%')).toHaveLength(2);
        });

        it('does not touch the document or storage when nothing changes (fresh install)', () => {
            render(<ThemeSettingsTab />);

            expect(rootStyle().getPropertyValue('--viewer-entrance-outline-width')).toBe('');
            expect(rootStyle().getPropertyValue('--viewer-entrance-outline-opacity')).toBe('');
            expect(rootStyle().getPropertyValue('--viewer-entrance-flash-peak')).toBe('');
            expect(localStorage.getItem(VIEWER_ENTRANCE_STORAGE_KEY)).toBeNull();
        });

        it('starts from the stored overrides', () => {
            writeStoredViewerEntranceSettings({ ...DEFAULT_VIEWER_ENTRANCE_SETTINGS, flashIntensityPercent: 30 });

            render(<ThemeSettingsTab />);

            expect(screen.getByRole('slider', { name: 'Intensidad del destello' })).toHaveValue('30');
        });

        it('marks the tab dirty and previews the custom property while a slider moves', () => {
            const onDirtyChange = vi.fn();
            const onSaveStatusChange = vi.fn();

            render(<ThemeSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} />);

            fireEvent.change(screen.getByRole('slider', { name: 'Grosor del contorno' }), { target: { value: '2' } });

            expect(rootStyle().getPropertyValue('--viewer-entrance-outline-width')).toBe('2px');
            expect(onDirtyChange).toHaveBeenLastCalledWith(true);
            expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');
            expect(localStorage.getItem(VIEWER_ENTRANCE_STORAGE_KEY)).toBeNull();
        });

        it('previews opacity and flash as unit-less fractions', () => {
            render(<ThemeSettingsTab />);

            fireEvent.change(screen.getByRole('slider', { name: 'Opacidad del contorno' }), { target: { value: '55' } });
            fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del destello' }), { target: { value: '40' } });

            expect(rootStyle().getPropertyValue('--viewer-entrance-outline-opacity')).toBe('0.55');
            expect(rootStyle().getPropertyValue('--viewer-entrance-flash-peak')).toBe('0.4');
        });

        it('clears dirty when the value returns to the saved one', () => {
            const onDirtyChange = vi.fn();
            const onSaveStatusChange = vi.fn();

            render(<ThemeSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} />);
            const flash = screen.getByRole('slider', { name: 'Intensidad del destello' });

            fireEvent.change(flash, { target: { value: '20' } });
            fireEvent.change(flash, { target: { value: '16' } });

            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
            expect(onSaveStatusChange).toHaveBeenLastCalledWith(null);
            expect(rootStyle().getPropertyValue('--viewer-entrance-flash-peak')).toBe('');
        });

        it('persists only the overrides on save and reports saved', () => {
            const saveRef = createRef<() => void>();
            const onDirtyChange = vi.fn();
            const onSaveStatusChange = vi.fn();

            render(
                <ThemeSettingsTab saveRef={saveRef} onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} />,
            );

            fireEvent.change(screen.getByRole('slider', { name: 'Opacidad del contorno' }), { target: { value: '70' } });
            act(() => {
                saveRef.current?.();
            });

            expect(JSON.parse(localStorage.getItem(VIEWER_ENTRANCE_STORAGE_KEY) ?? 'null')).toEqual({
                outlineOpacityPercent: 70,
            });
            expect(rootStyle().getPropertyValue('--viewer-entrance-outline-opacity')).toBe('0.7');
            expect(onSaveStatusChange).toHaveBeenCalledWith('saved');
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });

        it('is global: changing only a slider does not alter the selected preset', () => {
            const saveRef = createRef<() => void>();

            render(<ThemeSettingsTab saveRef={saveRef} />);

            fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del destello' }), { target: { value: '5' } });
            act(() => {
                saveRef.current?.();
            });

            expect(screen.getByRole('radio', { name: /Clásico/ })).toHaveAttribute('aria-checked', 'true');
            expect(localStorage.getItem(THEME_STYLE_STORAGE_KEY)).toBe('classic');
        });

        it('restores the saved values on revert without persisting anything', () => {
            const revertRef = createRef<() => void>();
            const onDirtyChange = vi.fn();
            writeStoredViewerEntranceSettings({ ...DEFAULT_VIEWER_ENTRANCE_SETTINGS, outlineWidthPx: 2 });

            render(<ThemeSettingsTab revertRef={revertRef} onDirtyChange={onDirtyChange} />);
            const width = screen.getByRole('slider', { name: 'Grosor del contorno' });

            fireEvent.change(width, { target: { value: '3' } });
            act(() => {
                revertRef.current?.();
            });

            expect(width).toHaveValue('2');
            expect(rootStyle().getPropertyValue('--viewer-entrance-outline-width')).toBe('2px');
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
            expect(JSON.parse(localStorage.getItem(VIEWER_ENTRANCE_STORAGE_KEY) ?? 'null')).toEqual({ outlineWidthPx: 2 });
        });

        it('restores the saved values on the document when the tab unmounts with an unsaved preview', () => {
            const { unmount } = render(<ThemeSettingsTab />);

            fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del destello' }), { target: { value: '45' } });
            expect(rootStyle().getPropertyValue('--viewer-entrance-flash-peak')).toBe('0.45');

            unmount();

            expect(rootStyle().getPropertyValue('--viewer-entrance-flash-peak')).toBe('');
        });

        it('explains the preview in the usted register', () => {
            render(<ThemeSettingsTab />);

            const hint = screen.getByText(/cambie de dashboard/i);
            expect(hint.textContent).not.toMatch(/\btu\b|\bvos\b|\bpodés\b|\bcambiá\b/i);
        });
    });
});
