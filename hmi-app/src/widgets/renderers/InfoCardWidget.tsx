import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HelpCircle, Info, type LucideIcon } from 'lucide-react';
import WidgetHeader from '../../components/ui/WidgetHeader';
import type { InfoCardWidgetConfig } from '../../domain/admin.types';
import {
    DEFAULT_INFO_CARD_VALUE_FONT_SIZE,
    resolveInfoCardFieldContent,
    resolveInfoCardFields,
    resolveInfoCardTextAlign,
} from '../../utils/infoCardDisplayOptions';

interface InfoCardWidgetProps {
    widget: InfoCardWidgetConfig;
    className?: string;
}

const ICON_MAP: Record<string, LucideIcon> = {
    Info,
    HelpCircle,
};

const EMPTY_VALUE = '—';
const COMPACT_EXIT_BUFFER_PX = 8;
const MIN_CENTERED_TOP_GAP_PX = 1;
const OPTICAL_BIAS_START_OCCUPANCY = 0.55;
const OPTICAL_BIAS_EASING_POWER = 0.6;

function resolveDisplayValue(value: string | undefined): string {
    const trimmed = value?.trim() ?? '';

    return trimmed === '' ? EMPTY_VALUE : trimmed;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
}

function resolveContentOffsetPx(availableHeight: number, requiredHeight: number): number {
    if (availableHeight <= 0 || requiredHeight <= 0 || requiredHeight >= availableHeight) {
        return 0;
    }

    const freeSpace = availableHeight - requiredHeight;
    const centeredTopSpace = freeSpace / 2;

    if (centeredTopSpace <= MIN_CENTERED_TOP_GAP_PX) {
        return 0;
    }

    const occupancy = requiredHeight / availableHeight;
    const biasProgress = clamp(
        (occupancy - OPTICAL_BIAS_START_OCCUPANCY) / (1 - OPTICAL_BIAS_START_OCCUPANCY),
        0,
        1,
    );
    const biasCap = centeredTopSpace - MIN_CENTERED_TOP_GAP_PX;
    const easedBiasProgress = Math.pow(biasProgress, OPTICAL_BIAS_EASING_POWER);

    return roundToTwoDecimals(Math.min(biasCap, centeredTopSpace * easedBiasProgress));
}

type LayoutState = {
    isCompact: boolean;
    contentOffsetPx: number;
};

