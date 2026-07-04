import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { KpiFixedTopCapBase, KpiFixedTopCapEffects, KpiTopCapShape, KpiTravelingTopCapEffects } from '../../domain/admin.types';
import {
    DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
    resolveKpiFixedTopCapShape,
    resolveKpiFixedTopCapEffects,
    resolveKpiTravelingTopCapMaximumLength,
    resolveKpiTravelingTopCapMinimumThickness,
    resolveKpiTravelingTopCapShape,
    resolveKpiTravelingTopCapEffects,
} from '../../utils/kpiTopCapEffects';

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
    circularBaseSegmentLinecap?: 'default' | 'butt';
    circularTopCap?: {
        enabled?: boolean;
        staticBase?: KpiFixedTopCapBase;
        staticShape?: KpiTopCapShape;
        staticEffects?: KpiFixedTopCapEffects;
        travelingShape?: KpiTopCapShape;
        travelingEffects?: KpiTravelingTopCapEffects;
    };
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
const CIRCULAR_TOP_CAP_CORE_LENGTH_MULTIPLIER = 0.2;
const CIRCULAR_TOP_CAP_CORE_THICKNESS_MULTIPLIER = 1;
const CIRCULAR_TOP_CAP_AURA_LENGTH_MULTIPLIER = 1.8;
const CIRCULAR_TOP_CAP_HALO_LENGTH_MULTIPLIER = 1.35;
const CIRCULAR_TOP_CAP_AURA_THICKNESS_MULTIPLIER = 1.68;
const CIRCULAR_TOP_CAP_HALO_THICKNESS_MULTIPLIER = 1.28;
const CIRCULAR_TOP_CAP_AURA_THICKNESS_EXPANSION_MULTIPLIER = 0.72;
const CIRCULAR_TOP_CAP_HALO_THICKNESS_EXPANSION_MULTIPLIER = 0.48;
const CIRCULAR_TOP_CAP_CORE_STROKE_THICKNESS_MULTIPLIER = 0.36;
const CIRCULAR_TOP_CAP_HIGHLIGHT_LENGTH_MULTIPLIER = 0.52;
const CIRCULAR_TOP_CAP_HIGHLIGHT_THICKNESS_MULTIPLIER = 0.34;
const CIRCULAR_TOP_CAP_ROUNDED_CORNER_MULTIPLIER = 0.5;
const CIRCULAR_TOP_CAP_MIN_LENGTH = 1;
const STATIC_TOP_CAP_EFFECT_BASE_LENGTH_MULTIPLIER = 0.5;
const STATIC_TOP_CAP_EFFECT_BASE_THICKNESS_MULTIPLIER = 1;
const STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS = 0.72;
const TOP_CAP_VISUAL_TUNING = {
    glow: {
        outerBlurStdDeviation: 10,
        outerBloomAlphaMultiplier: 2.4,
        innerBlurStdDeviation: 4,
    },
    aura: {
        fillOpacityBoost: 0.34,
        fillOpacityMax: 0.94,
    },
    halo: {
        fillOpacityBoost: 0.42,
        fillOpacityMax: 1,
    },
    highlight: {
        strokeMix: 58,
        baseOpacity: 0.96,
        maxOpacity: 1,
    },
    frame: {
        auraOpacity: [0.42, 0.74, 0.9, 0.38, 0],
        auraFillOpacity: [0.44, 0.7, 0.78, 0.32, 0],
        auraRadius: [15.5, 21.5, 20.75, 17.25, 15.5],
        haloOpacity: [0.58, 0.94, 1, 0.42, 0],
        haloFillOpacity: [0.46, 0.76, 0.84, 0.34, 0],
        haloRadius: [9.5, 14.75, 14.1, 10.5, 9.5],
        coreOpacity: [0.8, 1, 1, 0.4, 0],
        coreRadius: [2.7, 3.85, 3.65, 2.95, 2.7],
    },
} as const;
const TRAVELING_TOP_CAP_SPEED_PX_PER_SECOND = 323;
const TRAVELING_TOP_CAP_DURATION_MIN_SECONDS = 0.9;
const TRAVELING_TOP_CAP_DURATION_MAX_SECONDS = 3.2;
const TRAVELING_TOP_CAP_PAUSE_MIN_MS = 8_000;
const TRAVELING_TOP_CAP_PAUSE_MAX_MS = 20_000;

type ResolvedKpiFixedTopCapEffects = Required<KpiFixedTopCapEffects>;
type ResolvedKpiTravelingTopCapEffects = Required<KpiTravelingTopCapEffects>;

