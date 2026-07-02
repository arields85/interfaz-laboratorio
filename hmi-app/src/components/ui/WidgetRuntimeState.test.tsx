import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WidgetRuntimeState from './WidgetRuntimeState';

describe('WidgetRuntimeState', () => {
    it('renders the canonical loading copy with the shared blinking cursor and no placeholder glyph', () => {
        render(<WidgetRuntimeState state="loading" testId="runtime-state" />);

        const state = screen.getByTestId('runtime-state');

        expect(state).toHaveTextContent('Cargando_');
        expect(state.querySelector('.font-system')).toHaveTextContent('Cargando_');
        expect(state.querySelector('.widget-runtime-state-caret')).toHaveTextContent('_');
        expect(state.querySelector('.widget-runtime-state-caret')).toBeInTheDocument();
        expect(state.querySelector('.font-system')).not.toHaveClass('animate-pulse');
        expect(state).not.toHaveTextContent('--');
    });

    it('renders comparable empty copy with the shared typography wrapper and no placeholder glyph', () => {
        render(<WidgetRuntimeState state="empty-comparable" testId="runtime-state" />);

        const state = screen.getByTestId('runtime-state');

        expect(state).toHaveTextContent('Sin datos comparables');
        expect(state).not.toHaveTextContent('--');
        expect(state.querySelector('.widget-runtime-state-caret')).toBeNull();
        expect(state.querySelector('.font-system')).toHaveTextContent('Sin datos comparables');
    });

    it('allows overriding the one-line legend without changing the shared typography or loading behavior', () => {
        render(<WidgetRuntimeState state="error" labelOverride="Seleccione una máquina válida" testId="runtime-state" />);

        const state = screen.getByTestId('runtime-state');

        expect(state).toHaveTextContent('Seleccione una máquina válida');
        expect(state.querySelector('.font-system')).toHaveTextContent('Seleccione una máquina válida');
        expect(state.querySelector('.widget-runtime-state-caret')).toBeNull();
    });
});
