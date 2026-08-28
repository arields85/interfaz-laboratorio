import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import type { KpiWidgetConfig, ThresholdRule } from '../../domain/admin.types';
import type { PresentationPayload } from '../../domain/dashboardPresentation.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { resolveBinding } from '../resolvers/bindingResolver';
import { Activity, Thermometer, Zap, Droplet, Wind, Settings, Gauge, Fan, FoldVertical, HelpCircle, HeartPulse, Siren, Wifi, BarChart2, LineChart, type LucideIcon } from 'lucide-react';
import GaugeDisplay from '../../components/ui/GaugeDisplay';
import WidgetHeader from '../../components/ui/WidgetHeader';
import WidgetCenteredContentLayout from '../../components/ui/WidgetCenteredContentLayout';
import {
    DEFAULT_GAUGE_VALUE_FONT_SIZE,
    resolveActivityAnalyticsDonutCenterValueFontSize,
} from '../../utils/activityAnalyticsWidgetDefaults';
import {
    DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY,
    FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
    resolveMachineActivityFixedTopCapEffects,
    resolveKpiFixedTopCapShape,
    resolveKpiTravelingTopCapEffects,
    resolveKpiTravelingTopCapShape,
} from '../../utils/kpiTopCapEffects';
import { resolveStoredTravelingTopCapActualSpeedRange } from '../../utils/travelingTopCapSpeed';
import { resolveWidgetDataMode } from '../../utils/widgetDataMode';

const ICON_MAP: Record<string, LucideIcon> = {
    'Gauge': Gauge,
    'Activity': Activity,
    'Thermometer': Thermometer,
    'Zap': Zap,
    'Droplet': Droplet,
    'Wind': Wind,
    'Settings': Settings,
    'Fan': Fan,
    'FoldVertical': FoldVertical,
    'HeartPulse': HeartPulse,
    'Siren': Siren,
    'Wifi': Wifi,
    'BarChart2': BarChart2,
    'LineChart': LineChart,
};

const WIDGET_VALUE_TEXT_STYLE = {
    fontFamily: 'var(--font-widget-value-gauge)',
    fontWeight: 'var(--font-weight-widget-value-gauge)',
    fontSize: 'var(--font-size-widget-value-gauge)',
    letterSpacing: 'var(--tracking-widget-value-gauge)',
} as const;

const WIDGET_UNIT_TEXT_STYLE = {
    fontFamily: 'var(--font-widget-value-gauge)',
    fontWeight: 'var(--font-weight-widget-value-gauge)',
    fontSize: 'var(--font-size-widget-unit-gauge)',
    letterSpacing: 'var(--tracking-widget-value-gauge)',
} as const;

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
        const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);

        handleChange();
        mediaQuery.addEventListener?.('change', handleChange);
        mediaQuery.addListener?.(handleChange);

        return () => {
            mediaQuery.removeEventListener?.('change', handleChange);
            mediaQuery.removeListener?.(handleChange);
        };
    }, []);

    return prefersReducedMotion;
}

function resolveKpiVisualAnimationDuration(delta: number) {
    const normalizedDelta = Math.min(Math.abs(delta), 100);

    return Math.round(280 + (normalizedDelta * 7.2));
}

interface KpiWidgetProps {
    widget: KpiWidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
    presentationData?: PresentationPayload;
}

type CircularTopCapConfig = NonNullable<ComponentProps<typeof GaugeDisplay>['circularTopCap']>;

type CircularKpiProps = {
    value: number | null;
    min: number;
    max: number;
    unit?: string;
    dynamicColor?: boolean;
    thresholds?: ThresholdRule[];
    valueTextStyle: CSSProperties;
    fixedTopCapEffects: ReturnType<typeof resolveMachineActivityFixedTopCapEffects>;
    fixedTopCapShape: ReturnType<typeof resolveKpiFixedTopCapShape>;
    travelingTopCapEffects: ReturnType<typeof resolveKpiTravelingTopCapEffects>;
    travelingTopCapShape: ReturnType<typeof resolveKpiTravelingTopCapShape>;
    circularArcGlowIntensity: number;
    travelingTopCapSpeed: ReturnType<typeof resolveStoredTravelingTopCapActualSpeedRange>;
    staticPulseStabilityMax: number;
};