function clampNormalizedValue(value: number) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(Math.max(value, 0), 1);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
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
    circularBaseSegmentLinecap = 'default',
    circularTopCap,
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
    const topCapEnabled = mode === 'circular' && circularTopCap?.enabled === true;
    const staticTopCapEffects = resolveKpiFixedTopCapEffects(circularTopCap?.staticEffects);
    const travelingTopCapEffects = resolveKpiTravelingTopCapEffects(circularTopCap?.travelingEffects);
    const staticTopCapShape = useMemo(
        () => resolveKpiFixedTopCapShape(circularTopCap?.staticShape),
        [circularTopCap?.staticShape],
    );
    const travelingTopCapShape = useMemo(
        () => resolveKpiTravelingTopCapShape(circularTopCap?.travelingShape),
        [circularTopCap?.travelingShape],
    );
    const staticTopCapGlowBoost = resolveTopCapGlowBoost(staticTopCapEffects.blur / 100);
    const travelingTopCapGlowBoost = resolveTopCapGlowBoost(travelingTopCapEffects.blur / 100);
    const staticTopCapGlowFilterId = `${instanceId}-static-top-cap-glow`;
    const travelingTopCapGlowFilterId = `${instanceId}-traveling-top-cap-glow`;
    const staticTopCapCornerRadiusMultiplier = staticTopCapShape.pill ? CIRCULAR_TOP_CAP_ROUNDED_CORNER_MULTIPLIER : 0;
    const travelingTopCapCornerRadiusMultiplier = travelingTopCapShape.pill ? CIRCULAR_TOP_CAP_ROUNDED_CORNER_MULTIPLIER : 0;

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
    const viewBoxOrigin = -viewBoxInset;
    const circularScale = renderedSize > 0 ? renderedSize / viewBoxSize : 1;
    const gradientNorm = clampNormalizedValue(gradientNormalized ?? normalized);
    const visibleArcLength = normalized * circumference;
    const circularSegments = useMemo(() => {
        if (circumference <= 0) {
            return [];
        }

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
    }, [circumference, gradientColors, gradientNorm, visibleArcLength]);
    const visibleCircularSegments = useMemo(
        () => circularSegments.filter((segment) => segment.hasVisibleArc),
        [circularSegments],
    );
    const endpointSegment = visibleCircularSegments.at(-1) ?? null;
    const staticTopCapModel = useMemo(() => {
        if (!topCapEnabled || !endpointSegment || visibleArcLength <= 0) {
            return null;
        }

        return resolveCircularStaticTopCapPosition({
            key: endpointSegment.key,
            stroke: endpointSegment.stroke,
            visibleArcLength,
            strokeWidth,
            circumference,
            center,
            radius,
        });
    }, [center, circumference, endpointSegment, radius, strokeWidth, topCapEnabled, visibleArcLength]);
    const travelingTopCapDurationSeconds = useMemo(
        () => resolveTravelingTopCapDurationSeconds(visibleArcLength),
        [visibleArcLength],
    );
    const {
        prefersReducedMotion,
        cycleKey: travelingTopCapCycleKey,
        progress: travelingTopCapProgress,
        isPaused: isTravelingTopCapPaused,
    } = useTravelingEffectCycle({
        enabled: topCapEnabled && visibleArcLength > 0,
        durationSeconds: travelingTopCapDurationSeconds,
    });
    const movingTopCapModel = useMemo(() => resolveCircularTravelingTopCapPosition({
        key: endpointSegment?.key ?? CIRCULAR_SEGMENT_COUNT - 1,
        stroke: endpointSegment?.stroke ?? gradientColors[1],
        visibleArcLength,
        progress: travelingTopCapProgress,
        strokeWidth,
        circumference,
        center,
        radius,
    }), [center, circumference, endpointSegment, gradientColors, radius, strokeWidth, travelingTopCapProgress, visibleArcLength]);
    const isTravelingTopCapActive = travelingTopCapProgress < 1 && !isTravelingTopCapPaused;
    const showTravelingTopCap = topCapEnabled
        && !prefersReducedMotion
        && isTravelingTopCapActive
        && movingTopCapModel !== null;
    let lastVisibleSegmentIndex = -1;

    for (let index = circularSegments.length - 1; index >= 0; index -= 1) {
        if (circularSegments[index]?.hasVisibleArc) {
            lastVisibleSegmentIndex = index;
            break;
        }
    }

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
        overflow: topCapEnabled ? 'visible' : undefined,
        transitionDuration: `${animationDuration}ms`,
    };
    return (
        <svg
            ref={svgRef}
            className={`w-full h-full transform -rotate-90 origin-center transition-all duration-500 ease-out ${className ?? ''}`.trim()}
            data-testid="gauge-circular"
            viewBox={`${viewBoxOrigin} ${viewBoxOrigin} ${viewBoxSize} ${viewBoxSize}`}
            preserveAspectRatio="xMidYMid meet"
            style={circularStyle}
        >
            <defs>
                <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id={staticTopCapGlowFilterId} x="-140%" y="-140%" width="380%" height="380%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation={staticTopCapGlowBoost.outerBlurStdDeviation} result="outer-blur" />
                    <feColorMatrix
                        in="outer-blur"
                        result="outer-bloom"
                        type="matrix"
                        values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${staticTopCapGlowBoost.outerBloomAlphaMultiplier} 0`}
                    />
                    <feGaussianBlur in="SourceGraphic" stdDeviation={staticTopCapGlowBoost.innerBlurStdDeviation} result="inner-blur" />
                    <feMerge>
                        <feMergeNode in="outer-bloom" />
                        <feMergeNode in="inner-blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <filter id={travelingTopCapGlowFilterId} x="-140%" y="-140%" width="380%" height="380%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation={travelingTopCapGlowBoost.outerBlurStdDeviation} result="outer-blur" />
                    <feColorMatrix
                        in="outer-blur"
                        result="outer-bloom"
                        type="matrix"
                        values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${travelingTopCapGlowBoost.outerBloomAlphaMultiplier} 0`}
                    />
                    <feGaussianBlur in="SourceGraphic" stdDeviation={travelingTopCapGlowBoost.innerBlurStdDeviation} result="inner-blur" />
                    <feMerge>
                        <feMergeNode in="outer-bloom" />
                        <feMergeNode in="inner-blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
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
                    const segmentLinecap = circularBaseSegmentLinecap === 'butt'
                        ? 'butt'
                        : isEndpoint
                            ? 'round'
                            : 'butt';

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
                            strokeLinecap={segmentLinecap}
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
            {staticTopCapModel ? (
                <g
                    pointerEvents="none"
                    aria-hidden="true"
                    data-testid="gauge-circular-static-top-cap"
                    data-segment-key={String(staticTopCapModel.key)}
                    data-cap-angle={staticTopCapModel.angleDegrees.toFixed(2)}
                    data-cap-tangent-angle={staticTopCapModel.tangentAngleDegrees.toFixed(2)}
                    data-cap-x={staticTopCapModel.x.toFixed(2)}
                    data-cap-y={staticTopCapModel.y.toFixed(2)}
                    data-cap-length={staticTopCapModel.effectBaseLength.toFixed(2)}
                    data-cap-thickness={staticTopCapModel.effectBaseThickness.toFixed(2)}
                    data-intensity-progress={String(STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS)}
                    data-effect-aura={String(staticTopCapEffects.auraIntensity)}
                    data-effect-halo={String(staticTopCapEffects.haloIntensity)}
                    data-effect-highlight={String(staticTopCapEffects.highlightIntensity)}
                    data-effect-blur={String(staticTopCapEffects.blur)}
                    data-effect-extension={String(staticTopCapEffects.extension)}
                    data-effect-thickness={String(staticTopCapEffects.thickness)}
                    data-effect-base-length={String(staticTopCapModel.effectBaseLength)}
                    data-effect-base-thickness={String(staticTopCapModel.effectBaseThickness)}
                    data-shape-pill={String(staticTopCapShape.pill)}
                >
                    <g style={{ mixBlendMode: 'screen' }}>
                        {renderCircularTopCapGlowStack({
                            filterId: staticTopCapGlowFilterId,
                            cap: {
                                x: staticTopCapModel.x,
                                y: staticTopCapModel.y,
                                stroke: staticTopCapModel.stroke,
                                strokeWidth: staticTopCapModel.effectBaseThickness,
                                capLength: staticTopCapModel.effectBaseLength,
                                angleDegrees: staticTopCapModel.tangentAngleDegrees,
                                frame: staticTopCapModel.frame,
                            },
                            effects: staticTopCapEffects,
                            collapseAtZero: true,
                            cornerRadiusMultiplier: staticTopCapCornerRadiusMultiplier,
                            testIdPrefix: 'gauge-circular-static-top-cap',
                        })}
                    </g>
                </g>
            ) : null}
            {showTravelingTopCap && movingTopCapModel ? (
                <g
                    pointerEvents="none"
                    aria-hidden="true"
                    data-testid="gauge-circular-top-cap"
                    data-segment-key={String(movingTopCapModel.key)}
                    data-cycle-key={String(travelingTopCapCycleKey)}
                    data-duration={`${travelingTopCapDurationSeconds}s`}
                    data-progress={movingTopCapModel.progress.toFixed(4)}
                    data-cap-angle={movingTopCapModel.angleDegrees.toFixed(2)}
                    data-cap-x={movingTopCapModel.x.toFixed(2)}
                    data-cap-y={movingTopCapModel.y.toFixed(2)}
                    data-effect-aura={String(travelingTopCapEffects.auraIntensity)}
                    data-effect-halo={String(travelingTopCapEffects.haloIntensity)}
                    data-effect-highlight={String(travelingTopCapEffects.highlightIntensity)}
                    data-effect-blur={String(travelingTopCapEffects.blur)}
                    data-effect-extension={String(travelingTopCapEffects.extension)}
                    data-effect-thickness={String(travelingTopCapEffects.thickness)}
                    data-shape-pill={String(travelingTopCapShape.pill)}
                    style={{ mixBlendMode: 'screen' }}
                >
                    {renderCircularTopCapGlowStack({
                        filterId: travelingTopCapGlowFilterId,
                        cap: movingTopCapModel,
                        effects: travelingTopCapEffects,
                        cornerRadiusMultiplier: travelingTopCapCornerRadiusMultiplier,
                        travelingTuning: true,
                    })}
                </g>
            ) : null}
            {circularContent && (
                <g transform={`rotate(90 ${center} ${center})`} data-testid="gauge-circular-center-content">
                    {circularContent({ center, radius, viewBoxSize, renderedSize })}
                </g>
            )}
        </svg>
    );
}

