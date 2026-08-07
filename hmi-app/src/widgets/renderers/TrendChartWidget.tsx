import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EquipmentSummary } from '../../domain/equipment.types';
import {
    HISTORY_RANGES,
    HISTORY_RANGE_LABELS,
    type ContractMachine,
    type DataHistoryResponse,
    type HistoryQueryParams,
    type HistoryRange,
} from '../../domain/dataContract.types';
import { TrendingUp } from 'lucide-react';
import type { TrendChartDisplayOptions, TrendChartWidgetConfig, ThresholdRule } from '../../domain/admin.types';
import { isDataHistoryEnabled } from '../../config/dataConnection.config';
import { isDataHistoryResponseCompatible, useDataHistory } from '../../queries/useDataHistory';
import { resolveBinding } from '../resolvers/bindingResolver';
import { generateTrendData } from '../../utils/trendDataGenerator';
import {
    clamp,
    getChartLetterSpacingPx,
    getChartTextFont,
} from '../../utils/chartHelpers';
import WidgetHeader from '../../components/ui/WidgetHeader';
import WidgetHeaderTemporalControls from '../../components/ui/WidgetHeaderTemporalControls';
import ChartTooltip from '../../components/ui/ChartTooltip';
import type { ChartTooltipSeries } from '../../components/ui/ChartTooltip';
import WidgetRuntimeState from '../../components/ui/WidgetRuntimeState';
import HistoricalChartNotice from '../../components/ui/HistoricalChartNotice';
import WidgetChartLayout from '../../components/ui/WidgetChartLayout';
import {
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
} from '../../components/ui/WidgetChartLayout.shared';
import { isDataHistoryConnectionError } from '../../services/dataHistory.service';
import TrendChartLegacyInteractionLayer from './TrendChartLegacyInteractionLayer';
import {
    buildTrendChartLegacyModel,
    mapTrendChartLegacyHistory,
    type TrendChartLegacyDataPoint,
} from './trendChartLegacyModel';

const SYSTEM_TEXT_STYLE = {
    fontSize: 'var(--font-size-system)',
    fontFamily: 'var(--font-system)',
    fontWeight: 'var(--font-weight-system)',
    letterSpacing: 'var(--tracking-system)',
} as const;

// =============================================================================
// TrendChartWidget
// Renderer para widgets de tipo 'trend-chart'.
// Renderiza un gráfico de tendencia temporal en SVG puro.
//
// Datos: consume histórico real cuando está disponible y conserva
// generateTrendData como fallback visual para bindings sin endpoint.
//
// Estética: Dark Industrial Theme con gradientes del sistema de tokens.
// Colores: NUNCA hardcodeados — siempre via var(--color-*) del @theme {}.
// =============================================================================

const TOKEN = {
    gradientFrom: 'var(--color-widget-gradient-from)',
    gradientTo: 'var(--color-widget-gradient-to)',
    lineGlow: 'drop-shadow(0 0 18px color-mix(in srgb, var(--color-widget-gradient-from) 55%, transparent))',
    statusCritical: 'var(--color-status-critical)',
    statusWarning: 'var(--color-status-warning)',
    background: 'var(--color-industrial-bg)',
    border: 'var(--color-industrial-border)',
    muted: 'var(--color-industrial-muted)',
    grid: 'var(--color-chart-grid)',
    icon: 'var(--color-widget-icon)',
} as const;

const DEFAULT_LINE_STROKE_WIDTH = 2.5;
const DEFAULT_LINE_GLOW_BLUR = 3;
const MIN_LINE_STROKE_WIDTH = 0.5;
const MAX_LINE_STROKE_WIDTH = 6;
const MIN_LINE_GLOW_BLUR = 0;
const MAX_LINE_GLOW_BLUR = 8;

function clampLineStrokeWidth(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_LINE_STROKE_WIDTH;
    }

    return clamp(value as number, MIN_LINE_STROKE_WIDTH, MAX_LINE_STROKE_WIDTH);
}

function clampLineGlowBlur(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_LINE_GLOW_BLUR;
    }

    return clamp(value as number, MIN_LINE_GLOW_BLUR, MAX_LINE_GLOW_BLUR);
}