function createCircularTopCapConfig({
    fixedTopCapEffects,
    fixedTopCapShape,
    travelingTopCapEffects,
    travelingTopCapShape,
    travelingTopCapSpeed,
    staticPulseStabilityMax,
}: Pick<CircularKpiProps,
    | 'fixedTopCapEffects'
    | 'fixedTopCapShape'
    | 'travelingTopCapEffects'
    | 'travelingTopCapShape'
    | 'travelingTopCapSpeed'
    | 'staticPulseStabilityMax'
>): CircularTopCapConfig {
    return {
        enabled: true,
        staticShape: fixedTopCapShape,
        staticEffects: fixedTopCapEffects,
        staticPulseStabilityMax,
        staticBlinkTrigger: 'travel-completion',
        travelingShape: travelingTopCapShape,
        travelingEffects: travelingTopCapEffects,
        travelingSpeed: travelingTopCapSpeed,
    };
}

export default function KpiWidget({ widget, equipmentMap, machines, isLoadingData, className, presentationData }: KpiWidgetProps) {
    const dataMode = resolveWidgetDataMode(widget) ?? undefined;

    const presented = presentationData as (PresentationPayload & { binding?: ReturnType<typeof resolveBinding> }) | undefined;
    const resolved = presented?.binding ?? resolveBinding(widget, equipmentMap, machines);
    
    const numericValue = resolved.value == null
        ? null
        : typeof resolved.value === 'number'
            ? resolved.value
            : typeof resolved.value === 'string'
                ? (() => {
                    const parsed = parseFloat(resolved.value);
                    return Number.isNaN(parsed) ? 0 : parsed;
                })()
                : 0;

    const opts = widget.displayOptions;
    const mode = opts?.kpiMode ?? 'circular';
    const valueTextFontSize = resolveActivityAnalyticsDonutCenterValueFontSize(opts?.valueFontSize)
        ?? DEFAULT_GAUGE_VALUE_FONT_SIZE;
    const valueTextStyle = {
        ...WIDGET_VALUE_TEXT_STYLE,
        fontSize: `${valueTextFontSize}px`,
    };
    const min = opts?.min ?? 0;
    const max = opts?.max ?? 100;
    const fixedTopCapEffects = resolveMachineActivityFixedTopCapEffects(opts?.fixedTopCapEffects);
    const fixedTopCapShape = resolveKpiFixedTopCapShape(opts?.fixedTopCapShape);
    const travelingTopCapEffects = resolveKpiTravelingTopCapEffects(opts?.travelingTopCapEffects);
    const travelingTopCapShape = resolveKpiTravelingTopCapShape(opts?.travelingTopCapShape);
    const travelingTopCapSpeed = resolveStoredTravelingTopCapActualSpeedRange({
        min: opts?.travelingTopCapMinSpeed,
        max: opts?.travelingTopCapMaxSpeed,
    });
    const prefersReducedMotion = usePrefersReducedMotion();
    const isSimulatedBinding = widget.binding?.mode === 'simulated_value';
    const bindingUnit = widget.binding?.unit?.trim() ?? '';
    const resolvedUnit = resolved.unit?.trim() ?? '';
    const customUnit = opts?.unit?.trim() ?? '';
    const simulatedUnit = bindingUnit || customUnit;
    const liveUnit = isSimulatedBinding
        ? simulatedUnit
        : (resolvedUnit || bindingUnit);

    const unit = opts?.unitOverride
        ? (isSimulatedBinding ? simulatedUnit : customUnit)
        : liveUnit;
    const iconSetting = opts?.icon;
    const isPendingIconSelection = iconSetting === undefined;
    const isNoIconSelection = iconSetting === null;
    const configuredIcon = typeof iconSetting === 'string' ? ICON_MAP[iconSetting] : undefined;
    const isInvalidConfiguredIcon = typeof iconSetting === 'string' && configuredIcon === undefined;

    const Icon = isPendingIconSelection
        ? HelpCircle
        : isNoIconSelection
          ? undefined
          : configuredIcon ?? HelpCircle;

    // subtitle: texto en el HEADER (debajo del título). Solo desde displayOptions.subtitle.
    // subtext:  texto en el FOOTER (parte inferior). Solo desde displayOptions.subtext.
    // Son conceptos distintos. No existe fallback entre ellos.
    const subtitle = opts?.subtitle;
    const footerSubtext = opts?.subtext;

    // Color de ícono y subtítulo de header: variable CSS según estado
    const isDynamic = !!opts?.dynamicColor;
    const dynamicMode = isDynamic && numericValue !== null ? getDynamicColors(numericValue, widget.thresholds) : null;
    const iconColor = isPendingIconSelection || isInvalidConfiguredIcon
        ? 'var(--color-industrial-muted)'
        : dynamicMode
          ? dynamicMode.textColor
          : 'var(--color-widget-icon)';
    const [displayedValue, setDisplayedValue] = useState(numericValue);
    const displayedValueRef = useRef(numericValue);
    const animationFrameRef = useRef<number | null>(null);

    /* eslint-disable react-hooks/set-state-in-effect -- animation state must synchronize immediately when the source value changes. */
    useEffect(() => {
        displayedValueRef.current = displayedValue;
    }, [displayedValue]);

    useEffect(() => {
        if (mode !== 'circular' || numericValue === null || prefersReducedMotion) {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }

            setDisplayedValue(numericValue);
            displayedValueRef.current = numericValue;
            return undefined;
        }

        const startValue = displayedValueRef.current;

        if (startValue === null || startValue === numericValue) {
            setDisplayedValue(numericValue);
            displayedValueRef.current = numericValue;
            return undefined;
        }

        const delta = numericValue - startValue;
        const startTime = performance.now();
        const duration = resolveKpiVisualAnimationDuration(delta);

        const animate = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const easedProgress = 1 - Math.pow(1 - progress, 2);
            const nextValue = startValue + (delta * easedProgress);

            displayedValueRef.current = nextValue;
            setDisplayedValue(nextValue);

            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(animate);
                return;
            }

            displayedValueRef.current = numericValue;
            setDisplayedValue(numericValue);
            animationFrameRef.current = null;
        };

        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
        }

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [mode, numericValue, prefersReducedMotion]);
    /* eslint-enable react-hooks/set-state-in-effect */

    if (isLoadingData) {
        return (
            <div className={`p-5 rounded-3xl bg-industrial-surface border border-industrial-border animate-pulse ${className ?? ''}`}>
                <WidgetHeader title={widget.title ?? 'KPI'} dataMode={dataMode} className="mb-2" />
                <div className="h-20 w-full bg-industrial-hover rounded-full" />
            </div>
        );
    }

    return (
        <div className={`p-5 glass-panel group relative w-full h-full ${className ?? ''}`}>
            <WidgetCenteredContentLayout
                headerOffsetClassName="-translate-y-1"
                contentClassName="translate-y-3"
                header={(
                    <WidgetHeader
                        title={widget.title ?? 'KPI'}
                        icon={Icon}
                        iconColor={iconColor}
                        subtitle={subtitle}
                        dataMode={dataMode}
                        alignment="none"
                        className="mb-2"
                    />
                )}
            >
                <div className="w-full h-full min-h-0">
                    {mode === 'circular' ? (
                        <CircularKpi
                            value={displayedValue}
                            min={min}
                            max={max}
                            unit={unit}
                            dynamicColor={!!opts?.dynamicColor}
                            thresholds={widget.thresholds}
                            valueTextStyle={valueTextStyle}
                            fixedTopCapEffects={fixedTopCapEffects}
                            fixedTopCapShape={fixedTopCapShape}
                            travelingTopCapEffects={travelingTopCapEffects}
                            travelingTopCapShape={travelingTopCapShape}
                            circularArcGlowIntensity={opts?.circularArcGlowIntensity ?? DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY}
                            travelingTopCapSpeed={travelingTopCapSpeed}
                            staticPulseStabilityMax={FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX}
                        />
                    ) : (
                        <BarKpi value={numericValue} min={min} max={max} unit={unit} dynamicColor={!!opts?.dynamicColor} thresholds={widget.thresholds} valueTextStyle={valueTextStyle} />
                    )}
                </div>
            </WidgetCenteredContentLayout>

            {/* Footer subtext — texto aclaratorio inferior, sin alterar el centrado del KPI */}
            {footerSubtext && (
                <div className="absolute left-5 bottom-3 z-20 uppercase leading-none text-industrial-muted truncate max-w-[calc(100%-2.5rem)]">
                    {footerSubtext}
                </div>
            )}
        </div>
    );
}

