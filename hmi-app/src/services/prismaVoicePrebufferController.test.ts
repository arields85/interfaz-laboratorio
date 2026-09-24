import { describe, expect, it } from 'vitest';

import type { PrismaVoicePrebufferHistory } from '../domain/prismaVoicePrebufferHistory.types';
import { PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS, PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS } from './prismaVoicePrebufferEstimator';
import {
    createPrismaVoiceAutomaticPrebufferPolicy,
    PrismaVoicePrebufferController,
} from './prismaVoicePrebufferController';
import { PrismaVoicePrebufferHistoryStorage } from './prismaVoicePrebufferHistoryStorage';

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

describe('PrismaVoicePrebufferController', () => {
    it('returns the default prebuffer with no recorded history', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new PrismaVoicePrebufferController(storage, () => 1_000);

        expect(controller.getNextPrebufferMs()).toBe(PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS);
    });

    it('raises the next prebuffer on the very next call after recording a high measurement', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        let now = 1_000;
        const controller = new PrismaVoicePrebufferController(storage, () => now);

        controller.recordMeasurement(900);
        now = 2_000;

        expect(controller.getNextPrebufferMs()).toBe(900 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('persists recorded measurements through the injected storage, timestamped with the injected clock', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new PrismaVoicePrebufferController(storage, () => 5_000);

        controller.recordMeasurement(300);

        const persisted: PrismaVoicePrebufferHistory = storage.read();
        expect(persisted).toEqual([{ neededPrebufferMs: 300, recordedAtMs: 5_000 }]);
    });

    it('accumulates several measurements across calls', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        let now = 1_000;
        const controller = new PrismaVoicePrebufferController(storage, () => now);

        controller.recordMeasurement(150);
        now = 2_000;
        controller.recordMeasurement(200);

        expect(storage.read()).toEqual([
            { neededPrebufferMs: 150, recordedAtMs: 1_000 },
            { neededPrebufferMs: 200, recordedAtMs: 2_000 },
        ]);
    });

    it('defaults the clock to Date.now when none is injected', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new PrismaVoicePrebufferController(storage);
        const before = Date.now();

        controller.recordMeasurement(200);

        const [entry] = storage.read();
        expect(entry.recordedAtMs).toBeGreaterThanOrEqual(before);
        expect(entry.recordedAtMs).toBeLessThanOrEqual(Date.now());
    });
});

describe('createPrismaVoiceAutomaticPrebufferPolicy', () => {
    it('T3: resolves the controller\'s next prebuffer, tagged as automatic', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new PrismaVoicePrebufferController(storage, () => 1_000);
        const policy = createPrismaVoiceAutomaticPrebufferPolicy(controller);

        expect(policy.resolvePrebufferMs()).toEqual({
            prebufferMs: PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS,
            mode: 'automatic',
        });
    });

    it('T3: forwards a recorded measurement to the controller, which persists it', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        const controller = new PrismaVoicePrebufferController(storage, () => 5_000);
        const policy = createPrismaVoiceAutomaticPrebufferPolicy(controller);

        policy.recordNeededPrebufferMs(300);

        expect(storage.read()).toEqual([{ neededPrebufferMs: 300, recordedAtMs: 5_000 }]);
    });

    it('T3: reflects a measurement recorded through the policy in the next resolved prebuffer', () => {
        const storage = new PrismaVoicePrebufferHistoryStorage(fakeStorageSource());
        let now = 1_000;
        const controller = new PrismaVoicePrebufferController(storage, () => now);
        const policy = createPrismaVoiceAutomaticPrebufferPolicy(controller);

        policy.recordNeededPrebufferMs(900);
        now = 2_000;

        expect(policy.resolvePrebufferMs().prebufferMs).toBe(900 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });
});
