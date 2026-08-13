import type { AnalyticsDataMode } from '../../domain/analyticsDataMode.types';

const ANALYTICS_DATA_MODE_DOT_CLASSES: Record<AnalyticsDataMode, string> = {
    real: 'text-status-normal',
    simulated: 'text-industrial-muted',
};

interface AnalyticsDataModeDotProps {
    mode: AnalyticsDataMode;
    testId?: string;
}

export default function AnalyticsDataModeDot({ mode, testId }: AnalyticsDataModeDotProps) {
    return (
        <span
            data-testid={testId}
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${ANALYTICS_DATA_MODE_DOT_CLASSES[mode]}`}
        />
    );
}
