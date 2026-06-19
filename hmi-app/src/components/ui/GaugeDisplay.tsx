import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type GaugeMode = 'circular' | 'bar';

export interface GaugeDisplayAnimation {
    enabled: boolean;
    intensity: 'none' | 'subtle' | 'active';
    durationMs?: number;
}

export interface GaugeDisplayProps {
    normalizedValue: number;
    color: {
        primary: string;
        gradient: [string, string];
    };
    mode?: GaugeMode;
    animation?: GaugeDisplayAnimation;
    size?: 'sm' | 'md' | 'lg' | number;
    arcOpacity?: number;
    gradientNormalized?: number;
    className?: string;
    circularContent?: (layout: {
        center: number;
        radius: number;
        viewBoxSize: number;
        renderedSize: number;
    }) => ReactNode;
}

const CIRCULAR_RADIUS = 60;
const CIRCULAR_DIAMETER = 140;
const CIRCULAR_VIEWBOX_SIZE = 160;
const CIRCULAR_CENTER = 70;
const BAR_HEIGHT = 8;
const BAR_HEIGHT_PRESETS = {
    sm: 6,
    md: BAR_HEIGHT,
    lg: 10,
} as const;
const CIRCULAR_SIZE_PRESETS = {
    sm: 112,
    md: CIRCULAR_DIAMETER,
    lg: 160,
} as const;
const ANIMATION_DURATION_PRESETS = {
    none: 0,
    subtle: 550,
    active: 350,
} as const;
const CIRCULAR_SEGMENT_COUNT = 90;
const CIRCULAR_SEGMENT_OVERLAP = 0.75;

function clampNormalizedValue(value: number) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(Math.max(value, 0), 1);
}