interface TrendChartWidgetProps {
    widget: TrendChartWidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
}

interface TrendChartSvgProps {
    model: ReturnType<typeof buildTrendChartLegacyModel>;
    lineStrokeWidth: number;
    lineGlowBlur: number;
    hoveredIndex: number | null;
    onHoverChange: (index: number | null, x?: number) => void;
}

interface TrendChartContainerProps {
    widgetId: string;
    data: TrendChartLegacyDataPoint[];
    thresholds?: ThresholdRule[];
    seriesName: string;
    unit?: string;
    summary?: {
        min: number | null;
        max: number | null;
        avg: number | null;
    };
    lineStrokeWidth: number;
    lineGlowBlur: number;
}

interface TrendChartLegacyHistorySnapshot {
    ownerKey: string;
    selectionKey: string;
    revision: string;
    range: HistoryRange;
    data: TrendChartLegacyDataPoint[];
    response: DataHistoryResponse;
}

const HISTORY_RANGE_OPTIONS = HISTORY_RANGES.map((range) => ({
    value: range,
    label: HISTORY_RANGE_LABELS[range],
}));

function TrendChartSvg({ model, lineStrokeWidth, lineGlowBlur, hoveredIndex, onHoverChange }: TrendChartSvgProps) {
    const lineGradientId = `trend-line-grad-${model.widgetId}`;
    const colorGradientId = `trend-color-grad-${model.widgetId}`;
    const fadeGradientId = `trend-fade-grad-${model.widgetId}`;
    const maskId = `trend-mask-${model.widgetId}`;
    const glowId = `trend-glow-${model.widgetId}`;

    return (
        <WidgetChartLayout
            layout={model.layout}
            svgTestId="trend-chart-svg"
            overlaySvgTestId="trend-chart-overlay-svg"
            renderMain={(layout) => {
                return (
                    <>
                        <defs>
                            <linearGradient id={lineGradientId} x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor={TOKEN.gradientFrom} stopOpacity={0.7} />
                                <stop offset="100%" stopColor={TOKEN.gradientTo} stopOpacity={0.7} />
                            </linearGradient>

                            <linearGradient id={colorGradientId} x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor={TOKEN.gradientFrom} />
                                <stop offset="100%" stopColor={TOKEN.gradientTo} />
                            </linearGradient>

                            <linearGradient id={fadeGradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="white" stopOpacity={0.7} />
                                <stop offset="100%" stopColor="white" stopOpacity={0} />
                            </linearGradient>

                            <mask id={maskId} maskContentUnits="objectBoundingBox">
                                <rect x="0" y="0" width="1" height="1" fill={`url(#${fadeGradientId})`} />
                            </mask>

                            <filter id={glowId} x="-20%" y="-50%" width="140%" height="200%">
                                <feGaussianBlur stdDeviation={lineGlowBlur} result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>

                        {model.unitLabel && (
                            <text
                                data-testid="trend-chart-y-axis-unit"
                                x={layout.yAxisUnitSlot.x}
                                y={layout.yAxisUnitSlot.y}
                                textAnchor={layout.yAxisUnitSlot.textAnchor}
                                fill={TOKEN.icon}
                                fontSize={SYSTEM_TEXT_STYLE.fontSize}
                                fontFamily={SYSTEM_TEXT_STYLE.fontFamily}
                                fontWeight={SYSTEM_TEXT_STYLE.fontWeight}
                                letterSpacing={SYSTEM_TEXT_STYLE.letterSpacing}
                            >
                                {model.unitLabel}
                            </text>
                        )}

                        {model.summaryLabels && (
                            <text
                                data-testid="trend-chart-summary"
                                x={layout.topMetaSlot.x}
                                y={layout.topMetaSlot.y}
                                textAnchor={layout.topMetaSlot.textAnchor}
                                fill={TOKEN.muted}
                                fontSize={SYSTEM_TEXT_STYLE.fontSize}
                                fontFamily={SYSTEM_TEXT_STYLE.fontFamily}
                                fontWeight={SYSTEM_TEXT_STYLE.fontWeight}
                                letterSpacing={SYSTEM_TEXT_STYLE.letterSpacing}
                            >
                                <tspan data-testid="trend-chart-summary-min">
                                    {`min ${model.summaryLabels.min}`}
                                </tspan>
                                <tspan data-testid="trend-chart-summary-max" dx="12">
                                    {`max ${model.summaryLabels.max}`}
                                </tspan>
                                <tspan data-testid="trend-chart-summary-avg" dx="12">
                                    {`avg ${model.summaryLabels.avg}`}
                                </tspan>
                            </text>
                        )}

                        {model.gridLines.map(({ y }) => (
                            <line
                                key={y}
                                x1={layout.plotArea.left}
                                x2={layout.plotArea.right}
                                y1={y}
                                y2={y}
                                stroke={TOKEN.grid}
                                strokeDasharray="3 3"
                            />
                        ))}

                        <line
                            x1={layout.plotArea.left}
                            y1={layout.plotArea.top}
                            x2={layout.plotArea.left}
                            y2={layout.plotArea.bottom}
                            stroke={TOKEN.border}
                        />
                        <line
                            x1={layout.plotArea.left}
                            y1={layout.plotArea.bottom}
                            x2={layout.plotArea.right}
                            y2={layout.plotArea.bottom}
                            stroke={TOKEN.border}
                        />

                        {model.thresholds.map(({ index, threshold, y }) => {
                            const color = threshold.severity === 'critical' ? TOKEN.statusCritical : TOKEN.statusWarning;

                            return (
                                <g key={`threshold-${index}`}>
                                    <line
                                        x1={layout.plotArea.left}
                                        x2={layout.plotArea.right}
                                        y1={y}
                                        y2={y}
                                        stroke={color}
                                        strokeDasharray="6 3"
                                        strokeWidth={1.5}
                                    />
                                    <text
                                        x={layout.plotArea.right - 4}
                                        y={y - 6}
                                        textAnchor="end"
                                        fill={color}
                                        fontSize="var(--font-size-chart)"
                                        fontFamily="var(--font-chart)"
                                        fontWeight="var(--font-weight-chart)"
                                        letterSpacing="var(--tracking-chart)"
                                    >
                                        {threshold.label || (threshold.severity === 'critical' ? 'CRIT' : 'WARN')}
                                    </text>
                                </g>
                            );
                        })}

                        <g clipPath={`url(#${layout.plotClipPathId})`}>
                            {model.areaPath.length > 0 && (
                                <path
                                    d={model.areaPath}
                                    fill={`url(#${colorGradientId})`}
                                    mask={`url(#${maskId})`}
                                />
                            )}

                            {model.linePath.length > 0 && (
                                <path
                                    d={model.linePath}
                                    stroke={`url(#${lineGradientId})`}
                                    strokeWidth={lineStrokeWidth}
                                    fill="none"
                                    filter={`url(#${glowId})`}
                                />
                            )}
                        </g>

                        {model.visibleLabelIndices.map((index) => {
                            const label = model.xLabels[index];
                            return (
                                <text
                                    key={`x-label-${index}`}
                                    data-testid="trend-chart-x-axis-label"
                                    x={model.xPositions[index]}
                                    y={layout.xAxisLabels.y}
                                    textAnchor="middle"
                                    fill={TOKEN.muted}
                                    fontSize="var(--font-size-chart)"
                                    fontFamily="var(--font-chart)"
                                    fontWeight="var(--font-weight-chart)"
                                    letterSpacing="var(--tracking-chart)"
                                >
                                    {label}
                                </text>
                            );
                        })}

                        {model.yTicks.map((tick, index) => (
                            <text
                                key={`y-tick-${index}`}
                                x={layout.plotArea.left - 8}
                                y={tick.y}
                                dy={4}
                                textAnchor="end"
                                fill={TOKEN.muted}
                                fontSize="var(--font-size-chart)"
                                fontFamily="var(--font-chart)"
                                fontWeight="var(--font-weight-chart)"
                                letterSpacing="var(--tracking-chart)"
                            >
                                {tick.label}
                            </text>
                        ))}

                        <TrendChartLegacyInteractionLayer
                            data={model.data}
                            points={model.points}
                            x0={model.x0}
                            step={model.step}
                            plotTop={layout.plotArea.top}
                            plotLeft={layout.plotArea.left}
                            plotWidth={model.plotWidth}
                            plotHeight={model.plotHeight}
                            hoveredIndex={hoveredIndex}
                            onHoverChange={onHoverChange}
                            indicatorColor={TOKEN.muted}
                            highlightColor={TOKEN.gradientTo}
                            highlightBorderColor={TOKEN.background}
                        />
                    </>
                );
            }}
            renderOverlay={() => model.lastPoint ? (
                <g pointerEvents="none">
                    <circle
                        data-testid="trend-chart-final-point-pulse"
                        cx={model.lastPoint.x}
                        cy={model.lastPoint.y}
                        r={9}
                        fill={TOKEN.gradientTo}
                        fillOpacity={0.45}
                        className="animate-ping"
                        style={{ animationDuration: '2s', transformOrigin: `${model.lastPoint.x}px ${model.lastPoint.y}px` }}
                    />
                    <circle
                        data-testid="trend-chart-final-point-core"
                        cx={model.lastPoint.x}
                        cy={model.lastPoint.y}
                        r={4}
                        fill={TOKEN.gradientTo}
                        stroke={TOKEN.background}
                        strokeWidth={1.5}
                    />
                </g>
            ) : null}
        />
    );
}

function TrendChartContainer({
    widgetId,
    data,
    thresholds,
    seriesName,
    unit,
    summary,
    lineStrokeWidth,
    lineGlowBlur,
}: TrendChartContainerProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const dimensionsRef = useRef({ width: 0, height: 0 });
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ index: number; x: number } | null>(null);
    const chartTypography = useMemo(() => ({
        font: getChartTextFont(),
        letterSpacing: getChartLetterSpacingPx(),
    }), []);
    const model = useMemo(() => (
        dimensions.width > 0 && dimensions.height > 0 && data.length > 0
            ? buildTrendChartLegacyModel({
                widgetId,
                width: dimensions.width,
                height: dimensions.height,
                data,
                unit,
                summary,
                thresholds,
                font: chartTypography.font,
                letterSpacing: chartTypography.letterSpacing,
            })
            : null
    ), [chartTypography.font, chartTypography.letterSpacing, data, dimensions.height, dimensions.width, summary, thresholds, unit, widgetId]);

    const handleHoverChange = useCallback((index: number | null, x?: number) => {
        setHoveredIndex((currentIndex) => currentIndex === index ? currentIndex : index);
        setHoverInfo((currentInfo) => {
            const nextInfo = index !== null && x !== undefined ? { index, x } : null;

            if (currentInfo?.index === nextInfo?.index && currentInfo?.x === nextInfo?.x) {
                return currentInfo;
            }

            return nextInfo;
        });
    }, []);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;

            if (dimensionsRef.current.width === width && dimensionsRef.current.height === height) {
                return;
            }

            dimensionsRef.current = { width, height };
            setDimensions({ width, height });
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={ref} className="h-full w-full relative">
            {model && (
                <TrendChartSvg
                    model={model}
                    lineStrokeWidth={lineStrokeWidth}
                    lineGlowBlur={lineGlowBlur}
                    hoveredIndex={hoveredIndex}
                    onHoverChange={handleHoverChange}
                />
            )}

            {hoverInfo && hoverInfo.index >= 0 && hoverInfo.index < data.length && (() => {
                const point = data[hoverInfo.index];
                const series: ChartTooltipSeries[] = [{
                    name: seriesName,
                    value: `${point.value}${unit ? ` ${unit}` : ''}`,
                    color: TOKEN.gradientTo,
                }];

                return (
                    <ChartTooltip
                        label={point.time}
                        series={series}
                        x={hoverInfo.x}
                        containerWidth={dimensions.width}
                    />
                );
            })()}
        </div>
    );
}

