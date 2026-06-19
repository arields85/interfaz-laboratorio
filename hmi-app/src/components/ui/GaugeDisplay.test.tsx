import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GaugeDisplay from './GaugeDisplay';

const CIRCULAR_RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * CIRCULAR_RADIUS;
const LG_CIRCUMFERENCE = 2 * Math.PI * ((160 - 8) / 2);
const SEGMENT_COUNT = 90;
const SEGMENT_OVERLAP = 0.75;

describe('GaugeDisplay', () => {
    it('defaults to circular mode and reflects the normalized arc fill with spec animation semantics', () => {
        const { container } = render(
            <GaugeDisplay
                normalizedValue={0.75}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
                animation={{
                    enabled: true,
                    intensity: 'active',
                    durationMs: 750,
                }}
            />,
        );

        const svg = screen.getByTestId('gauge-circular');
        const arc = screen.getByTestId('gauge-circular-arc');
        const segments = screen.getAllByTestId('gauge-circular-arc-segment');
        const expectedSegmentArcLength = (CIRCUMFERENCE * 0.75) / SEGMENT_COUNT;

        expect(svg).toBeInTheDocument();
        expect(container.firstElementChild).toBe(svg);
        expect(svg).toHaveClass('w-full', 'h-full', 'transform', '-rotate-90', 'origin-center');
        expect(svg.style.width).toBe('');
        expect(svg.style.height).toBe('');
        expect(arc.tagName.toLowerCase()).toBe('g');
        expect(segments).toHaveLength(SEGMENT_COUNT);
        expect(segments[0]).toHaveAttribute(
            'stroke',
            'color-mix(in srgb, var(--color-widget-gradient-to) 0%, var(--color-widget-gradient-from))',
        );
        expect(segments.at(-1)).toHaveAttribute(
            'stroke',
            'color-mix(in srgb, var(--color-widget-gradient-to) 100%, var(--color-widget-gradient-from))',
        );
        expect(segments[0]).toHaveAttribute(
            'stroke-dasharray',
            `${expectedSegmentArcLength + SEGMENT_OVERLAP} ${CIRCUMFERENCE - expectedSegmentArcLength - SEGMENT_OVERLAP}`,
        );
        expect(segments.at(-1)).toHaveAttribute('stroke-linecap', 'round');
        expect(segments[1]).toHaveAttribute('stroke-linecap', 'butt');
        expect(segments[0].style.transition).toBe('opacity 750ms ease-out');
        expect(svg.style.filter).toBe('');
    });

    it('renders bar mode and disables animated glow when animation is disabled', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.33}
                color={{
                    primary: 'var(--color-accent-purple)',
                    gradient: ['var(--color-dynamic-normal-from)', 'var(--color-dynamic-normal-to)'],
                }}
                mode="bar"
                animation={{
                    enabled: false,
                    intensity: 'none',
                    durationMs: 900,
                }}
            />,
        );

        const track = screen.getByTestId('gauge-bar-track');
        const fill = screen.getByTestId('gauge-bar-fill');

        expect(track).toBeInTheDocument();
        expect(fill).toHaveStyle({ width: '33%' });
        expect(fill.style.background).toContain('linear-gradient');
        expect(fill.style.background).toContain('var(--color-dynamic-normal-from)');
        expect(fill.style.background).toContain('var(--color-dynamic-normal-to)');
        expect(fill).toHaveStyle({ transitionDuration: '0ms' });
        expect(fill.style.boxShadow).toBe('');
    });

    it('clamps edge-case normalized values and supports preset sizes', () => {
        const { rerender, unmount } = render(
            <GaugeDisplay
                normalizedValue={0}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
                mode="circular"
                size="lg"
            />,
        );

        let segments = screen.queryAllByTestId('gauge-circular-arc-segment');
        const svg = screen.getByTestId('gauge-circular');
        expect(segments).toHaveLength(SEGMENT_COUNT);
        expect(segments[0]).toHaveAttribute('stroke-dasharray', `0 ${LG_CIRCUMFERENCE}`);
        expect(svg).toHaveAttribute('viewBox', '-10 -10 160 160');
        expect(svg).toHaveClass('w-full', 'h-full');

        rerender(
            <GaugeDisplay
                normalizedValue={1}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
                mode="circular"
            />,
        );

        segments = screen.getAllByTestId('gauge-circular-arc-segment');
        expect(segments).toHaveLength(SEGMENT_COUNT);
        expect(Number(segments.at(-1)?.getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE / SEGMENT_COUNT);

        rerender(
            <GaugeDisplay
                normalizedValue={1.5}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        unmount();

        render(
            <GaugeDisplay
                normalizedValue={1.5}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
                mode="bar"
                size="sm"
            />,
        );

        expect(screen.getByTestId('gauge-bar-track')).toHaveStyle({ height: '6px' });
        expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '100%' });
    });

    it('keeps the segmented gradient distribution anchored to gradientNormalized during retraction', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.5}
                gradientNormalized={1}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const segments = screen.getAllByTestId('gauge-circular-arc-segment');
        const fullCircleSegmentLength = CIRCUMFERENCE / SEGMENT_COUNT;

        expect(segments).toHaveLength(SEGMENT_COUNT);
        expect(segments[0]).toHaveAttribute(
            'stroke-dasharray',
            `${fullCircleSegmentLength + SEGMENT_OVERLAP} ${CIRCUMFERENCE - fullCircleSegmentLength - SEGMENT_OVERLAP}`,
        );
        expect(segments.at(-1)).toHaveAttribute('stroke-dasharray', `0 ${CIRCUMFERENCE}`);
        expect(segments.at(-1)).toHaveAttribute(
            'stroke',
            'color-mix(in srgb, var(--color-widget-gradient-to) 100%, var(--color-widget-gradient-from))',
        );
    });

    it('renders optional circular center content inside the svg so it scales with the gauge', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.5}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
                circularContent={({ center }) => (
                    <text x={center} y={center} textAnchor="middle">
                        50
                    </text>
                )}
            />,
        );

        const svg = screen.getByTestId('gauge-circular');
        const centerContent = screen.getByTestId('gauge-circular-center-content');

        expect(centerContent.tagName.toLowerCase()).toBe('g');
        expect(centerContent).toHaveAttribute('transform', 'rotate(90 70 70)');
        expect(svg).toContainElement(centerContent);
        expect(screen.getByText('50').tagName.toLowerCase()).toBe('text');
    });
});
