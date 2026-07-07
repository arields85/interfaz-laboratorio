import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InfoCardWidgetConfig } from '../../domain/admin.types';
import { DEFAULT_INFO_CARD_VALUE_FONT_SIZE } from '../../utils/infoCardDisplayOptions';
import InfoCardWidget from './InfoCardWidget';

function makeWidget(overrides?: Partial<InfoCardWidgetConfig>): InfoCardWidgetConfig {
    return {
        id: 'info-card-1',
        type: 'info-card',
        title: 'Line Overview',
        position: { x: 0, y: 0 },
        size: { w: 6, h: 5 },
        displayOptions: {
            subtitle: 'Shift summary',
            helpText: 'Static information only',
            fields: [
                { id: 'batch', label: 'Batch', value: 'B-204' },
                { id: 'operator', label: 'Operator', value: 'Lab Team' },
            ],
        },
        ...overrides,
    };
}

describe('InfoCardWidget', () => {
    it('renders configured title, right-side canonical header icon, subtitle, help text, and static label/value rows', () => {
        render(<InfoCardWidget widget={makeWidget()} />);

        expect(screen.getByText('Line Overview')).toBeInTheDocument();
        expect(screen.getByTestId('info-card-header-icon')).toBeInTheDocument();
        expect(screen.getByText('Shift summary')).toBeInTheDocument();
        expect(screen.getByText('Static information only')).toBeInTheDocument();
        expect(screen.getByText('Batch')).toBeInTheDocument();
        expect(screen.getByText('B-204')).toBeInTheDocument();
        expect(screen.getByText('Operator')).toBeInTheDocument();
        expect(screen.getByText('Lab Team')).toBeInTheDocument();
    });

    it('keeps missing values display-only with a safe fallback', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [
                            { id: 'recipe', label: 'Recipe' },
                            { id: 'state', label: 'State', value: '' },
                        ],
                    },
                })}
            />,
        );

        expect(screen.getByText('Recipe')).toBeInTheDocument();
        expect(screen.getByText('State')).toBeInTheDocument();
        expect(screen.getAllByText('—')).toHaveLength(2);
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('uses dashboard-title typography variables for values with a configurable font size', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18' }],
                        valueFontSize: 48,
                    },
                })}
            />,
        );

        expect(screen.getByText('L-18')).toHaveStyle({
            fontFamily: 'var(--font-dashboard-title)',
            fontSize: '48px',
        });
    });

    it('falls back to the default info-card value size when no value size is configured', () => {
        render(<InfoCardWidget widget={makeWidget()} />);

        expect(screen.getByText('B-204')).toHaveStyle({
            fontSize: `${DEFAULT_INFO_CARD_VALUE_FONT_SIZE}px`,
        });
    });

    it('renders an empty static field state without runtime controls or actions', () => {
        render(<InfoCardWidget widget={makeWidget({ displayOptions: { fields: [] } })} />);

        expect(screen.getByText('No static fields configured')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('treats malformed persisted fields as empty instead of crashing during boot render', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: 'legacy-bad-shape',
                    } as unknown as InfoCardWidgetConfig['displayOptions'],
                })}
            />,
        );

        expect(screen.getByText('No static fields configured')).toBeInTheDocument();
    });
});
