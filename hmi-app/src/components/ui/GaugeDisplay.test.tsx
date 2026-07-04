import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GaugeDisplay, { STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS } from './GaugeDisplay';

const CIRCULAR_RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * CIRCULAR_RADIUS;
const LG_CIRCUMFERENCE = 2 * Math.PI * ((160 - 8) / 2);
const SEGMENT_COUNT = 90;
const SEGMENT_OVERLAP = 0.75;

describe('GaugeDisplay', () => {
    let mediaQueryMatches = false;
    let animationFrameId = 0;
    let animationFrameCallbacks = new Map<number, FrameRequestCallback>();

    beforeEach(() => {
        vi.useFakeTimers();
        mediaQueryMatches = false;
        animationFrameId = 0;
        animationFrameCallbacks = new Map<number, FrameRequestCallback>();

        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(performance, 'now').mockReturnValue(1_000);
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            animationFrameId += 1;
            animationFrameCallbacks.set(animationFrameId, callback);
            return animationFrameId;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
            animationFrameCallbacks.delete(id);
        }));
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            matches: mediaQueryMatches,
            media: '(prefers-reduced-motion: reduce)',
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function getShapeCenter(element: Element) {
        if (element.tagName.toLowerCase() === 'rect') {
            return {
                x: Number(element.getAttribute('x')) + (Number(element.getAttribute('width')) / 2),
                y: Number(element.getAttribute('y')) + (Number(element.getAttribute('height')) / 2),
            };
        }

        return {
            x: (Number(element.getAttribute('x1')) + Number(element.getAttribute('x2'))) / 2,
            y: (Number(element.getAttribute('y1')) + Number(element.getAttribute('y2'))) / 2,
        };
    }

    function getRectSize(element: Element) {
        return {
            width: Number(element.getAttribute('width')),
            height: Number(element.getAttribute('height')),
        };
    }

    function getFilterIdFromUrl(value: string | null) {
        const match = value?.match(/^url\(#(.+)\)$/);

        return match?.[1] ?? null;
    }

    function getFilterBlurStdDeviations(svg: SVGSVGElement, filterId: string) {
        const filter = svg.querySelector(`filter[id="${filterId}"]`);

        expect(filter).toBeTruthy();

        return Array.from(filter!.querySelectorAll('feGaussianBlur')).map((node) => node.getAttribute('stdDeviation'));
    }

    function getFilterIdBySuffix(svg: SVGSVGElement, suffix: string) {
        const filter = svg.querySelector(`filter[id$="${suffix}"]`);

        expect(filter).toBeTruthy();

        return filter!.getAttribute('id');
    }

    function runNextAnimationFrame(now: number) {
        const nextFrame = Array.from(animationFrameCallbacks.entries()).at(-1);

        expect(nextFrame).toBeDefined();

        const [frameId, callback] = nextFrame!;
        animationFrameCallbacks.delete(frameId);

        act(() => {
            callback(now);
        });
    }

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
        expect(segments[0]).toHaveAttribute('stroke-linecap', 'round');
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

    it('hides the traveling top-cap when reduced motion is requested', () => {
        mediaQueryMatches = true;

        render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{ enabled: true }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        expect(screen.getByTestId('gauge-circular-static-top-cap')).toBeInTheDocument();
        expect(screen.queryByTestId('gauge-circular-top-cap')).not.toBeInTheDocument();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('keeps the original circular viewBox sizing when top caps are enabled', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{ enabled: true }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const svg = screen.getByTestId('gauge-circular');

        expect(svg).toHaveAttribute('viewBox', '-10 -10 160 160');
        expect(svg).toHaveStyle({ overflow: 'visible' });
    });

    it('maps static top-cap effect sliders only to the fixed cap effect layers', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticEffects: {
                        auraIntensity: 25,
                        haloIntensity: 50,
                        highlightIntensity: 40,
                        blur: 0,
                        extension: 0,
                        thickness: 0,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const staticAura = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const staticHalo = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-halo');
        const staticCore = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-core');
        const staticHighlight = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-core-highlight');
        const staticCoreStroke = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-core-stroke');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const movingAura = within(movingTopCap).getByTestId('gauge-circular-top-cap-aura');

        expect(staticTopCap).toHaveAttribute('data-effect-aura', '25');
        expect(staticTopCap).toHaveAttribute('data-effect-halo', '50');
        expect(staticTopCap).toHaveAttribute('data-effect-highlight', '40');
        expect(staticTopCap).toHaveAttribute('data-effect-blur', '0');
        expect(staticTopCap).toHaveAttribute('data-effect-extension', '0');
        expect(staticTopCap).toHaveAttribute('data-effect-thickness', '0');
        expect(staticAura).not.toHaveAttribute('filter');
        expect(staticHalo).not.toHaveAttribute('filter');
        expect(Number(staticAura.getAttribute('width'))).toBe(0);
        expect(Number(staticAura.getAttribute('height'))).toBe(0);
        expect(Number(staticHalo.getAttribute('width'))).toBe(0);
        expect(Number(staticHalo.getAttribute('height'))).toBe(0);
        expect(Number(staticCore.getAttribute('width'))).toBe(0);
        expect(Number(staticCore.getAttribute('height'))).toBe(0);
        expect(Number(staticHighlight.getAttribute('width'))).toBe(0);
        expect(Number(staticHighlight.getAttribute('height'))).toBe(0);
        expect(Number(staticCoreStroke.getAttribute('width'))).toBe(0);
        expect(Number(staticCoreStroke.getAttribute('height'))).toBe(0);
        expect(movingAura.getAttribute('filter')).toMatch(/^url\(#.+-traveling-top-cap-glow\)$/);
    });

    it('keeps the fixed top-cap full effect geometry at the current 100 baseline', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 100,
                        thickness: 100,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const staticAura = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const staticHalo = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-halo');
        const staticCore = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-core');
        const staticHighlight = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-core-highlight');
        const staticCoreStroke = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-core-stroke');

        expect(Number(staticAura.getAttribute('width'))).toBeCloseTo(14.4, 2);
        expect(Number(staticAura.getAttribute('height'))).toBeCloseTo(22.94, 2);
        expect(Number(staticHalo.getAttribute('width'))).toBeCloseTo(10.8, 2);
        expect(Number(staticHalo.getAttribute('height'))).toBeCloseTo(14.77, 2);
        expect(Number(staticCore.getAttribute('width'))).toBeCloseTo(4, 2);
        expect(Number(staticCore.getAttribute('height'))).toBeCloseTo(7.68, 2);
        expect(Number(staticHighlight.getAttribute('width'))).toBeCloseTo(2.08, 2);
        expect(Number(staticHighlight.getAttribute('height'))).toBeCloseTo(2.72, 2);
        expect(Number(staticCoreStroke.getAttribute('width'))).toBeCloseTo(4, 2);
        expect(Number(staticCoreStroke.getAttribute('height'))).toBeCloseTo(2.88, 2);
        expect(staticAura.getAttribute('filter')).toMatch(/^url\(#.+-static-top-cap-glow\)$/);
        expect(staticHalo.getAttribute('filter')).toMatch(/^url\(#.+-static-top-cap-glow\)$/);
    });

    it('renders fixed top-cap effects without a static base rect and keeps the effect baseline independent', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 75,
                        thickness: 20,
                    },
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 0,
                        thickness: 0,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const staticAura = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const staticHalo = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-halo');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const movingCore = within(movingTopCap).getByTestId('gauge-circular-top-cap-core');

        expect(within(staticTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(staticTopCap).toHaveAttribute('data-effect-base-length', '4');
        expect(staticTopCap).toHaveAttribute('data-effect-base-thickness', '8');
        expect(Number(staticTopCap.getAttribute('data-cap-length'))).toBeCloseTo(4, 2);
        expect(Number(staticTopCap.getAttribute('data-cap-thickness'))).toBeCloseTo(8, 2);
        expect(Number(staticAura.getAttribute('width'))).toBe(0);
        expect(Number(staticAura.getAttribute('height'))).toBe(0);
        expect(Number(staticHalo.getAttribute('width'))).toBe(0);
        expect(Number(staticHalo.getAttribute('height'))).toBe(0);
        expect(Number(movingCore.getAttribute('width'))).toBeCloseTo(1.6, 2);
        expect(Number(movingCore.getAttribute('height'))).toBeGreaterThan(1);
    });

    it('keeps fixed top-cap controls isolated from the traveling top-cap layer', () => {
        const { rerender } = render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 15,
                        thickness: 10,
                        alpha: 20,
                    },
                    staticEffects: {
                        auraIntensity: 20,
                        haloIntensity: 20,
                        highlightIntensity: 20,
                        blur: 10,
                        extension: 10,
                        thickness: 10,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const initialMovingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const initialMovingAura = within(initialMovingTopCap).getByTestId('gauge-circular-top-cap-aura');
        const initialMovingCore = within(initialMovingTopCap).getByTestId('gauge-circular-top-cap-core');
        const initialMovingAuraSize = getRectSize(initialMovingAura);
        const initialMovingCoreSize = getRectSize(initialMovingCore);

        rerender(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 90,
                        thickness: 85,
                        alpha: 80,
                    },
                    staticEffects: {
                        auraIntensity: 90,
                        haloIntensity: 75,
                        highlightIntensity: 65,
                        blur: 55,
                        extension: 45,
                        thickness: 35,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const updatedMovingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const updatedMovingAura = within(updatedMovingTopCap).getByTestId('gauge-circular-top-cap-aura');
        const updatedMovingCore = within(updatedMovingTopCap).getByTestId('gauge-circular-top-cap-core');
        const updatedMovingAuraSize = getRectSize(updatedMovingAura);
        const updatedMovingCoreSize = getRectSize(updatedMovingCore);

        expect(updatedMovingTopCap).toHaveAttribute('data-effect-aura', '45');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-halo', '76');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-highlight', '55');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-blur', '2');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-extension', '66');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-thickness', '20');
        expect(updatedMovingAuraSize.width).toBeCloseTo(initialMovingAuraSize.width, 2);
        expect(updatedMovingAuraSize.height).toBeCloseTo(initialMovingAuraSize.height, 2);
        expect(updatedMovingCoreSize.width).toBeCloseTo(initialMovingCoreSize.width, 2);
        expect(updatedMovingCoreSize.height).toBeCloseTo(initialMovingCoreSize.height, 2);
    });

    it('applies traveling top-cap sliders only to the moving layer without changing the fixed cap', () => {
        const { rerender } = render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 60,
                        thickness: 25,
                        alpha: 40,
                    },
                    staticEffects: {
                        auraIntensity: 55,
                        haloIntensity: 44,
                        highlightIntensity: 33,
                        blur: 22,
                        extension: 11,
                        thickness: 10,
                    },
                    travelingEffects: {
                        auraIntensity: 0,
                        haloIntensity: 0,
                        highlightIntensity: 0,
                        blur: 0,
                        extension: 0,
                        thickness: 0,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const firstMovingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const firstMovingAura = within(firstMovingTopCap).getByTestId('gauge-circular-top-cap-aura');
        const firstMovingHalo = within(firstMovingTopCap).getByTestId('gauge-circular-top-cap-halo');
        const firstMovingCore = within(firstMovingTopCap).getByTestId('gauge-circular-top-cap-core');
        const initialMovingAuraSize = getRectSize(firstMovingAura);
        const initialMovingHaloSize = getRectSize(firstMovingHalo);
        const initialMovingCoreSize = getRectSize(firstMovingCore);

        rerender(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 60,
                        thickness: 25,
                        alpha: 40,
                    },
                    staticEffects: {
                        auraIntensity: 55,
                        haloIntensity: 44,
                        highlightIntensity: 33,
                        blur: 22,
                        extension: 11,
                        thickness: 10,
                    },
                    travelingEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 100,
                        thickness: 100,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const updatedStaticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const updatedMovingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const updatedMovingAura = within(updatedMovingTopCap).getByTestId('gauge-circular-top-cap-aura');
        const updatedMovingHalo = within(updatedMovingTopCap).getByTestId('gauge-circular-top-cap-halo');
        const updatedMovingCore = within(updatedMovingTopCap).getByTestId('gauge-circular-top-cap-core');
        const nextMovingAuraSize = getRectSize(updatedMovingAura);
        const nextMovingHaloSize = getRectSize(updatedMovingHalo);
        const nextMovingCoreSize = getRectSize(updatedMovingCore);

        expect(updatedStaticTopCap).toHaveAttribute('data-effect-aura', '55');
        expect(within(updatedStaticTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(updatedStaticTopCap).toHaveAttribute('data-effect-base-length', '4');
        expect(updatedStaticTopCap).toHaveAttribute('data-effect-base-thickness', '8');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-aura', '100');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-extension', '100');
        expect(updatedMovingTopCap).toHaveAttribute('data-effect-thickness', '100');
        expect(nextMovingAuraSize.width).toBeGreaterThan(initialMovingAuraSize.width);
        expect(nextMovingAuraSize.height).toBeGreaterThan(initialMovingAuraSize.height);
        expect(nextMovingHaloSize.width).toBeGreaterThan(initialMovingHaloSize.width);
        expect(nextMovingHaloSize.height).toBeGreaterThan(initialMovingHaloSize.height);
        expect(nextMovingCoreSize.width).toBeCloseTo(initialMovingCoreSize.width, 2);
    });

    it('isolates static and traveling top-cap glow filters and blur values', () => {
        const { rerender } = render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 0,
                        extension: 100,
                        thickness: 100,
                    },
                    travelingEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 100,
                        thickness: 100,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const svg = screen.getByTestId('gauge-circular');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const staticFilterId = getFilterIdBySuffix(svg, '-static-top-cap-glow');
        const travelingFilterId = getFilterIdBySuffix(svg, '-traveling-top-cap-glow');
        const travelingAuraFilterId = getFilterIdFromUrl(within(movingTopCap).getByTestId('gauge-circular-top-cap-aura').getAttribute('filter'));

        expect(staticFilterId).toBeTruthy();
        expect(travelingFilterId).toBeTruthy();
        expect(staticFilterId!).toMatch(/-static-top-cap-glow$/);
        expect(travelingFilterId!).toMatch(/-traveling-top-cap-glow$/);
        expect(travelingAuraFilterId).toBe(travelingFilterId);
        expect(staticFilterId).not.toBe(travelingFilterId);
        expect(getFilterBlurStdDeviations(svg, staticFilterId!)).toEqual(['0', '0']);
        expect(getFilterBlurStdDeviations(svg, travelingFilterId!)).toEqual(['10', '4']);

        rerender(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 100,
                        thickness: 100,
                    },
                    travelingEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 0,
                        extension: 100,
                        thickness: 100,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const rerenderedSvg = screen.getByTestId('gauge-circular');
        const rerenderedStaticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const rerenderedStaticFilterId = getFilterIdBySuffix(rerenderedSvg, '-static-top-cap-glow');
        const rerenderedTravelingFilterId = getFilterIdBySuffix(rerenderedSvg, '-traveling-top-cap-glow');
        const rerenderedStaticAuraFilterId = getFilterIdFromUrl(within(rerenderedStaticTopCap).getByTestId('gauge-circular-static-top-cap-aura').getAttribute('filter'));

        expect(rerenderedStaticFilterId).toBeTruthy();
        expect(rerenderedTravelingFilterId).toBeTruthy();
        expect(rerenderedStaticAuraFilterId).toBe(rerenderedStaticFilterId);
        expect(getFilterBlurStdDeviations(rerenderedSvg, rerenderedStaticFilterId!)).toEqual(['10', '4']);
        expect(getFilterBlurStdDeviations(rerenderedSvg, rerenderedTravelingFilterId!)).toEqual(['0', '0']);
    });

    it('expands only the traveling extension ceiling and low-end thickness collapse for visual tuning', () => {
        const { rerender } = render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 60,
                        thickness: 25,
                        alpha: 40,
                    },
                    staticEffects: {
                        auraIntensity: 55,
                        haloIntensity: 44,
                        highlightIntensity: 33,
                        blur: 22,
                        extension: 100,
                        thickness: 100,
                    },
                    travelingEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 100,
                        thickness: 100,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const firstStaticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const firstMovingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const firstStaticAura = within(firstStaticTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const firstMovingAura = within(firstMovingTopCap).getByTestId('gauge-circular-top-cap-aura');
        const firstMovingHalo = within(firstMovingTopCap).getByTestId('gauge-circular-top-cap-halo');

        expect(getRectSize(firstMovingAura).width).toBeGreaterThan(20);
        expect(getRectSize(firstMovingHalo).width).toBeGreaterThan(16);
        expect(getRectSize(firstStaticAura).width).toBeLessThan(15);

        rerender(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 60,
                        thickness: 25,
                        alpha: 40,
                    },
                    staticEffects: {
                        auraIntensity: 55,
                        haloIntensity: 44,
                        highlightIntensity: 33,
                        blur: 22,
                        extension: 100,
                        thickness: 100,
                    },
                    travelingEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 0,
                        thickness: 0,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const collapsedMovingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const collapsedMovingAura = within(collapsedMovingTopCap).getByTestId('gauge-circular-top-cap-aura');
        const collapsedMovingHalo = within(collapsedMovingTopCap).getByTestId('gauge-circular-top-cap-halo');
        const collapsedMovingCore = within(collapsedMovingTopCap).getByTestId('gauge-circular-top-cap-core');

        expect(getRectSize(collapsedMovingAura).height).toBeLessThanOrEqual(1);
        expect(getRectSize(collapsedMovingHalo).height).toBeLessThanOrEqual(1);
        expect(getRectSize(collapsedMovingCore).height).toBeLessThanOrEqual(1);
        expect(screen.getByTestId('gauge-circular-static-top-cap')).toHaveAttribute('data-effect-extension', '100');
    });

    it('ignores legacy fixed top-cap base geometry inputs and keeps fixed effects on the same baseline', () => {
        const { rerender } = render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 50,
                        thickness: 50,
                    },
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 0,
                        thickness: 0,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const firstTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const firstAura = within(firstTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const firstHalo = within(firstTopCap).getByTestId('gauge-circular-static-top-cap-halo');
        const initialAura = getRectSize(firstAura);
        const initialHalo = getRectSize(firstHalo);

        rerender(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 90,
                        thickness: 10,
                    },
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 0,
                        thickness: 0,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const updatedTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const updatedAura = within(updatedTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const updatedHalo = within(updatedTopCap).getByTestId('gauge-circular-static-top-cap-halo');
        const nextAura = getRectSize(updatedAura);
        const nextHalo = getRectSize(updatedHalo);

        expect(within(updatedTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(Number(updatedTopCap.getAttribute('data-cap-length'))).toBeCloseTo(4, 2);
        expect(Number(updatedTopCap.getAttribute('data-cap-thickness'))).toBeCloseTo(8, 2);
        expect(nextAura.width).toBeCloseTo(initialAura.width, 2);
        expect(nextAura.height).toBeCloseTo(initialAura.height, 2);
        expect(nextHalo.width).toBeCloseTo(initialHalo.width, 2);
        expect(nextHalo.height).toBeCloseTo(initialHalo.height, 2);
        expect(updatedTopCap).toHaveAttribute('data-effect-base-length', '4');
        expect(updatedTopCap).toHaveAttribute('data-effect-base-thickness', '8');
    });

    it('lets fixed top-cap effect extension and thickness change effect geometry without rendering a base rect', () => {
        const { rerender } = render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 50,
                        thickness: 50,
                    },
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 0,
                        thickness: 0,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const firstTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const firstAura = within(firstTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const firstHalo = within(firstTopCap).getByTestId('gauge-circular-static-top-cap-halo');
        const initialAura = getRectSize(firstAura);
        const initialHalo = getRectSize(firstHalo);

        rerender(
            <GaugeDisplay
                normalizedValue={0.75}
                circularTopCap={{
                    enabled: true,
                    staticBase: {
                        length: 50,
                        thickness: 50,
                    },
                    staticEffects: {
                        auraIntensity: 100,
                        haloIntensity: 100,
                        highlightIntensity: 100,
                        blur: 100,
                        extension: 100,
                        thickness: 100,
                    },
                }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const updatedTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const updatedAura = within(updatedTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const updatedHalo = within(updatedTopCap).getByTestId('gauge-circular-static-top-cap-halo');
        const nextAura = getRectSize(updatedAura);
        const nextHalo = getRectSize(updatedHalo);

        expect(within(updatedTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(Number(updatedTopCap.getAttribute('data-cap-length'))).toBeCloseTo(4, 2);
        expect(Number(updatedTopCap.getAttribute('data-cap-thickness'))).toBeCloseTo(8, 2);
        expect(nextAura.width).toBeGreaterThan(initialAura.width);
        expect(nextAura.height).toBeGreaterThan(initialAura.height);
        expect(nextHalo.width).toBeGreaterThan(initialHalo.width);
        expect(nextHalo.height).toBeGreaterThan(initialHalo.height);
    });

    it('lets the KPI traveling top-cap run, hide, pause, and restart normally', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularBaseSegmentLinecap="butt"
                circularTopCap={{ enabled: true }}
                color={{
                    primary: 'var(--color-accent-cyan)',
                    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'],
                }}
            />,
        );

        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const segments = screen.getAllByTestId('gauge-circular-arc-segment');

        expect(staticTopCap).toBeInTheDocument();
        expect(staticTopCap).toHaveAttribute('data-intensity-progress', String(STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS));
        expect(within(staticTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(Number(staticTopCap.getAttribute('data-cap-length'))).toBeCloseTo(4, 2);
        expect(Number(staticTopCap.getAttribute('data-cap-thickness'))).toBeCloseTo(8, 2);
        expect(movingTopCap).toBeInTheDocument();
        expect(movingTopCap).toHaveAttribute('pointer-events', 'none');
        expect(movingTopCap).toHaveAttribute('aria-hidden', 'true');
        expect(movingTopCap).toHaveStyle({ mixBlendMode: 'screen' });
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-aura').tagName.toLowerCase()).toBe('rect');
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-aura').getAttribute('filter')).toMatch(/^url\(#.+-traveling-top-cap-glow\)$/);
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-halo').tagName.toLowerCase()).toBe('rect');
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-halo').getAttribute('filter')).toMatch(/^url\(#.+-traveling-top-cap-glow\)$/);
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-core').tagName.toLowerCase()).toBe('rect');
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-core-highlight').tagName.toLowerCase()).toBe('rect');
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-core-stroke').tagName.toLowerCase()).toBe('rect');
        expect(movingTopCap).not.toHaveAttribute('data-route-step');
        expect(movingTopCap).not.toHaveAttribute('data-route-count');
        expect(movingTopCap).not.toHaveAttribute('data-direction');

        const initialCore = within(movingTopCap).getByTestId('gauge-circular-top-cap-core');
        const initialCapX = Number(movingTopCap.getAttribute('data-cap-x'));
        const initialCapY = Number(movingTopCap.getAttribute('data-cap-y'));
        const initialProgress = Number(movingTopCap.getAttribute('data-progress'));

        expect(initialProgress).toBe(0);
        expect(getShapeCenter(initialCore).x).toBeCloseTo(initialCapX, 2);
        expect(getShapeCenter(initialCore).y).toBeCloseTo(initialCapY, 2);

        runNextAnimationFrame(1_000);
        runNextAnimationFrame(1_450);

        const movingTopCapMidRoute = screen.getByTestId('gauge-circular-top-cap');
        const midRouteProgress = Number(movingTopCapMidRoute.getAttribute('data-progress'));

        expect(midRouteProgress).toBeCloseTo(0.5, 2);

        act(() => {
            vi.advanceTimersByTime(900);
        });

        expect(screen.queryByTestId('gauge-circular-top-cap')).not.toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(8_000);
        });

        const restartedTopCap = screen.getByTestId('gauge-circular-top-cap');

        expect(restartedTopCap).toHaveAttribute('data-cycle-key', '1');
        expect(Number(restartedTopCap.getAttribute('data-progress'))).toBe(0);

        expect(segments[0]).toHaveAttribute('stroke-linecap', 'butt');
        expect(segments.at(-1)).toHaveAttribute('stroke-linecap', 'butt');
    });
});
