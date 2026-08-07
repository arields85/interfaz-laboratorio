interface HistoricalChartNoticeProps {
    variant: 'refreshing' | 'stale';
    testId?: string;
}

const NOTICE_LABELS: Record<HistoricalChartNoticeProps['variant'], string> = {
    refreshing: 'Actualizando',
    stale: 'Desactualizado',
};

const NOTICE_TONE_CLASSES: Record<HistoricalChartNoticeProps['variant'], string> = {
    refreshing: 'border-industrial-border bg-industrial-surface/95 text-industrial-muted',
    stale: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
};

export default function HistoricalChartNotice({
    variant,
    testId,
}: HistoricalChartNoticeProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid={testId}
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4"
        >
            <div className={`w-fit max-w-full rounded-lg border px-3 py-2 text-center font-system shadow-lg backdrop-blur-sm ${NOTICE_TONE_CLASSES[variant]}`}>
                <span>{NOTICE_LABELS[variant]}</span>
                {variant === 'refreshing' ? (
                    <span aria-hidden="true" className="widget-runtime-state-caret">
                        _
                    </span>
                ) : null}
            </div>
        </div>
    );
}