function getDynamicColors(value: number, thresholds?: ThresholdRule[]) {
    if (!thresholds || thresholds.length === 0) return null;
    
    const criticalRule = thresholds.find(t => t.severity === 'critical');
    const warningRule = thresholds.find(t => t.severity === 'warning');

    // Basado en requerimientos del usuario para mayor profundidad y semántica
    if (criticalRule && value >= criticalRule.value) {
        return { 
            svgColor: 'url(#kpi-critical-gradient)', 
            cssColor: 'linear-gradient(90deg, var(--color-dynamic-critical-from), var(--color-dynamic-critical-to))', 
            glow: 'color-mix(in srgb, var(--color-accent-ruby) 50%, transparent)',
            textColor: 'var(--color-status-critical)'
        };
    }
    if (warningRule && value >= warningRule.value) {
        return { 
            svgColor: 'url(#kpi-warning-gradient)', 
            cssColor: 'linear-gradient(90deg, var(--color-dynamic-warning-from), var(--color-dynamic-warning-to))', 
            glow: 'color-mix(in srgb, var(--color-accent-amber) 50%, transparent)',
            textColor: 'var(--color-status-warning)'
        };
    }
    return { 
        svgColor: 'url(#kpi-normal-gradient)', 
        cssColor: 'linear-gradient(90deg, var(--color-dynamic-normal-from), var(--color-dynamic-normal-to))', 
        glow: 'color-mix(in srgb, var(--color-accent-green) 50%, transparent)',
        textColor: 'var(--color-status-normal)'
    };
}