function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }

        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handleChange = (event: MediaQueryListEvent) => {
            setPrefersReducedMotion(event.matches);
        };

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange);

            return () => {
                mediaQuery.removeEventListener('change', handleChange);
            };
        }

        mediaQuery.addListener(handleChange);

        return () => {
            mediaQuery.removeListener(handleChange);
        };
    }, []);

    return prefersReducedMotion;
}

function useTravelingEffectCycle({
    enabled,
    durationSeconds,
}: {
    enabled: boolean;
    durationSeconds: number;
}) {
    const prefersReducedMotion = usePrefersReducedMotion();
    const [cycleKey, setCycleKey] = useState(0);
    const cycleSignature = `${enabled}:${prefersReducedMotion}:${cycleKey}:${durationSeconds}`;
    const [cycleState, setCycleState] = useState(() => ({
        cycleSignature,
        progress: 0,
        isPaused: false,
    }));

    useEffect(() => {
        if (!enabled || prefersReducedMotion) {
            return undefined;
        }

        const travelDurationMs = durationSeconds * 1000;
        const randomPauseMs = resolveTravelingTopCapPauseMs();
        let travelStartTime: number | null = null;
        let animationFrameId = 0;

        const animateTravelingEffect = (now: number) => {
            if (travelStartTime === null) {
                travelStartTime = now;
            }

            const nextProgress = clamp(now - travelStartTime, 0, travelDurationMs) / travelDurationMs;

            setCycleState({
                cycleSignature,
                progress: nextProgress,
                isPaused: false,
            });

            if (nextProgress < 1) {
                animationFrameId = window.requestAnimationFrame(animateTravelingEffect);
            }
        };

        animationFrameId = window.requestAnimationFrame(animateTravelingEffect);

        const hideTimerId = window.setTimeout(() => {
            setCycleState({
                cycleSignature,
                progress: 1,
                isPaused: true,
            });
        }, travelDurationMs);
        const restartTimerId = window.setTimeout(() => {
            setCycleKey((current) => current + 1);
        }, travelDurationMs + randomPauseMs);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
            window.clearTimeout(hideTimerId);
            window.clearTimeout(restartTimerId);
        };
    }, [cycleKey, cycleSignature, durationSeconds, enabled, prefersReducedMotion]);

    const isCurrentCycleState = cycleState.cycleSignature === cycleSignature;

    return {
        prefersReducedMotion,
        cycleKey,
        progress: !enabled || prefersReducedMotion || !isCurrentCycleState ? 0 : cycleState.progress,
        isPaused: !enabled || prefersReducedMotion || !isCurrentCycleState ? false : cycleState.isPaused,
    };
}

