import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TextTitleWidgetConfig } from '../../domain/admin.types';
import TextTitleWidget, { DEFAULT_TEXT_TITLE_FONT_SIZE } from './TextTitleWidget';

function makeWidget(overrides?: Partial<TextTitleWidgetConfig>): TextTitleWidgetConfig {
    return {
        id: 'text-title-1',
        type: 'text-title',
        title: 'Producción Línea A',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 2 },
        displayOptions: {},
        ...overrides,
    };
}

describe('TextTitleWidget', () => {
    it('renders text-only content with the default dashboard title typography', () => {
        const { container } = render(
            <TextTitleWidget widget={makeWidget()} className="custom-title" />,
        );

        const title = screen.getByText('Producción Línea A');
        const wrapper = container.firstElementChild;

        expect(title).toBeInTheDocument();
        expect(title).toHaveStyle({
            fontFamily: 'var(--font-dashboard-title)',
            fontWeight: 'var(--font-weight-dashboard-title)',
            letterSpacing: 'var(--tracking-dashboard-title)',
            fontSize: `${DEFAULT_TEXT_TITLE_FONT_SIZE}px`,
        });
        expect(wrapper).toHaveClass('custom-title');
        expect(wrapper).not.toHaveClass('glass-panel');
        expect(container.querySelector('.glass-panel')).toBeNull();
        expect(screen.queryByText('Widget no implementado')).not.toBeInTheDocument();
    });

    it('uses the configured font size and keeps rendering long titles without widget chrome', () => {
        const longTitle = 'Título industrial muy largo para validar el flujo de texto sin shell visual';

        render(
            <TextTitleWidget
                widget={makeWidget({
                    title: longTitle,
                    displayOptions: { fontSize: 96 },
                })}
            />,
        );

        const title = screen.getByText(longTitle);

        expect(title).toHaveStyle({ fontSize: '96px' });
        expect(title.parentElement).not.toHaveClass('glass-panel');
    });

    it('keeps an empty render path safe and accepts extreme numeric font sizes', () => {
        const { container, rerender } = render(
            <TextTitleWidget widget={makeWidget({ title: '', displayOptions: { fontSize: 12 } })} />,
        );

        expect(container.textContent).toBe('');

        rerender(
            <TextTitleWidget widget={makeWidget({ title: '', displayOptions: { fontSize: 200 } })} />,
        );

        expect(container.firstElementChild).toBeInTheDocument();
    });

    it('keeps text-title renderers free of direct navigation semantics even when a target exists', () => {
        render(
            <TextTitleWidget widget={makeWidget({ navigationTargetDashboardId: 'dashboard-linea-a' })} />,
        );

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByText('Producción Línea A')).toBeInTheDocument();
    });
});
