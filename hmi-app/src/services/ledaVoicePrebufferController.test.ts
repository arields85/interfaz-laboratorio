import { describe, expect, it, vi } from 'vitest';

import type { LedaVoicePrebufferHistory } from '../domain/ledaVoicePrebufferHistory.types';
import { LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS, LEDA_PREBUFFER_ESTIMATE_SAFETY_MS } from './ledaVoicePrebufferEstimator';
import {
    createLedaVoiceAutomaticPrebufferPolicy,
    createLedaVoiceConfiguredPrebufferPolicy,
    createLedaVoiceManualPrebufferPolicy,
    LedaVoicePrebufferController,
} from './ledaVoicePrebufferController';
import { LedaVoicePrebufferHistoryStorage } from './ledaVoicePrebufferHistoryStorage';

function fakeStorageSource() {
    const map = new Map<string, string>();
    return {
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); },
        clear: () => { map.clear(); },
        key: () => null,
        get length() { return map.size; },
    } satisfies Storage;
}

describe('LedaVoicePrebufferController', () => {
    it('returns the default prebuffer with no recorded history', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);

        expect(controller.getNextPrebufferMs()).toBe(LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS);
    });

    it('raises the next prebuffer on the very next call after recording a high measurement', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        let now = 1_000;
        const controller = new LedaVoicePrebufferController(storage, () => now);

        controller.recordMeasurement(900);
        now = 2_000;

        expect(controller.getNextPrebufferMs()).toBe(900 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('persists recorded measurements through the injected storage, timestamped with the injected clock', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 5_000);

        controller.recordMeasurement(300);

        const persisted: LedaVoicePrebufferHistory = storage.read();
        expect(persisted).toEqual([{ neededPrebufferMs: 300, recordedAtMs: 5_000 }]);
    });

    it('accumulates several measurements across calls', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        let now = 1_000;
        const controller = new LedaVoicePrebufferController(storage, () => now);

        controller.recordMeasurement(150);
        now = 2_000;
        controller.recordMeasurement(200);

        expect(storage.read()).toEqual([
            { neededPrebufferMs: 150, recordedAtMs: 1_000 },
            { neededPrebufferMs: 200, recordedAtMs: 2_000 },
        ]);
    });

    it('defaults the clock to Date.now when none is injected', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage);
        const before = Date.now();

        controller.recordMeasurement(200);

        const [entry] = storage.read();
        expect(entry.recordedAtMs).toBeGreaterThanOrEqual(before);
        expect(entry.recordedAtMs).toBeLessThanOrEqual(Date.now());
    });
});

describe('createLedaVoiceAutomaticPrebufferPolicy', () => {
    it('T3: resolves the controller\'s next prebuffer, tagged as automatic', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);
        const policy = createLedaVoiceAutomaticPrebufferPolicy(controller);

        expect(policy.resolvePrebufferMs()).toEqual({
            prebufferMs: LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS,
            mode: 'automatic',
        });
    });

    it('T3: forwards a recorded measurement to the controller, which persists it', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 5_000);
        const policy = createLedaVoiceAutomaticPrebufferPolicy(controller);

        policy.recordNeededPrebufferMs(300);

        expect(storage.read()).toEqual([{ neededPrebufferMs: 300, recordedAtMs: 5_000 }]);
    });

    it('T3: reflects a measurement recorded through the policy in the next resolved prebuffer', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        let now = 1_000;
        const controller = new LedaVoicePrebufferController(storage, () => now);
        const policy = createLedaVoiceAutomaticPrebufferPolicy(controller);

        policy.recordNeededPrebufferMs(900);
        now = 2_000;

        expect(policy.resolvePrebufferMs().prebufferMs).toBe(900 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });
});

describe('createLedaVoiceManualPrebufferPolicy', () => {
    it('T4: resolves the configured manual seconds, tagged as manual, ignoring history', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);
        controller.recordMeasurement(2_500); // would push the automatic estimate way up
        const policy = createLedaVoiceManualPrebufferPolicy(controller, () => 0.9);

        expect(policy.resolvePrebufferMs()).toEqual({ prebufferMs: 900, mode: 'manual' });
    });

    it('T4: re-reads the manual seconds getter on every resolve (no caching)', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);
        let manualSeconds = 0.2;
        const policy = createLedaVoiceManualPrebufferPolicy(controller, () => manualSeconds);

        expect(policy.resolvePrebufferMs().prebufferMs).toBe(200);
        manualSeconds = 1.2;
        expect(policy.resolvePrebufferMs().prebufferMs).toBe(1_200);
    });

    it('T4: still forwards a recorded measurement to the shared controller/history (design item 4)', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 5_000);
        const policy = createLedaVoiceManualPrebufferPolicy(controller, () => 0.2);

        policy.recordNeededPrebufferMs(300);

        expect(storage.read()).toEqual([{ neededPrebufferMs: 300, recordedAtMs: 5_000 }]);
    });
});

describe('createLedaVoiceConfiguredPrebufferPolicy', () => {
    it('T4: resolves Automatic when the getter reports mode "automatic"', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);
        const policy = createLedaVoiceConfiguredPrebufferPolicy(
            controller,
            () => ({ mode: 'automatic', manualSeconds: 0.9 }),
        );

        expect(policy.resolvePrebufferMs()).toEqual({
            prebufferMs: LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS,
            mode: 'automatic',
        });
    });

    it('T4: resolves Manual with the configured seconds when the getter reports mode "manual"', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);
        const policy = createLedaVoiceConfiguredPrebufferPolicy(
            controller,
            () => ({ mode: 'manual', manualSeconds: 0.7 }),
        );

        expect(policy.resolvePrebufferMs()).toEqual({ prebufferMs: 700, mode: 'manual' });
    });

    it('T4: falls back to Automatic when the config is unavailable (loading/failed/null)', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);
        const policy = createLedaVoiceConfiguredPrebufferPolicy(controller, () => null);

        expect(policy.resolvePrebufferMs()).toEqual({
            prebufferMs: LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS,
            mode: 'automatic',
        });
    });

    it('T4: re-reads the getter on every resolve, switching modes across answers without rebuilding the policy', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 1_000);
        const getSnapshot = vi.fn(() => ({ mode: 'automatic' as const, manualSeconds: 0.2 }));
        const policy = createLedaVoiceConfiguredPrebufferPolicy(controller, getSnapshot);

        expect(policy.resolvePrebufferMs().mode).toBe('automatic');
        getSnapshot.mockReturnValue({ mode: 'manual', manualSeconds: 0.6 });
        expect(policy.resolvePrebufferMs()).toEqual({ prebufferMs: 600, mode: 'manual' });
    });

    it('T4: forwards a recorded measurement to the shared controller regardless of the current mode (design item 4)', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new LedaVoicePrebufferController(storage, () => 5_000);
        const policy = createLedaVoiceConfiguredPrebufferPolicy(
            controller,
            () => ({ mode: 'manual', manualSeconds: 0.2 }),
        );

        policy.recordNeededPrebufferMs(300);

        expect(storage.read()).toEqual([{ neededPrebufferMs: 300, recordedAtMs: 5_000 }]);
    });
});