function resolveTravelingTopCapDurationSeconds(pathLength: number) {
    if (!Number.isFinite(pathLength) || pathLength <= 0) {
        return TRAVELING_TOP_CAP_DURATION_MIN_SECONDS;
    }

    return clamp(
        pathLength / TRAVELING_TOP_CAP_SPEED_PX_PER_SECOND,
        TRAVELING_TOP_CAP_DURATION_MIN_SECONDS,
        TRAVELING_TOP_CAP_DURATION_MAX_SECONDS,
    );
}

function resolveTravelingTopCapPauseMs(randomValue = Math.random()) {
    return Math.round(
        TRAVELING_TOP_CAP_PAUSE_MIN_MS
        + (randomValue * (TRAVELING_TOP_CAP_PAUSE_MAX_MS - TRAVELING_TOP_CAP_PAUSE_MIN_MS)),
    );
}

function renderCircularTopCapGlowStack({
    filterId,
    cap,
    effects = DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
    collapseAtZero = false,
    cornerRadiusMultiplier = CIRCULAR_TOP_CAP_ROUNDED_CORNER_MULTIPLIER,
    testIdPrefix = 'gauge-circular-top-cap',
    travelingTuning = false,
}: {
    filterId: string;
    cap: {
        x: number;
        y: number;
        stroke: string;
        strokeWidth: number;
        capLength: number;
        angleDegrees: number;
        frame: {
            auraOpacity: number;
            auraFillOpacity: number;
            auraRadius: number;
            haloOpacity: number;
            haloFillOpacity: number;
            haloRadius: number;
            coreOpacity: number;
            coreRadius: number;
        };
    };
    effects?: ResolvedKpiFixedTopCapEffects | ResolvedKpiTravelingTopCapEffects;
    collapseAtZero?: boolean;
    cornerRadiusMultiplier?: number;
    testIdPrefix?: string;
    travelingTuning?: boolean;
}) {
    const normalizedAura = effects.auraIntensity / 100;
    const normalizedHalo = effects.haloIntensity / 100;
    const normalizedHighlight = effects.highlightIntensity / 100;
    const normalizedExtension = effects.extension / 100;
    const normalizedThickness = effects.thickness / 100;
    const glowBoost = resolveTopCapGlowBoost(effects.blur / 100, filterId);
    const effectRectMinimum = collapseAtZero ? 0 : CIRCULAR_TOP_CAP_MIN_LENGTH;
    const auraMaximumLength = travelingTuning
        ? resolveKpiTravelingTopCapMaximumLength('aura', cap.capLength, cap.strokeWidth)
        : Math.max(cap.capLength, cap.strokeWidth * CIRCULAR_TOP_CAP_AURA_LENGTH_MULTIPLIER);
    const haloMaximumLength = travelingTuning
        ? resolveKpiTravelingTopCapMaximumLength('halo', cap.capLength, cap.strokeWidth)
        : Math.max(cap.capLength, cap.strokeWidth * CIRCULAR_TOP_CAP_HALO_LENGTH_MULTIPLIER);
    const highlightMaximumLength = travelingTuning
        ? resolveKpiTravelingTopCapMaximumLength('highlight', cap.capLength, cap.strokeWidth)
        : cap.capLength * CIRCULAR_TOP_CAP_HIGHLIGHT_LENGTH_MULTIPLIER;
    const auraMinimumThickness = travelingTuning
        ? resolveKpiTravelingTopCapMinimumThickness('aura', cap.strokeWidth)
        : (collapseAtZero ? 0 : cap.strokeWidth);
    const haloMinimumThickness = travelingTuning
        ? resolveKpiTravelingTopCapMinimumThickness('halo', cap.strokeWidth)
        : (collapseAtZero ? 0 : cap.strokeWidth);
    const coreMinimumThickness = travelingTuning
        ? resolveKpiTravelingTopCapMinimumThickness('core', cap.strokeWidth)
        : 0;
    const highlightMinimumThickness = travelingTuning
        ? resolveKpiTravelingTopCapMinimumThickness('highlight', cap.strokeWidth)
        : (collapseAtZero ? 0 : 1.2);
    const coreStrokeMinimumThickness = travelingTuning
        ? resolveKpiTravelingTopCapMinimumThickness('coreStroke', cap.strokeWidth)
        : 0;
    const highlightColor = `color-mix(in srgb, ${cap.stroke} ${Math.round(TOP_CAP_VISUAL_TUNING.highlight.strokeMix * normalizedHighlight)}%, white)`;
    const coreStrokeWidth = Number((Math.max(cap.strokeWidth * CIRCULAR_TOP_CAP_CORE_STROKE_THICKNESS_MULTIPLIER, 1.2)).toFixed(2));
    const auraFillOpacity = Number(Math.min(
        (cap.frame.auraFillOpacity + (TOP_CAP_VISUAL_TUNING.aura.fillOpacityBoost * normalizedAura)) * normalizedAura,
        TOP_CAP_VISUAL_TUNING.aura.fillOpacityMax * normalizedAura,
    ).toFixed(3));
    const haloFillOpacity = Number(Math.min(
        (cap.frame.haloFillOpacity + (TOP_CAP_VISUAL_TUNING.halo.fillOpacityBoost * normalizedHalo)) * normalizedHalo,
        TOP_CAP_VISUAL_TUNING.halo.fillOpacityMax * normalizedHalo,
    ).toFixed(3));
    const coreHighlightOpacity = Number(Math.min(
        (TOP_CAP_VISUAL_TUNING.highlight.baseOpacity + (Math.max(cap.frame.coreOpacity - 0.78, 0) * 0.22)) * normalizedHighlight,
        TOP_CAP_VISUAL_TUNING.highlight.maxOpacity * normalizedHighlight,
    ).toFixed(3));
    const coreStrokeOpacity = Number(((0.6 + (Math.max(cap.frame.coreOpacity - 0.62, 0) * 0.24)) * normalizedHighlight).toFixed(3));
    const auraLineLength = interpolateEffectMetric(
        collapseAtZero ? 0 : cap.capLength,
        auraMaximumLength,
        normalizedExtension,
    );
    const haloLineLength = interpolateEffectMetric(
        collapseAtZero ? 0 : cap.capLength,
        haloMaximumLength,
        normalizedExtension,
    );
    const coreLineLength = collapseAtZero
        ? interpolateEffectMetric(0, cap.capLength, normalizedExtension)
        : cap.capLength;
    const highlightLineLength = interpolateEffectMetric(
        collapseAtZero ? 0 : CIRCULAR_TOP_CAP_MIN_LENGTH,
        highlightMaximumLength,
        normalizedExtension,
    );
    const auraStrokeWidth = interpolateEffectMetric(
        auraMinimumThickness,
        Math.max(
            cap.strokeWidth + (cap.frame.auraRadius * CIRCULAR_TOP_CAP_AURA_THICKNESS_EXPANSION_MULTIPLIER),
            cap.strokeWidth * CIRCULAR_TOP_CAP_AURA_THICKNESS_MULTIPLIER,
        ),
        normalizedThickness,
    );
    const haloStrokeWidth = interpolateEffectMetric(
        haloMinimumThickness,
        Math.max(
            cap.strokeWidth + (cap.frame.haloRadius * CIRCULAR_TOP_CAP_HALO_THICKNESS_EXPANSION_MULTIPLIER),
            cap.strokeWidth * CIRCULAR_TOP_CAP_HALO_THICKNESS_MULTIPLIER,
        ),
        normalizedThickness,
    );
    const coreHeight = collapseAtZero
        ? interpolateEffectMetric(0, Math.max(cap.strokeWidth * 0.96, cap.frame.coreRadius * 1.58), normalizedThickness)
        : interpolateEffectMetric(coreMinimumThickness, Math.max(cap.strokeWidth * 0.96, cap.frame.coreRadius * 1.58), normalizedThickness);
    const coreStrokeHeight = collapseAtZero
        ? interpolateEffectMetric(0, coreStrokeWidth, normalizedThickness)
        : interpolateEffectMetric(coreStrokeMinimumThickness, Math.max(coreStrokeWidth, CIRCULAR_TOP_CAP_MIN_LENGTH), normalizedThickness);
    const highlightHeight = interpolateEffectMetric(
        highlightMinimumThickness,
        cap.strokeWidth * CIRCULAR_TOP_CAP_HIGHLIGHT_THICKNESS_MULTIPLIER,
        normalizedThickness,
    );

    return (
        <>
            <rect
                {...resolveTopCapRect({
                    x: cap.x,
                    y: cap.y,
                    length: auraLineLength,
                    thickness: auraStrokeWidth,
                    angleDegrees: cap.angleDegrees,
                    minimumLength: effectRectMinimum,
                    minimumThickness: effectRectMinimum,
                    cornerRadiusMultiplier,
                })}
                fill={cap.stroke}
                opacity={Number((cap.frame.auraOpacity * normalizedAura).toFixed(3))}
                fillOpacity={auraFillOpacity}
                filter={glowBoost.filterUrl}
                data-testid={`${testIdPrefix}-aura`}
            />
            <rect
                {...resolveTopCapRect({
                    x: cap.x,
                    y: cap.y,
                    length: haloLineLength,
                    thickness: haloStrokeWidth,
                    angleDegrees: cap.angleDegrees,
                    minimumLength: effectRectMinimum,
                    minimumThickness: effectRectMinimum,
                    cornerRadiusMultiplier,
                })}
                fill={cap.stroke}
                opacity={Number((cap.frame.haloOpacity * normalizedHalo).toFixed(3))}
                fillOpacity={haloFillOpacity}
                filter={glowBoost.filterUrl}
                data-testid={`${testIdPrefix}-halo`}
            />
            <rect
                {...resolveTopCapRect({
                    x: cap.x,
                    y: cap.y,
                    length: coreLineLength,
                    thickness: coreHeight,
                    angleDegrees: cap.angleDegrees,
                    minimumLength: effectRectMinimum,
                    minimumThickness: effectRectMinimum,
                    cornerRadiusMultiplier,
                })}
                fill={cap.stroke}
                opacity={Number((cap.frame.coreOpacity * normalizedHighlight).toFixed(3))}
                data-testid={`${testIdPrefix}-core`}
            />
            <rect
                {...resolveTopCapRect({
                    x: cap.x,
                    y: cap.y,
                    length: highlightLineLength,
                    thickness: highlightHeight,
                    angleDegrees: cap.angleDegrees,
                    minimumLength: effectRectMinimum,
                    minimumThickness: effectRectMinimum,
                    cornerRadiusMultiplier,
                })}
                fill={highlightColor}
                opacity={coreHighlightOpacity}
                data-testid={`${testIdPrefix}-core-highlight`}
            />
            <rect
                {...resolveTopCapRect({
                    x: cap.x,
                    y: cap.y,
                    length: coreLineLength,
                    thickness: coreStrokeHeight,
                    angleDegrees: cap.angleDegrees,
                    minimumLength: effectRectMinimum,
                    minimumThickness: effectRectMinimum,
                    cornerRadiusMultiplier,
                })}
                fill={cap.stroke}
                opacity={Number((cap.frame.coreOpacity * normalizedHighlight).toFixed(3))}
                fillOpacity={coreStrokeOpacity}
                data-testid={`${testIdPrefix}-core-stroke`}
            />
        </>
    );
}

