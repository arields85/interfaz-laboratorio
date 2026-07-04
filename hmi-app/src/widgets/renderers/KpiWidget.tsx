import type { CSSProperties } from 'react';
import type { KpiWidgetConfig, ThresholdRule } from '../../domain/admin.types';
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
    resolveKpiFixedTopCapEffects,
    resolveKpiFixedTopCapShape,
    resolveKpiTravelingTopCapEffects,
    resolveKpiTravelingTopCapShape,
} from '../../utils/kpiTopCapEffects';

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

interface KpiWidgetProps {
    widget: KpiWidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
}

export default function KpiWidget({ widget, equipmentMap, machines, isLoadingData, className }: KpiWidgetProps) {
    if (isLoadingData) {
        return (
            <div className={`p-5 rounded-3xl bg-industrial-surface border border-industrial-border animate-pulse ${className ?? ''}`}>
                <div className="h-4 w-24 bg-industrial-hover rounded mb-6" />
                <div className="h-20 w-full bg-industrial-hover rounded-full" />
            </div>
        );
    }

    const resolved = resolveBinding(widget, equipmentMap, machines);
    
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
    const fixedTopCapEffects = resolveKpiFixedTopCapEffects(opts?.fixedTopCapEffects);
    const fixedTopCapShape = resolveKpiFixedTopCapShape(opts?.fixedTopCapShape);
    const travelingTopCapEffects = resolveKpiTravelingTopCapEffects(opts?.travelingTopCapEffects);
    const travelingTopCapShape = resolveKpiTravelingTopCapShape(opts?.travelingTopCapShape);
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
                        alignment="none"
                        className="mb-2"
                    />
                )}
            >
                <div className="w-full h-full min-h-0">
                    {mode === 'circular' ? (
                        <CircularKpi value={numericValue} min={min} max={max} unit={unit} dynamicColor={!!opts?.dynamicColor} thresholds={widget.thresholds} valueTextStyle={valueTextStyle} fixedTopCapEffects={fixedTopCapEffects} fixedTopCapShape={fixedTopCapShape} travelingTopCapEffects={travelingTopCapEffects} travelingTopCapShape={travelingTopCapShape} />
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

function CircularKpi({ value, min, max, unit, dynamicColor, thresholds, valueTextStyle, fixedTopCapEffects, fixedTopCapShape, travelingTopCapEffects, travelingTopCapShape }: { value: number | null, min: number, max: number, unit?: string, dynamicColor?: boolean, thresholds?: ThresholdRule[], valueTextStyle: CSSProperties, fixedTopCapEffects: ReturnType<typeof resolveKpiFixedTopCapEffects>, fixedTopCapShape: ReturnType<typeof resolveKpiFixedTopCapShape>, travelingTopCapEffects: ReturnType<typeof resolveKpiTravelingTopCapEffects>, travelingTopCapShape: ReturnType<typeof resolveKpiTravelingTopCapShape> }) {
    const safeValue = value ?? min;
    const clamp = Math.min(Math.max(safeValue, min), max);
    const range = max - min;
    const normalizedValue = range === 0 ? 0 : (clamp - min) / range;
    const gaugeVisuals = getGaugeVisuals(value, dynamicColor, thresholds);

    return (
        <div className="relative flex items-center justify-center w-full h-full min-h-[140px]">
            <GaugeDisplay
                normalizedValue={normalizedValue}
                gradientNormalized={1}
                color={gaugeVisuals.color}
                mode="circular"
                circularBaseSegmentLinecap="butt"
                circularTopCap={{ enabled: true, staticShape: fixedTopCapShape, staticEffects: fixedTopCapEffects, travelingShape: travelingTopCapShape, travelingEffects: travelingTopCapEffects }}
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
