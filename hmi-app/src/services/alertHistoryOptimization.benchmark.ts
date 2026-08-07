import type { WidgetConfig } from '../domain/admin.types';
import type { DashboardAlertHistory } from '../domain/alertHistory.types';
import { evaluateDashboardWidgets } from '../widgets/resolvers/alertHistoryEvaluator';

class InstrumentedStorage implements Storage {
    private readonly values = new Map<string, string>();
    private readCount = 0;
    private writeCount = 0;

    get length(): number {
        return this.values.size;
    }

    get counts(): { reads: number; writes: number } {
        return { reads: this.readCount, writes: this.writeCount };
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        this.readCount += 1;
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return Array.from(this.values.keys())[index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.writeCount += 1;
        this.values.set(key, value);
    }

    resetCounters(): void {
        this.readCount = 0;
        this.writeCount = 0;
    }

    peekHistory(dashboardId: string): DashboardAlertHistory {
        const raw = this.values.get(`hmi_alert_history_v1_${dashboardId}`);
        if (!raw) {
            throw new Error(`Missing benchmark history for ${dashboardId}`);
        }
        return JSON.parse(raw) as DashboardAlertHistory;
    }
}

const storage = new InstrumentedStorage();
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
});

const OUTPUT_GOLDENS = {
    12: '6418ed6663cdc8182316724f3e0f89ec3ae6aeacd018c90e8329f6950729f168',
    50: '624623a636424c7e9eb9d1c3cfbd40071d858942660c4962895b2a427ddee12d',
} as const;

for (const widgetCount of [12, 50] as const) {
    storage.clear();
    storage.resetCounters();
    const widgets = buildWidgets(widgetCount);
    const startedAt = performance.now();
    const firstResult = evaluateDashboardWidgets('benchmark-dashboard', widgets, new Map());
    const firstDurationMs = performance.now() - startedAt;
    const firstCounts = storage.counts;
    const history = storage.peekHistory('benchmark-dashboard');
    const outputHash = await createSha256(JSON.stringify(normalizeHistory(history)));
    if (outputHash !== OUTPUT_GOLDENS[widgetCount]) {
        throw new Error(`Alert-history ${widgetCount}-widget output changed: expected ${OUTPUT_GOLDENS[widgetCount]}, received ${outputHash}`);
    }

    storage.resetCounters();
    const stableStartedAt = performance.now();
    const stableResult = evaluateDashboardWidgets('benchmark-dashboard', widgets, new Map());
    const stableDurationMs = performance.now() - stableStartedAt;

    console.log(JSON.stringify({
        widgetCount,
        outputHash,
        finalState: {
            entries: history.entries.length,
            snapshots: Object.keys(history.widgetSnapshots).length,
            firstNewEntries: firstResult.newEntries.length,
            stableNewEntries: stableResult.newEntries.length,
        },
        pre: {
            firstEvaluatorCycle: { reads: (2 * widgetCount) + 1, writes: widgetCount },
            firstWidgetCycle: { reads: (2 * widgetCount) + 3, writes: widgetCount },
            twoWidgetInstances: { reads: (2 * widgetCount) + 3 + (2 * widgetCount) + 3, writes: widgetCount },
            stableEvaluatorCycle: { reads: (2 * widgetCount) + 1, writes: 0 },
        },
        post: {
            firstSharedCycle: { ...firstCounts, durationMs: Number(firstDurationMs.toFixed(3)) },
            stableSharedCycle: { ...storage.counts, durationMs: Number(stableDurationMs.toFixed(3)) },
        },
    }));
}

function buildWidgets(widgetCount: number): WidgetConfig[] {
    return Array.from({ length: widgetCount }, (_, index) => ({
        id: `sensor-${index}`,
        type: 'metric-card' as const,
        title: `Sensor ${index}`,
        position: { x: index % 4, y: Math.floor(index / 4) },
        size: { w: 4, h: 3 },
        simulatedValue: 100 + index,
        thresholds: [{ value: 90, severity: 'warning' as const }],
    }));
}

function normalizeHistory(history: DashboardAlertHistory): object {
    return {
        dashboardId: history.dashboardId,
        entries: history.entries.map((entry) => ({
            widgetId: entry.widgetId,
            widgetTitle: entry.widgetTitle,
            toStatus: entry.toStatus,
            fromStatus: entry.fromStatus,
            value: entry.value,
            unit: entry.unit,
        })),
        snapshots: Object.fromEntries(
            Object.entries(history.widgetSnapshots).map(([widgetId, snapshot]) => [
                widgetId,
                snapshot.lastStatus,
            ]),
        ),
    };
}

async function createSha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