function interpolateEffectMetric(minimum: number, maximum: number, intensity: number) {
    return Number((minimum + ((maximum - minimum) * clamp(intensity, 0, 1))).toFixed(2));
}

function resolveTopCapGlowBoost(normalizedBlur: number, filterId?: string) {
    const clampedBlur = clamp(normalizedBlur, 0, 1);

    return {
        outerBlurStdDeviation: Number((TOP_CAP_VISUAL_TUNING.glow.outerBlurStdDeviation * clampedBlur).toFixed(2)),
        outerBloomAlphaMultiplier: Number((1 + ((TOP_CAP_VISUAL_TUNING.glow.outerBloomAlphaMultiplier - 1) * clampedBlur)).toFixed(2)),
        innerBlurStdDeviation: Number((TOP_CAP_VISUAL_TUNING.glow.innerBlurStdDeviation * clampedBlur).toFixed(2)),
        filterUrl: clampedBlur > 0 && filterId ? `url(#${filterId})` : undefined,
    };
}

function resolveTopCapRect({
    x,
    y,
    length,
    thickness,
    angleDegrees,
    minimumLength = CIRCULAR_TOP_CAP_MIN_LENGTH,
    minimumThickness = CIRCULAR_TOP_CAP_MIN_LENGTH,
    cornerRadiusMultiplier = CIRCULAR_TOP_CAP_ROUNDED_CORNER_MULTIPLIER,
}: {
    x: number;
    y: number;
    length: number;
    thickness: number;
    angleDegrees: number;
    minimumLength?: number;
    minimumThickness?: number;
    cornerRadiusMultiplier?: number;
}) {
    const safeLength = Math.max(length, minimumLength);
    const safeThickness = Math.max(thickness, minimumThickness);

    return {
        x: x - (safeLength / 2),
        y: y - (safeThickness / 2),
        width: safeLength,
        height: safeThickness,
        rx: safeThickness * cornerRadiusMultiplier,
        ry: safeThickness * cornerRadiusMultiplier,
        transform: `rotate(${angleDegrees} ${x} ${y})`,
    };
}