function getGaugeVisuals(value: number | null, dynamicColor?: boolean, thresholds?: ThresholdRule[]) {
    const dynamicMode = dynamicColor && value !== null ? getDynamicColors(value, thresholds) : null;

    if (dynamicMode) {
        if (dynamicMode.svgColor === 'url(#kpi-critical-gradient)') {
            return {
                color: {
                    primary: dynamicMode.glow,
                    gradient: ['var(--color-dynamic-critical-from)', 'var(--color-dynamic-critical-to)'] as [string, string],
                },
            };
        }

        if (dynamicMode.svgColor === 'url(#kpi-warning-gradient)') {
            return {
                color: {
                    primary: dynamicMode.glow,
                    gradient: ['var(--color-dynamic-warning-from)', 'var(--color-dynamic-warning-to)'] as [string, string],
                },
            };
        }

        return {
            color: {
                primary: dynamicMode.glow,
                gradient: ['var(--color-dynamic-normal-from)', 'var(--color-dynamic-normal-to)'] as [string, string],
            },
        };
    }

    return {
        color: {
            primary: 'color-mix(in srgb, var(--color-accent-purple) 40%, transparent)',
            gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'] as [string, string],
        },
    };
}

function CircularKpi(props: CircularKpiProps) {
    const {
        value,
        min,
        max,
        unit,
        dynamicColor,
        thresholds,
        valueTextStyle,
        circularArcGlowIntensity,
    } = props;
    const safeValue = value ?? min;
    const clamp = Math.min(Math.max(safeValue, min), max);
    const range = max - min;
    const normalizedValue = range === 0 ? 0 : (clamp - min) / range;
    const gaugeVisuals = getGaugeVisuals(value, dynamicColor, thresholds);
    const circularTopCapConfig = createCircularTopCapConfig(props);

    return (
        <div className="relative flex items-center justify-center w-full h-full min-h-[140px]">
            <GaugeDisplay
                normalizedValue={normalizedValue}
                gradientNormalized={1}
                color={gaugeVisuals.color}
                mode="circular"
                circularBaseSegmentLinecap="butt"
                circularArcGlowIntensity={circularArcGlowIntensity}
                circularTopCap={circularTopCapConfig}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-white leading-none mb-1" style={valueTextStyle}>{value === null ? '--' : value % 1 !== 0 ? value.toFixed(1) : value}</span>
                {unit && value !== null && <span className="text-industrial-muted uppercase" style={WIDGET_UNIT_TEXT_STYLE}>{unit}</span>}
            </div>
        </div>
    );
}

function BarKpi({ value, min, max, unit, dynamicColor, thresholds, valueTextStyle }: { value: number | null, min: number, max: number, unit?: string, dynamicColor?: boolean, thresholds?: ThresholdRule[], valueTextStyle: CSSProperties }) {
    const safeValue = value ?? min;
    const clamp = Math.min(Math.max(safeValue, min), max);
    const range = max - min;
    const normalizedValue = range === 0 ? 0 : (clamp - min) / range;
    const gaugeVisuals = getGaugeVisuals(value, dynamicColor, thresholds);

    return (
        <div className="flex flex-col w-full h-full justify-center px-2">
            <div className="flex items-baseline gap-2 mb-3">
                <span className="text-white leading-none" style={valueTextStyle}>{value === null ? '--' : value % 1 !== 0 ? value.toFixed(1) : value}</span>
                {unit && value !== null && <span className="text-industrial-muted uppercase" style={WIDGET_UNIT_TEXT_STYLE}>{unit}</span>}
            </div>
            
            <GaugeDisplay
                normalizedValue={normalizedValue}
                color={gaugeVisuals.color}
                mode="bar"
            />
            
            <div className="flex justify-between items-center mt-3 uppercase text-industrial-muted">
                <span>{min} {unit}</span>
                <span>{max} {unit}</span>
            </div>
        </div>
    );
}