export default function TrendChartWidget({
    widget,
    equipmentMap,
    machines,
    isLoadingData = false,
    className,
}: TrendChartWidgetProps) {
    const [range, setRange] = useState<HistoryRange>('hora');
    const [confirmedHistorySnapshot, setConfirmedHistorySnapshot] = useState<TrendChartLegacyHistorySnapshot | null>(null);
    const resolved = resolveBinding(widget, equipmentMap, machines);
    const isSimulated = widget.binding?.mode === 'simulated_value';
    const bindingMachineId = widget.binding?.machineId;
    const bindingVariableKey = widget.binding?.variableKey;
    const historyEnabled = isDataHistoryEnabled();

    const historyOwnerKey = `${widget.id}:${widget.binding?.mode ?? 'unbound'}:${bindingMachineId ?? 'none'}:${bindingVariableKey ?? 'none'}`;
    const historyParams = useMemo<HistoryQueryParams | null>(() => (
        !isSimulated && bindingMachineId !== undefined && bindingVariableKey && historyEnabled
            ? { machineId: bindingMachineId, variableKey: bindingVariableKey, range }
            : null
    ), [bindingMachineId, bindingVariableKey, historyEnabled, isSimulated, range]);
    const {
        data: historyData,
        isLoading: isLoadingHistory,
        isError: isHistoryError,
        error: historyError,
        isPlaceholderData,
        isRefreshing,
    } = useDataHistory(historyParams);

    const baseValue = resolved.value == null
        ? null
        : typeof resolved.value === 'number'
            ? resolved.value
            : typeof resolved.value === 'string'
                ? (() => {
                    const parsed = parseFloat(resolved.value);
                    return Number.isNaN(parsed) ? 50 : parsed;
                })()
                : 50;

    // Datos simulados: solo cuando el binding está en modo simulado
    const trendData = useMemo(
        () => isSimulated && baseValue !== null ? generateTrendData(baseValue, undefined, 24) : [],
        [baseValue, isSimulated],
    );

    const hasCompatibleHistoryResponse = historyData != null
        && isDataHistoryResponseCompatible(historyParams, historyData);
    const requestedSelectionKey = `${bindingMachineId ?? 'none'}:${bindingVariableKey ?? 'none'}:${range}`;
    const currentResponseRevision = useMemo(() => (
        historyData != null && hasCompatibleHistoryResponse ? JSON.stringify(historyData) : null
    ), [hasCompatibleHistoryResponse, historyData]);
    const canReuseConfirmedMapping = currentResponseRevision !== null
        && confirmedHistorySnapshot?.ownerKey === historyOwnerKey
        && confirmedHistorySnapshot.selectionKey === requestedSelectionKey
        && confirmedHistorySnapshot.revision === currentResponseRevision;
    const currentHistoryTrendData = useMemo(() => (
        historyData != null && hasCompatibleHistoryResponse
            ? canReuseConfirmedMapping
                ? confirmedHistorySnapshot.data
                : mapTrendChartLegacyHistory(historyData, range)
            : null
    ), [canReuseConfirmedMapping, confirmedHistorySnapshot, hasCompatibleHistoryResponse, historyData, range]);
    const currentHistorySnapshot = useMemo<TrendChartLegacyHistorySnapshot | null>(() => (
        historyData != null && currentHistoryTrendData && currentResponseRevision !== null
            ? {
                ownerKey: historyOwnerKey,
                selectionKey: requestedSelectionKey,
                revision: currentResponseRevision,
                range,
                data: currentHistoryTrendData,
                response: historyData,
            }
            : null
    ), [currentHistoryTrendData, currentResponseRevision, historyData, historyOwnerKey, range, requestedSelectionKey]);

    if (
        currentHistorySnapshot
        && !isPlaceholderData
        && !isHistoryError
        && (
            confirmedHistorySnapshot?.ownerKey !== currentHistorySnapshot.ownerKey
            || confirmedHistorySnapshot.selectionKey !== currentHistorySnapshot.selectionKey
            || confirmedHistorySnapshot.revision !== currentHistorySnapshot.revision
        )
    ) {
        setConfirmedHistorySnapshot(currentHistorySnapshot);
    }

    const ownerConfirmedSnapshot = confirmedHistorySnapshot?.ownerKey === historyOwnerKey
        ? confirmedHistorySnapshot
        : null;
    const isShowingRefreshingSnapshot = !isSimulated && isRefreshing && ownerConfirmedSnapshot !== null;
    const isShowingRefreshFailedSnapshot = !isSimulated && isHistoryError && ownerConfirmedSnapshot !== null;
    const preserveConfirmedSnapshot = (isPlaceholderData || isRefreshing || isHistoryError)
        && ownerConfirmedSnapshot !== null;
    const visibleHistorySnapshot = preserveConfirmedSnapshot
        ? ownerConfirmedSnapshot
        : currentHistorySnapshot;

    // Modo simulado → trendData; Modo real → historyTrendData (puede estar vacío)
    const chartData = isSimulated
        ? trendData
        : visibleHistorySnapshot?.data ?? [];
    const resolvedUnit = isSimulated
        ? (resolved.unit ? String(resolved.unit) : undefined)
        : visibleHistorySnapshot?.response.unit ?? (resolved.unit ? String(resolved.unit) : undefined);
    const hasBinding = bindingMachineId !== undefined && Boolean(bindingVariableKey);
    const chartSummary = !isSimulated && visibleHistorySnapshot && chartData.length > 0
        ? visibleHistorySnapshot.response.summary
        : undefined;
    const noDataRuntimeState = isHistoryError
        ? (isDataHistoryConnectionError(historyError) ? 'disconnected' : 'error')
        : 'empty';
    const displayOptions = widget.displayOptions as TrendChartDisplayOptions | undefined;
    const lineStrokeWidth = clampLineStrokeWidth(displayOptions?.lineStrokeWidth);
    const lineGlowBlur = clampLineGlowBlur(displayOptions?.lineGlowBlur);

    // Modo real cargando → skeleton; Modo simulado no muestra loading por histórico
    const isRealLoading = !isSimulated && historyParams !== null && isLoadingHistory && visibleHistorySnapshot === null;
    // Sin datos: modo real sin serie + sin error, o simulado sin binding
    const isNoData = isSimulated
        ? (chartData.length === 0 && (!hasBinding || baseValue === null))
        : (!isLoadingHistory && chartData.length === 0);

    if (isLoadingData || isRealLoading) {
        return (
            <div className={`glass-panel p-5 w-full h-full flex items-center justify-center ${className ?? ''}`}>
                <WidgetRuntimeState state="loading" testId="trend-chart-widget-loading" />
            </div>
        );
    }

    return (
        <div className={`glass-panel group relative p-5 overflow-hidden w-full h-full flex flex-col ${className ?? ''}`}>
            <WidgetHeader
                title={widget.title ?? 'Trend Chart'}
                icon={TrendingUp}
                iconColor={TOKEN.icon}
                iconPosition="left"
                className={WIDGET_CHART_HEADER_CLASS}
                trailing={(
                    <WidgetHeaderTemporalControls
                        variant="pill"
                        testId="trend-chart-widget-runtime-controls"
                        indicatorTestId="trend-chart-widget-runtime-control-indicator"
                        groups={[
                            {
                                testId: 'trend-chart-widget-runtime-range-selector',
                                options: HISTORY_RANGE_OPTIONS,
                                selectedValue: range,
                                onSelect: (value) => setRange(value as HistoryRange),
                            },
                        ]}
                    />
                )}
            />

            <div className={WIDGET_CHART_CONTAINER_CLASS} data-testid="trend-chart-widget-chart-shell">
                {isShowingRefreshFailedSnapshot ? (
                    <HistoricalChartNotice variant="stale" testId="trend-chart-historical-notice" />
                ) : isShowingRefreshingSnapshot ? (
                    <HistoricalChartNotice variant="refreshing" testId="trend-chart-historical-notice" />
                ) : null}
                {isNoData ? (
                    !isSimulated ? (
                        <WidgetRuntimeState
                            state={noDataRuntimeState}
                            testId="trend-chart-widget-state"
                        />
                    ) : null
                ) : (
                    <TrendChartContainer
                        widgetId={widget.id}
                        data={chartData}
                        thresholds={widget.thresholds}
                        seriesName={widget.title ?? 'Valor'}
                        unit={resolvedUnit}
                        summary={chartSummary}
                        lineStrokeWidth={lineStrokeWidth}
                        lineGlowBlur={lineGlowBlur}
                    />
                )}
            </div>

        </div>
    );
}