function resolveCircularTangentAngleDegrees(angleRadians: number) {
    return ((angleRadians * 180) / Math.PI) + 90;
}

function resolveCircularTravelingTopCapPosition({
    key,
    stroke,
    visibleArcLength,
    progress,
    strokeWidth,
    circumference,
    center,
    radius,
}: {
    key: number;
    stroke: string;
    visibleArcLength: number;
    progress: number;
    strokeWidth: number;
    circumference: number;
    center: number;
    radius: number;
}) {
    if (circumference <= 0 || visibleArcLength <= 0) {
        return null;
    }

    const capLength = Math.min(
        Math.max(strokeWidth * CIRCULAR_TOP_CAP_CORE_LENGTH_MULTIPLIER, CIRCULAR_TOP_CAP_MIN_LENGTH),
        visibleArcLength,
    );
    const travelLength = Math.max(visibleArcLength - capLength, 0);
    const normalizedProgress = clamp(progress, 0, 1);
    const capStartDistance = travelLength * normalizedProgress;
    const angleRadians = (capStartDistance / circumference) * Math.PI * 2;

    return {
        key,
        stroke,
        strokeWidth: Number((strokeWidth * CIRCULAR_TOP_CAP_CORE_THICKNESS_MULTIPLIER).toFixed(2)),
        capLength: Number(capLength.toFixed(2)),
        progress: normalizedProgress,
        angleRadians,
        angleDegrees: (angleRadians * 180) / Math.PI,
        tangentAngleDegrees: resolveCircularTangentAngleDegrees(angleRadians),
        x: center + (Math.cos(angleRadians) * radius),
        y: center + (Math.sin(angleRadians) * radius),
        frame: resolveTravelingTopCapGlowFrame(normalizedProgress),
    };
}