export default function GaugeDisplay({
    normalizedValue,
    color,
    mode = 'circular',
    animation,
    size,
    arcOpacity,
    gradientNormalized,
    className,
    circularContent,
}: GaugeDisplayProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [renderedSize, setRenderedSize] = useState(0);
    const normalized = clampNormalizedValue(normalizedValue);
    const instanceId = useId().replace(/:/g, '');
    const glowFilterId = `${instanceId}-glow`;
    const strokeWidth = 8;
    const animationEnabled = animation?.enabled !== false;
    const animationIntensity = animation?.intensity ?? 'subtle';
    const animationDuration = animationEnabled
        ? (animation?.durationMs ?? ANIMATION_DURATION_PRESETS[animationIntensity])
        : 0;
    const showGlow = animationEnabled && animationIntensity !== 'none';
    const gradientColors = color.gradient;
    const primaryColor = color.primary;

    useEffect(() => {
        if (mode !== 'circular') {
            return undefined;
        }

        const element = svgRef.current;

        if (!element || typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const updateRenderedSize = (width: number, height: number) => {
            setRenderedSize(Math.min(width, height));
        };

        updateRenderedSize(element.clientWidth, element.clientHeight);

        const observer = new ResizeObserver(([entry]) => {
            updateRenderedSize(entry.contentRect.width, entry.contentRect.height);
        });

        observer.observe(element);

        return () => observer.disconnect();
    }, [mode]);

    const circularSize = typeof size === 'number'
        ? size
        : size
            ? CIRCULAR_SIZE_PRESETS[size]
            : undefined;
    const radius = circularSize ? Math.max((circularSize - strokeWidth) / 2, 0) : CIRCULAR_RADIUS;
    const circumference = 2 * Math.PI * radius;
    const svgSize = circularSize ?? CIRCULAR_DIAMETER;
    const viewBoxInset = strokeWidth + 2;
    const center = circularSize ? svgSize / 2 : CIRCULAR_CENTER;
    const viewBoxSize = circularSize ? svgSize : CIRCULAR_VIEWBOX_SIZE;
    const circularScale = renderedSize > 0 ? renderedSize / viewBoxSize : 1;
    const gradientNorm = clampNormalizedValue(gradientNormalized ?? normalized);
    const circularSegments = useMemo(() => {
        if (circumference <= 0) {
            return [];
        }

        const visibleArcLength = normalized * circumference;
        const gradientArcNorm = gradientNorm > 0 ? gradientNorm : 1;
        const gradientArcLength = gradientArcNorm * circumference;
        const baseSegmentArcLength = gradientArcLength / CIRCULAR_SEGMENT_COUNT;

        if (baseSegmentArcLength <= 0) {
            return [];
        }

        const segments = [] as Array<{
            key: number;
            stroke: string;
            strokeDasharray: string;
            strokeDashoffset: number;
            hasVisibleArc: boolean;
        }>;

        for (let index = 0; index < CIRCULAR_SEGMENT_COUNT; index += 1) {
            const segmentStart = index * baseSegmentArcLength;
            const remainingVisibleLength = Math.max(visibleArcLength - segmentStart, 0);
            const visibleSegmentLength = Math.min(baseSegmentArcLength, remainingVisibleLength);
            const segmentArcLength = visibleSegmentLength > 0
                ? Math.min(visibleSegmentLength + CIRCULAR_SEGMENT_OVERLAP, circumference)
                : 0;
            const mixPercent = Math.round((index / (CIRCULAR_SEGMENT_COUNT - 1)) * 100);

            segments.push({
                key: index,
                stroke: `color-mix(in srgb, ${gradientColors[1]} ${mixPercent}%, ${gradientColors[0]})`,
                strokeDasharray: `${segmentArcLength} ${Math.max(circumference - segmentArcLength, 0)}`,
                strokeDashoffset: circumference - segmentStart,
                hasVisibleArc: visibleSegmentLength > 0,
            });
        }

        return segments;
    }, [circumference, gradientColors, gradientNorm, normalized]);

    if (mode === 'bar') {
        const backgroundStyle = `linear-gradient(90deg, ${gradientColors[0]}, ${gradientColors[1]})`;
        const barHeight = typeof size === 'number'
            ? size
            : size
                ? BAR_HEIGHT_PRESETS[size]
                : BAR_HEIGHT;

        return (
            <div className={`w-full ${className ?? ''}`.trim()}>
                <div
                    className="h-2 w-full bg-white/5 rounded-full relative"
                    data-testid="gauge-bar-track"
                    style={{ height: `${barHeight}px` }}
                >
                    <div
                        className="absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out"
                        data-testid="gauge-bar-fill"
                        style={{
                            width: `${normalized * 100}%`,
                            background: backgroundStyle,
                            transitionDuration: `${animationDuration}ms`,
                            boxShadow: showGlow ? `0 0 15px ${primaryColor}` : undefined,
                            opacity: arcOpacity,
                        }}
                    />
                </div>
            </div>
        );
    }

    const circularStyle: CSSProperties & { '--gauge-circular-scale': string } = {
        '--gauge-circular-scale': String(circularScale),
        transitionDuration: `${animationDuration}ms`,
    };
    let lastVisibleSegmentIndex = -1;

    for (let index = circularSegments.length - 1; index >= 0; index -= 1) {
        if (circularSegments[index]?.hasVisibleArc) {
            lastVisibleSegmentIndex = index;
            break;
        }
    }

    return (
        <svg
            ref={svgRef}
            className={`w-full h-full transform -rotate-90 origin-center transition-all duration-500 ease-out ${className ?? ''}`.trim()}
            data-testid="gauge-circular"
            viewBox={`${-viewBoxInset} ${-viewBoxInset} ${viewBoxSize} ${viewBoxSize}`}
            preserveAspectRatio="xMidYMid meet"
            style={circularStyle}
        >
            <defs>
                <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>
            <circle
                cx={center}
                cy={center}
                r={radius}
                stroke="color-mix(in srgb, white 3%, transparent)"
                strokeWidth={strokeWidth}
                fill="none"
            />
            <g
                data-testid="gauge-circular-arc"
            >
                {circularSegments.map((segment, index) => {
                    const isEndpoint = segment.hasVisibleArc && (index === 0 || index === lastVisibleSegmentIndex);

                    return (
                        <circle
                            key={segment.key}
                            cx={center}
                            cy={center}
                            r={radius}
                            stroke={segment.stroke}
                            strokeWidth={strokeWidth}
                            fill="none"
                            strokeDasharray={segment.strokeDasharray}
                            strokeDashoffset={segment.strokeDashoffset}
                            strokeLinecap={isEndpoint ? 'round' : 'butt'}
                            data-testid="gauge-circular-arc-segment"
                            filter={showGlow ? `url(#${glowFilterId})` : undefined}
                            style={{
                                opacity: arcOpacity,
                                transition: `opacity ${animationDuration}ms ease-out`,
                            }}
                        />
                    );
                })}
            </g>
            {circularContent && (
                <g transform={`rotate(90 ${center} ${center})`} data-testid="gauge-circular-center-content">
                    {circularContent({ center, radius, viewBoxSize, renderedSize })}
                </g>
            )}
        </svg>
    );
}

export { BAR_HEIGHT, CIRCULAR_DIAMETER, CIRCULAR_RADIUS, CIRCULAR_VIEWBOX_SIZE };
