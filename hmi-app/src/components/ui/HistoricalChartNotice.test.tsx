import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HistoricalChartNotice from './HistoricalChartNotice';

describe('HistoricalChartNotice', () => {
    it('renders the shared refreshing copy, caret animation, and non-blocking absolute frame', () => {
        render(<HistoricalChartNotice variant="refreshing" testId="historical-notice" />);

        const notice = screen.getByTestId('historical-notice');
        const panel = notice.firstElementChild;
        const caret = notice.querySelector('.widget-runtime-state-caret');

        expect(notice).toHaveAttribute('role', 'status');
        expect(notice).toHaveAttribute('aria-live', 'polite');
        expect(notice).toHaveAttribute('aria-atomic', 'true');
        expect(notice).toHaveClass(
            'pointer-events-none',
            'absolute',
            'inset-0',
            'z-10',
            'flex',
            'items-center',
            'justify-center',
        );
        expect(panel).toHaveClass(
            'w-fit',
            'max-w-full',
            'rounded-lg',
            'border',
            'border-industrial-border',
            'bg-industrial-surface/95',
            'shadow-lg',
            'backdrop-blur-sm',
            'font-system',
            'text-industrial-muted',
        );
        expect(notice).toHaveTextContent('Actualizando_');
        expect(screen.getByText('Actualizando')).toBeInTheDocument();
        expect(caret).toHaveTextContent('_');
        expect(caret).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders a persistent amber stale status without the loading caret', () => {
        render(<HistoricalChartNotice variant="stale" testId="historical-notice" />);

        const notice = screen.getByTestId('historical-notice');
        const panel = notice.firstElementChild;

        expect(notice).toHaveAttribute('role', 'status');
        expect(notice).toHaveAttribute('aria-live', 'polite');
        expect(notice).toHaveTextContent('Desactualizado');
        expect(panel).toHaveClass(
            'border-status-warning/40',
            'bg-status-warning/10',
            'text-status-warning',
        );
        expect(notice.querySelector('.widget-runtime-state-caret')).toBeNull();
        expect(screen.queryByText('Actualizando')).not.toBeInTheDocument();
    });
});
