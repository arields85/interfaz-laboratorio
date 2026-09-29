import type { AnalyticsDataMode } from '../../domain/analyticsDataMode.types';

const ANALYTICS_DATA_MODE_DOT_CLASSES: Record<AnalyticsDataMode, string> = {
    real: 'text-status-normal',
    simulated: 'text-industrial-muted',
};

interface AnalyticsDataModeDotProps {
    mode: AnalyticsDataMode;
    testId?: string;
    /**
     * The dot sits on the light tab of the tab frame shape: simulated drops the muted body gray
     * and inherits the tab text color (`.hmi-tab-frame-tab`, dark); real stays green.
     */
    onTab?: boolean;
}

export default function AnalyticsDataModeDot({ mode, testId, onTab = false }: AnalyticsDataModeDotProps) {
    const simulatedOnTab = onTab && mode === 'simulated';

    return (
        <span
            data-testid={testId}
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${simulatedOnTab ? '' : ANALYTICS_DATA_MODE_DOT_CLASSES[mode]}`}
        />
    );
}