export default function InfoCardWidget({ widget, className }: InfoCardWidgetProps) {
    const [{ isCompact, contentOffsetPx }, setLayoutState] = useState<LayoutState>({
        isCompact: false,
        contentOffsetPx: 0,
    });
    const cardRef = useRef<HTMLElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const contentStackRef = useRef<HTMLDivElement | null>(null);
    const compactStateRef = useRef(false);
    const compactReleaseHeightRef = useRef<number | null>(null);
    const displayOptions = widget.displayOptions;
    const fields = resolveInfoCardFields(displayOptions);
    const canMeasureLayout = fields.length > 0 && typeof ResizeObserver !== 'undefined';
    const valueFontSize = displayOptions?.valueFontSize ?? DEFAULT_INFO_CARD_VALUE_FONT_SIZE;
    const textAlign = resolveInfoCardTextAlign(displayOptions);
    const valueStyle: CSSProperties = {
        fontFamily: 'var(--font-dashboard-title)',
        fontWeight: 'var(--font-weight-dashboard-title)',
        letterSpacing: 'var(--tracking-dashboard-title)',
        fontSize: `${valueFontSize}px`,
        lineHeight: 1.1,
        textAlign,
    };
    const groupTextStyle: CSSProperties = { textAlign };
    const iconSetting = displayOptions?.icon;
    const Icon = typeof iconSetting === 'string'
        ? ICON_MAP[iconSetting] ?? HelpCircle
        : iconSetting === null
          ? null
          : Info;

    useEffect(() => {
        const card = cardRef.current;
        const header = headerRef.current;
        const scroller = scrollerRef.current;
        const contentStack = contentStackRef.current;

        if (!card || !header || !scroller || !contentStack || !canMeasureLayout) {
            compactStateRef.current = false;
            compactReleaseHeightRef.current = null;
            return;
        }

        const measureLayout = () => {
            const availableHeight = scroller.clientHeight;
            const requiredHeight = contentStack.scrollHeight;
            const hasOverflow = requiredHeight > availableHeight;
            let nextIsCompact = false;
            let nextContentOffsetPx = 0;

            if (compactStateRef.current) {
                compactReleaseHeightRef.current = Math.max(
                    compactReleaseHeightRef.current ?? 0,
                    requiredHeight + COMPACT_EXIT_BUFFER_PX,
                );

                const shouldRemainCompact = availableHeight < (compactReleaseHeightRef.current ?? 0);

                if (shouldRemainCompact) {
                    nextIsCompact = true;
                } else {
                    compactStateRef.current = false;
                    compactReleaseHeightRef.current = null;
                }
            } else if (hasOverflow) {
                compactStateRef.current = true;
                compactReleaseHeightRef.current = requiredHeight + COMPACT_EXIT_BUFFER_PX;
                nextIsCompact = true;
            } else {
                nextContentOffsetPx = resolveContentOffsetPx(availableHeight, requiredHeight);
            }

            setLayoutState((current) => {
                if (
                    current.isCompact === nextIsCompact
                    && current.contentOffsetPx === nextContentOffsetPx
                ) {
                    return current;
                }

                return {
                    isCompact: nextIsCompact,
                    contentOffsetPx: nextContentOffsetPx,
                };
            });
        };

        measureLayout();

        const resizeObserver = new ResizeObserver(measureLayout);
        resizeObserver.observe(card);
        resizeObserver.observe(header);
        resizeObserver.observe(scroller);
        resizeObserver.observe(contentStack);

        return () => {
            resizeObserver.disconnect();
        };
    }, [canMeasureLayout]);

    const resolvedIsCompact = canMeasureLayout ? isCompact : false;
    const resolvedContentOffsetPx = canMeasureLayout ? contentOffsetPx : 0;
    const scrollerLayoutClassName = resolvedIsCompact ? 'justify-start' : 'justify-center';
    const contentStackStyle: CSSProperties | undefined = resolvedContentOffsetPx > 0
        ? { transform: `translateY(-${resolvedContentOffsetPx}px)` }
        : undefined;

    return (
        <article ref={cardRef} className={[className, 'glass-panel group flex h-full w-full min-h-0 flex-col gap-0 p-4'].filter(Boolean).join(' ')}>
            <div ref={headerRef} data-testid="info-card-header" className="shrink-0">
                <WidgetHeader
                    title={widget.title?.trim() || 'Info card'}
                    subtitle={displayOptions?.subtitle}
                    icon={Icon ?? undefined}
                    iconPosition="right"
                    iconTestId="info-card-header-icon"
                />
            </div>

            <div
                ref={scrollerRef}
                data-testid="info-card-content-scroller"
                className={`hmi-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto ${scrollerLayoutClassName}`}
            >
                {fields.length > 0 ? (
                    <div
                        ref={contentStackRef}
                        data-testid="info-card-content-stack"
                        className="flex flex-col gap-3"
                        style={contentStackStyle}
                    >
                        {fields.map((field) => {
                            const { text, subtext, tag } = resolveInfoCardFieldContent(field);
                            const trimmedSubtext = subtext.trim();
                            const trimmedTag = tag?.trim() ?? '';

                            return (
                                <section key={field.id} className="flex w-full flex-col gap-0.5">
                                    <p className="w-full break-words text-industrial-text" style={valueStyle}>
                                        {resolveDisplayValue(text)}
                                    </p>
                                    {trimmedSubtext ? (
                                        <p className="w-full break-words text-industrial-muted" style={groupTextStyle}>
                                            {trimmedSubtext}
                                        </p>
                                    ) : null}
                                    {trimmedTag ? (
                                        <p className="w-full break-words pt-1 text-industrial-muted" style={groupTextStyle}>
                                            {trimmedTag}
                                        </p>
                                    ) : null}
                                </section>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex min-h-full items-center justify-center py-4 text-center text-industrial-muted">
                        No static fields configured
                    </div>
                )}
            </div>
        </article>
    );
}