function resolveCircularStaticTopCapPosition({
    key,
    stroke,
    visibleArcLength,
    strokeWidth,
    circumference,
    center,
    radius,
}: {
    key: number;
    stroke: string;
    visibleArcLength: number;
    strokeWidth: number;
    circumference: number;
    center: number;
    radius: number;
}) {
    if (circumference <= 0 || visibleArcLength <= 0) {
        return null;
    }

    const angleRadians = (visibleArcLength / circumference) * Math.PI * 2;
    const capLength = Math.min(
        Math.max(strokeWidth * CIRCULAR_TOP_CAP_CORE_LENGTH_MULTIPLIER, CIRCULAR_TOP_CAP_MIN_LENGTH),
        visibleArcLength,
    );
    const effectBaseLength = Math.min(
        Math.max(strokeWidth * STATIC_TOP_CAP_EFFECT_BASE_LENGTH_MULTIPLIER, CIRCULAR_TOP_CAP_MIN_LENGTH),
        visibleArcLength,
    );
    const effectBaseThickness = Number((strokeWidth * STATIC_TOP_CAP_EFFECT_BASE_THICKNESS_MULTIPLIER).toFixed(2));

    return {
        key,
        stroke,
        strokeWidth: Number((strokeWidth * CIRCULAR_TOP_CAP_CORE_THICKNESS_MULTIPLIER).toFixed(2)),
        capLength: Number(capLength.toFixed(2)),
        angleRadians,
        angleDegrees: (angleRadians * 180) / Math.PI,
        tangentAngleDegrees: resolveCircularTangentAngleDegrees(angleRadians),
        x: center + (Math.cos(angleRadians) * radius),
        y: center + (Math.sin(angleRadians) * radius),
        effectBaseLength: Number(effectBaseLength.toFixed(2)),
        effectBaseThickness,
        frame: resolveStaticTopCapGlowFrame(),
    };
}

