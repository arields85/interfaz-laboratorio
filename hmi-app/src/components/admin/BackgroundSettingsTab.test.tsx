import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type ReactNode } from 'vitest';
import {
    SHADER_BLEND_DEFAULTS,
    SHADER_DEFAULTS,
    useShaderParamsStore,
} from '../../store/shaderParams.store';
import BackgroundSettingsTab from './BackgroundSettingsTab';

vi.mock('../ui/HoverTooltip', () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../ui/AnchoredOverlay', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
        isOpen ? <div>{children}</div> : null,
}));

function resetShaderStore() {
    act(() => {
        useShaderParamsStore.setState({
            params: { ...SHADER_DEFAULTS },
            blendModes: { ...SHADER_BLEND_DEFAULTS },
        });
    });
}

function getSection(title: string) {
    const heading = screen.getByText(title);
    const section = heading.closest('div.rounded-lg');

    if (!section) {
        throw new Error(`Could not find section container for ${title}`);
    }

    return section;
}

function expandSection(title: string) {
    fireEvent.click(screen.getByText(title));
    return getSection(title);
}

describe('BackgroundSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
        resetShaderStore();
    });

    afterEach(() => {
        resetShaderStore();
    });

    it('renders tone, saturation, brightness, contrast, intensity, and alpha first in exact order without blend controls', () => {
        render(<BackgroundSettingsTab />);

        const starsSection = expandSection('Stars');
        const toneSlider = within(starsSection).getByLabelText('Stars tone');
        const saturationSlider = within(starsSection).getByLabelText('Stars saturation');
        const brightnessSlider = within(starsSection).getByLabelText('Stars brightness');
        const contrastSlider = within(starsSection).getByLabelText('Stars contrast');
        const alphaSlider = within(starsSection).getByLabelText('Stars alpha');
        const densitySlider = within(starsSection).getByLabelText('Stars density');

        expect(toneSlider.compareDocumentPosition(saturationSlider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(saturationSlider.compareDocumentPosition(brightnessSlider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(brightnessSlider.compareDocumentPosition(contrastSlider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(contrastSlider.compareDocumentPosition(alphaSlider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(alphaSlider.compareDocumentPosition(densitySlider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        expect(within(starsSection).getAllByLabelText('Stars brightness')).toHaveLength(1);
        expect(within(starsSection).queryByLabelText('Stars intensity')).not.toBeInTheDocument();
        expect(within(starsSection).queryByText('Hue')).not.toBeInTheDocument();
        expect(within(starsSection).queryByText('Blend Mode')).not.toBeInTheDocument();
        expect(within(starsSection).queryByRole('button', { name: 'Normal' })).not.toBeInTheDocument();
    });

    it('writes saturation, brightness, and contrast first-position controls to the canonical params', () => {
        render(<BackgroundSettingsTab />);

        expandSection('Stars');
        expandSection('Nebula');

        fireEvent.change(screen.getByLabelText('Stars saturation'), {
            target: { value: '1.45' },
        });
        fireEvent.change(screen.getByLabelText('Stars brightness'), {
            target: { value: '1.25' },
        });
        fireEvent.change(screen.getByLabelText('Nebula contrast'), {
            target: { value: '0.85' },
        });

        expect(useShaderParamsStore.getState().params.starSaturation).toBeCloseTo(1.45);
        expect(useShaderParamsStore.getState().params.starBrightness).toBeCloseTo(1.25);
        expect(useShaderParamsStore.getState().params.nebContrast).toBeCloseTo(0.85);
    });

    it('preserves canonical slider metadata for aliased first-position controls', () => {
        render(<BackgroundSettingsTab />);

        expandSection('Gravitational Lensing');
        expandSection('Cursor Halo');
        expandSection('Click Ring');

        const lensingIntensity = screen.getByLabelText('Gravitational Lensing intensity');
        const haloIntensity = screen.getByLabelText('Cursor Halo intensity');
        const clickRingIntensity = screen.getByLabelText('Click Ring intensity');

        expect(lensingIntensity).toHaveAttribute('min', '0.01');
        expect(lensingIntensity).toHaveAttribute('max', '0.3');
        expect(lensingIntensity).toHaveAttribute('step', '0.005');

        expect(haloIntensity).toHaveAttribute('min', '0');
        expect(haloIntensity).toHaveAttribute('max', '0.5');
        expect(haloIntensity).toHaveAttribute('step', '0.01');

        expect(clickRingIntensity).toHaveAttribute('min', '0');
        expect(clickRingIntensity).toHaveAttribute('max', '3');
        expect(clickRingIntensity).toHaveAttribute('step', '0.05');
    });

    it('omits unsupported first-position placeholders instead of rendering disabled messaging', () => {
        render(<BackgroundSettingsTab />);

        const lensingSection = expandSection('Gravitational Lensing');

        expect(within(lensingSection).queryByText('Tone')).not.toBeInTheDocument();
        expect(within(lensingSection).queryByText('Saturation')).not.toBeInTheDocument();
        expect(within(lensingSection).queryByText('Brightness')).not.toBeInTheDocument();
        expect(within(lensingSection).queryByText('Contrast')).not.toBeInTheDocument();
        expect(within(lensingSection).queryByText('Blend Mode')).not.toBeInTheDocument();
        expect(within(lensingSection).queryByText(/no tint channel/i)).not.toBeInTheDocument();
        expect(within(lensingSection).queryByText(/instead of blending a color layer/i)).not.toBeInTheDocument();
        expect(within(lensingSection).queryByLabelText('Gravitational Lensing tone')).not.toBeInTheDocument();
        expect(within(lensingSection).getByLabelText('Gravitational Lensing intensity')).toBeInTheDocument();
        expect(within(lensingSection).getByLabelText('Gravitational Lensing alpha')).toBeInTheDocument();

        const vignetteSection = expandSection('Vignette');
        expect(within(vignetteSection).queryByText('Tone')).not.toBeInTheDocument();
        expect(within(vignetteSection).queryByText('Intensity')).not.toBeInTheDocument();
        expect(within(vignetteSection).queryByText('Alpha')).not.toBeInTheDocument();
        expect(within(vignetteSection).queryByText('Blend Mode')).not.toBeInTheDocument();
    });

    it('removes blend-mode controls from color-emitting sections', () => {
        render(<BackgroundSettingsTab />);

        const nebulaSection = expandSection('Nebula');
        expect(within(nebulaSection).queryByText('Blend Mode')).not.toBeInTheDocument();
        expect(within(nebulaSection).queryByRole('button', { name: 'Normal' })).not.toBeInTheDocument();
    });

    it('starts with all sections collapsed by default', () => {
        render(<BackgroundSettingsTab />);

        expect(screen.queryByLabelText('Stars tone')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Nebula tone')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Gravitational Lensing intensity')).not.toBeInTheDocument();
    });
});