function interpolateTravelingGlowValue(progress: number, keyTimes: readonly number[], values: readonly number[]) {
    const clampedProgress = clamp(progress, 0, 1);

    for (let index = 1; index < keyTimes.length; index += 1) {
        const startTime = keyTimes[index - 1] ?? 0;
        const endTime = keyTimes[index] ?? 1;

        if (clampedProgress <= endTime) {
            const startValue = values[index - 1] ?? values[0] ?? 0;
            const endValue = values[index] ?? startValue;
            const segmentProgress = endTime === startTime ? 1 : (clampedProgress - startTime) / (endTime - startTime);

            return startValue + ((endValue - startValue) * clamp(segmentProgress, 0, 1));
        }
    }

    return values.at(-1) ?? 0;
}

function resolveTravelingTopCapGlowFrame(progress: number) {
    return {
        auraOpacity: interpolateTravelingGlowValue(progress, [0, 0.08, 0.7, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.auraOpacity),
        auraFillOpacity: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.auraFillOpacity),
        auraRadius: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.auraRadius),
        haloOpacity: interpolateTravelingGlowValue(progress, [0, 0.08, 0.72, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.haloOpacity),
        haloFillOpacity: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.haloFillOpacity),
        haloRadius: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.haloRadius),
        coreOpacity: interpolateTravelingGlowValue(progress, [0, 0.08, 0.72, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.coreOpacity),
        coreRadius: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], TOP_CAP_VISUAL_TUNING.frame.coreRadius),
    };
}

function resolveStaticTopCapGlowFrame() {
    return resolveTravelingTopCapGlowFrame(STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS);
}

export { BAR_HEIGHT, CIRCULAR_DIAMETER, CIRCULAR_RADIUS, CIRCULAR_VIEWBOX_SIZE, STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS };
