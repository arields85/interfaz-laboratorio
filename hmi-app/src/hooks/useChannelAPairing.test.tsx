// Offline hook contract tests for useChannelAPairing (RCA-5l, TDD RED stage).
// The hook source does NOT exist yet: importing it must fail collection, which is the honest
// observed RED for the later UI gate. No placeholder source and no import catch are used here.
//
// Frozen contract under test (tracker `odd/tasks/prisma-channel-a-remote.md`):
// - `useChannelAPairing(open: boolean)` -> `{ phase, qr, remainingSeconds }` with local ephemeral
//   React state ONLY (no TanStack/Zustand, no logs/storage/framework).
// - `CHANNEL_A_PAIRING_POLL_INTERVAL_MS = 2000`; all pairing requests are single-flight: the
//   status poll is bounded and sequential while open (including `linked`, to observe a phone
//   unlink) and pauses while an issuance POST is in flight — never a concurrent GET or a tight
//   loop — and stops on unavailable/error until close/reopen.
// - One POST issuance on open+free while no live QR exists; pending/linked/unavailable never
//   issue and nothing auto-applies anywhere.
// - The countdown deadline is `performance.now()` at POST dispatch + `expiresInSeconds * 1000`,
//   not arrival; ceil, never negative. A delayed response whose TTL already elapsed at dispatch
//   time never exposes a QR and is retried only through the next normal poll.
// - Close/unmount/reset abort in-flight work, clear owned timers, discard the QR and ignore any
//   late old-generation response; abort/stale rejections are ordinary quiet cleanup.
// - A 409 conflict arrives from the POST issuance (the GET never conflicts): it clears the QR
//   state with exactly ONE immediate refresh GET and never re-issues while the refresh is free;
//   the next issuance may only come from the normal poll.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CHANNEL_A_PAIRING_POLL_INTERVAL_MS,
    useChannelAPairing,
    type ChannelAPairingPhase,
} from './useChannelAPairing';
import { PrismaChannelAPairingError } from '../services/prismaChannelAPairing.service';
import { PrismaStaleSessionResponse } from '../services/prismaSessionClient';
import type {
    ChannelAPairingIssue,
    ChannelAPairingQr,
    ChannelAPairingState,
    ChannelAPairingStatus,
} from '../domain/channelAPairing.types';

const statusMock = vi.hoisted(() => vi.fn<(signal?: AbortSignal) => Promise<unknown>>());
const issueMock = vi.hoisted(() => vi.fn<(signal?: AbortSignal) => Promise<unknown>>());
const sessionResetListeners = vi.hoisted(() => new Set<() => void>());
const subscribeToResetMock = vi.hoisted(() =>
    vi.fn((listener: () => void) => {
        sessionResetListeners.add(listener);
        return () => {
            sessionResetListeners.delete(listener);
        };
    }),
);
// The hook must go through the service boundary; a direct client fetch is a contract defect.
const sessionFetchMock = vi.hoisted(() =>
    vi.fn(() => Promise.reject(new Error('useChannelAPairing must not call prismaSessionClient.fetch directly'))),
);

vi.mock('../services/prismaChannelAPairing.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/prismaChannelAPairing.service')>();
    return {
        ...actual,
        prismaChannelAPairing: {
            status: statusMock,
            issue: issueMock,
        },
    };
});

// Keep the real classes (PrismaStaleSessionResponse identity shared with the hook) and replace
// only the singleton used by the hook for reset subscription; no bootstrap or network request
// can happen through this fake.
vi.mock('../services/prismaSessionClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/prismaSessionClient')>();
    return {
        ...actual,
        prismaSessionClient: {
            subscribeToReset: subscribeToResetMock,
            fetch: sessionFetchMock,
        },
    };
});

const BOT_USERNAME = 'PrismaHmiBot';
const QR_LINK_FIRST = `https://t.me/${BOT_USERNAME}?start=${'A'.repeat(43)}`;
const QR_LINK_RENEWED = `https://t.me/${BOT_USERNAME}?start=${'B'.repeat(43)}`;

function qrFixture(expiresInSeconds: number, deepLink: string = QR_LINK_FIRST): ChannelAPairingQr {
    return { deepLink, expiresInSeconds };
}

function issueFixture(qr: ChannelAPairingQr): ChannelAPairingIssue {
    return { ok: true, qr };
}

function statusFixture(state: ChannelAPairingState): ChannelAPairingStatus {
    return { ok: true, state };
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function dispatchSessionReset(): void {
    for (const listener of [...sessionResetListeners]) {
        listener();
    }
}

// Deterministic flush of pending promise chains under fake timers: microtasks only, never a
// real wait. Eight ticks cover GET -> setState -> effect -> POST -> catch/refresh -> setState
// chains.
async function settle(): Promise<void> {
    await act(async () => {
        for (let tick = 0; tick < 8; tick += 1) {
            await Promise.resolve();
        }
    });
}

// Async timer advance: completion-chained sequential polls settle at their own deadlines
// inside one large advance, so no fixed microtick count is relied on for timer-driven flows.
async function advanceTimers(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

// A session-reset notification flips hook state, so it is dispatched inside act.
async function dispatchSessionResetAsync(): Promise<void> {
    await act(async () => {
        dispatchSessionReset();
        for (let tick = 0; tick < 8; tick += 1) {
            await Promise.resolve();
        }
    });
}

beforeEach(() => {
    // Fake performance so the POST-dispatch deadline anchoring is fully deterministic.
    vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
    });
    statusMock.mockReset();
    issueMock.mockReset();
    sessionResetListeners.clear();
    subscribeToResetMock.mockClear();
    sessionFetchMock.mockClear();
});

afterEach(() => {
    // Unmount RTL hooks BEFORE restoring the real timers so no pending fake timer or mounted
    // hook outlives the fixture.
    cleanup();
    vi.useRealTimers();
});

describe('useChannelAPairing', () => {
    it('stays closed with zero requests and zero owned timers while open is false', async () => {
        expect(CHANNEL_A_PAIRING_POLL_INTERVAL_MS).toBe(2000);

        const { result } = renderHook(() => useChannelAPairing(false));
        await settle();

        expect(result.current.phase).toBe('closed');
        expect(result.current.qr).toBeNull();
        expect(result.current.remainingSeconds).toBe(0);
        expect(statusMock).not.toHaveBeenCalled();
        expect(issueMock).not.toHaveBeenCalled();
        expect(sessionFetchMock).not.toHaveBeenCalled();

        // No owned timers: a closed hook must never wake up on its own.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS * 3);
        expect(statusMock).not.toHaveBeenCalled();
        expect(issueMock).not.toHaveBeenCalled();
        expect(result.current.phase).toBe('closed');
        expect(result.current.qr).toBeNull();
    });

    it('on open with a free status issues exactly one QR and shows it', async () => {
        statusMock.mockResolvedValue(statusFixture('free'));
        issueMock.mockResolvedValue(issueFixture(qrFixture(60)));

        const { result } = renderHook(() => useChannelAPairing(true));
        await settle();

        expect(result.current.phase).toBe('free');
        expect(result.current.qr).toEqual({ deepLink: QR_LINK_FIRST, expiresInSeconds: 60 });
        expect(result.current.remainingSeconds).toBe(60);
        expect(statusMock).toHaveBeenCalledTimes(1);
        expect(issueMock).toHaveBeenCalledTimes(1);

        // Settled requests do not trigger anything by themselves: issuance is one-shot.
        await settle();
        expect(statusMock).toHaveBeenCalledTimes(1);
        expect(issueMock).toHaveBeenCalledTimes(1);
    });

    it('never issues a QR for pending, linked or unavailable states', async () => {
        for (const state of ['pending', 'linked', 'unavailable'] as const) {
            statusMock.mockReset();
            issueMock.mockReset();
            statusMock.mockResolvedValue(statusFixture(state));

            const { result, unmount } = renderHook(() => useChannelAPairing(true));
            await settle();

            expect(result.current.phase).toBe(state);
            expect(result.current.qr).toBeNull();
            expect(issueMock).not.toHaveBeenCalled();

            unmount();
        }
    });

    it('polls sequentially on one interval and issues a fresh QR when the phone unlinks back to free', async () => {
        const statusQueue: ChannelAPairingStatus[] = [
            statusFixture('free'),
            statusFixture('pending'),
            statusFixture('linked'),
            statusFixture('linked'),
            statusFixture('free'),
        ];
        statusMock.mockImplementation(() => Promise.resolve(statusQueue.shift() ?? statusFixture('linked')));
        let issueCalls = 0;
        issueMock.mockImplementation(() => {
            issueCalls += 1;
            return Promise.resolve(issueFixture(qrFixture(60, issueCalls === 1 ? QR_LINK_FIRST : QR_LINK_RENEWED)));
        });

        const { result } = renderHook(() => useChannelAPairing(true));
        await settle();

        expect(result.current.phase).toBe('free');
        expect(result.current.qr?.deepLink).toBe(QR_LINK_FIRST);
        expect(statusMock).toHaveBeenCalledTimes(1);
        expect(issueMock).toHaveBeenCalledTimes(1);

        // free -> pending: the poll continues exactly once per interval, never overlapping.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(result.current.phase).toBe('pending');
        expect(result.current.qr).toBeNull();
        expect(issueMock).toHaveBeenCalledTimes(1);

        // pending -> linked: still no issuance; polling keeps running.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(statusMock).toHaveBeenCalledTimes(3);
        expect(result.current.phase).toBe('linked');
        expect(result.current.qr).toBeNull();
        expect(issueMock).toHaveBeenCalledTimes(1);

        // linked is NOT terminal: polling must continue to observe an unlink.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(statusMock).toHaveBeenCalledTimes(4);
        expect(result.current.phase).toBe('linked');
        expect(issueMock).toHaveBeenCalledTimes(1);

        // linked -> free: a fresh QR is issued with a new link.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(statusMock).toHaveBeenCalledTimes(5);
        expect(result.current.phase).toBe('free');
        expect(issueMock).toHaveBeenCalledTimes(2);
        expect(result.current.qr?.deepLink).toBe(QR_LINK_RENEWED);
    });

    it('anchors the countdown at POST dispatch, counts up in ceil and hides the QR immediately at expiry', async () => {
        statusMock.mockResolvedValue(statusFixture('free'));
        let issueDispatchedAt = 0;
        issueMock.mockImplementation(() => {
            issueDispatchedAt = performance.now();
            return Promise.resolve(issueFixture(qrFixture(9)));
        });

        const { result } = renderHook(() => useChannelAPairing(true));
        await settle();

        // Deadline = dispatch + 9_000: no fake time has passed between dispatch and now.
        expect(result.current.phase).toBe('free');
        expect(performance.now() - issueDispatchedAt).toBe(0);
        expect(result.current.qr).toEqual({ deepLink: QR_LINK_FIRST, expiresInSeconds: 9 });
        expect(result.current.remainingSeconds).toBe(9);

        // Live QR: free polls while the QR is alive must NOT re-issue (no tight issuance loop).
        await advanceTimers(3_200);
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(result.current.qr).not.toBeNull();
        expect(result.current.remainingSeconds).toBe(6); // ceil(9 - 3.2)
        expect(issueMock).toHaveBeenCalledTimes(1);

        await advanceTimers(5_799);
        expect(statusMock).toHaveBeenCalledTimes(5); // polls at t=4, 6, 8
        expect(result.current.qr).not.toBeNull();
        expect(result.current.remainingSeconds).toBe(1); // ceil(0.001)
        expect(issueMock).toHaveBeenCalledTimes(1);

        // Expired: hidden immediately, remaining never negative.
        await advanceTimers(1);
        expect(result.current.qr).toBeNull();
        expect(result.current.remainingSeconds).toBe(0);
        expect(statusMock).toHaveBeenCalledTimes(5);
        expect(issueMock).toHaveBeenCalledTimes(1);

        // Renewal happens only through the next normal poll while open and last state free.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(statusMock).toHaveBeenCalledTimes(6); // poll at t=10
        expect(issueMock).toHaveBeenCalledTimes(2);
        expect(result.current.qr).toEqual({ deepLink: QR_LINK_FIRST, expiresInSeconds: 9 });
    });

    it('never exposes a QR whose TTL elapsed during a delayed response and retries only via the normal poll', async () => {
        statusMock.mockResolvedValueOnce(statusFixture('free'))
            .mockResolvedValue(statusFixture('free'));
        const delayedIssue = deferred<ChannelAPairingIssue>();
        issueMock.mockImplementationOnce(() => delayedIssue.promise)
            .mockResolvedValue(issueFixture(qrFixture(60, QR_LINK_RENEWED)));

        const { result } = renderHook(() => useChannelAPairing(true));
        await settle();

        // GET said free, POST dispatched and held: pairing is single-flight, so the status
        // poll must NOT run a concurrent GET while the issuance is in flight.
        expect(result.current.phase).toBe('free');
        expect(result.current.qr).toBeNull();
        expect(statusMock).toHaveBeenCalledTimes(1);
        expect(issueMock).toHaveBeenCalledTimes(1);

        await advanceTimers(5_000);
        expect(statusMock).toHaveBeenCalledTimes(1); // still no concurrent GET after 5 s
        expect(result.current.phase).toBe('free');
        expect(result.current.qr).toBeNull();

        // The late response expires at dispatch+3s < now (5s): it must NEVER be shown.
        await act(async () => {
            delayedIssue.resolve(issueFixture(qrFixture(3)));
            for (let tick = 0; tick < 8; tick += 1) {
                await Promise.resolve();
            }
        });
        expect(result.current.qr).toBeNull();
        expect(result.current.phase).toBe('free');
        expect(issueMock).toHaveBeenCalledTimes(1); // no immediate re-issue

        // After the normal poll delay the status says free again and the POST is renewed.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(result.current.phase).toBe('free');
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(issueMock).toHaveBeenCalledTimes(2);
        expect(result.current.qr?.deepLink).toBe(QR_LINK_RENEWED);
    });

    it('on close aborts the in-flight request, discards the QR and ignores late old-generation responses', async () => {
        const signals: AbortSignal[] = [];
        const pendingStatus = deferred<ChannelAPairingStatus>();
        statusMock.mockImplementation((signal?: AbortSignal) => {
            if (signal) signals.push(signal);
            return pendingStatus.promise;
        });

        const { result, rerender } = renderHook(
            ({ open }: { open: boolean }) => useChannelAPairing(open),
            { initialProps: { open: true } },
        );
        await settle();
        expect(result.current.phase).toBe('loading');
        expect(statusMock).toHaveBeenCalledTimes(1);
        expect(signals[0]?.aborted).toBe(false);

        rerender({ open: false });
        await settle();

        // Closed returns QR null immediately and aborts the in-flight request.
        expect(result.current.phase).toBe('closed');
        expect(result.current.qr).toBeNull();
        expect(result.current.remainingSeconds).toBe(0);
        expect(signals[0]?.aborted).toBe(true);

        // The late response of the old generation is ignored: no issuance follows it.
        await act(async () => {
            pendingStatus.resolve(statusFixture('free'));
            for (let tick = 0; tick < 6; tick += 1) {
                await Promise.resolve();
            }
        });
        expect(issueMock).not.toHaveBeenCalled();
        expect(result.current.phase).toBe('closed');
        expect(result.current.qr).toBeNull();

        // No owned timers survive the close.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS * 3);
        expect(statusMock).toHaveBeenCalledTimes(1);
        expect(issueMock).not.toHaveBeenCalled();
    });

    it('on unmount aborts the in-flight request and leaves no timer or listener alive', async () => {
        const signals: AbortSignal[] = [];
        const pendingStatus = deferred<ChannelAPairingStatus>();
        statusMock.mockImplementation((signal?: AbortSignal) => {
            if (signal) signals.push(signal);
            return pendingStatus.promise;
        });

        const { unmount } = renderHook(() => useChannelAPairing(true));
        await settle();
        expect(subscribeToResetMock).toHaveBeenCalledTimes(1);

        unmount();
        expect(signals[0]?.aborted).toBe(true);
        expect(sessionResetListeners.size).toBe(0);

        // A late response after unmount must not resurrect any behavior.
        await act(async () => {
            pendingStatus.resolve(statusFixture('free'));
            for (let tick = 0; tick < 6; tick += 1) {
                await Promise.resolve();
            }
        });
        expect(issueMock).not.toHaveBeenCalled();

        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS * 3);
        expect(statusMock).toHaveBeenCalledTimes(1);
    });

    it('on session reset while open clears the QR, restarts the GET and never revives the old generation', async () => {
        statusMock.mockResolvedValueOnce(statusFixture('free'));
        const restartedStatus = deferred<ChannelAPairingStatus>();
        statusMock.mockImplementationOnce(() => restartedStatus.promise);
        const lateIssue = deferred<ChannelAPairingIssue>();
        issueMock.mockImplementation(() => lateIssue.promise);

        const { result } = renderHook(() => useChannelAPairing(true));
        await settle();

        expect(result.current.phase).toBe('free');
        expect(result.current.qr).toBeNull(); // issuance still in flight
        expect(statusMock).toHaveBeenCalledTimes(1);
        expect(issueMock).toHaveBeenCalledTimes(1);

        await dispatchSessionResetAsync();

        // The GET restarts immediately and the QR slot is cleared.
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(result.current.qr).toBeNull();
        expect(result.current.phase).toBe('loading');

        // The old generation's late response is ordinary cleanup: a stale rejection stays quiet
        // and its QR can never appear.
        await act(async () => {
            lateIssue.reject(new PrismaStaleSessionResponse());
            for (let tick = 0; tick < 6; tick += 1) {
                await Promise.resolve();
            }
        });
        expect(result.current.qr).toBeNull();
        expect(result.current.phase).toBe('loading');
        expect(issueMock).toHaveBeenCalledTimes(1);

        // The restarted GET decides the phase; pending never issues.
        await act(async () => {
            restartedStatus.resolve(statusFixture('pending'));
            for (let tick = 0; tick < 6; tick += 1) {
                await Promise.resolve();
            }
        });
        expect(result.current.phase).toBe('pending');
        expect(result.current.qr).toBeNull();
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(issueMock).toHaveBeenCalledTimes(1);
    });

    it('subscribes to session resets while open and unsubscribes on unmount', async () => {
        statusMock.mockResolvedValue(statusFixture('free'));
        issueMock.mockResolvedValue(issueFixture(qrFixture(60)));

        const { result, unmount } = renderHook(() => useChannelAPairing(true));
        await settle();

        expect(result.current.phase).toBe('free');
        expect(subscribeToResetMock).toHaveBeenCalledTimes(1);
        expect(subscribeToResetMock.mock.calls[0]?.[0]).toBeTypeOf('function');
        expect(sessionResetListeners.size).toBe(1);

        unmount();
        expect(sessionResetListeners.size).toBe(0);

        // A reset dispatched after unmount cannot reach the unmounted hook.
        expect(() => dispatchSessionReset()).not.toThrow();
    });

    it('on a POST conflict clears the QR state and refreshes once immediately without re-issuing while free', async () => {
        // The GET never conflicts: the 409 arrives from the first POST issuance.
        statusMock.mockResolvedValue(statusFixture('free'));
        issueMock.mockRejectedValueOnce(new PrismaChannelAPairingError('conflict'))
            .mockResolvedValue(issueFixture(qrFixture(60, QR_LINK_RENEWED)));

        const { result } = renderHook(() => useChannelAPairing(true));
        await settle();

        // GET free -> first POST conflicts: QR never shown and exactly ONE immediate refresh
        // GET (no interval wait, no loop).
        expect(result.current.qr).toBeNull();
        expect(result.current.phase).toBe('free');
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(issueMock).toHaveBeenCalledTimes(1);

        // No immediate POST re-issue and no tight loop while the refresh says free.
        await settle();
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(issueMock).toHaveBeenCalledTimes(1);

        // The next issuance may only come from the normal poll cycle.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(result.current.phase).toBe('free');
        expect(statusMock).toHaveBeenCalledTimes(3);
        expect(issueMock).toHaveBeenCalledTimes(2);
        expect(result.current.qr?.deepLink).toBe(QR_LINK_RENEWED);
    });

    it('on a pairing error hides the QR, stops polling and only resumes after close and reopen', async () => {
        statusMock.mockResolvedValueOnce(statusFixture('free'))
            .mockRejectedValue(new PrismaChannelAPairingError('unavailable'));
        issueMock.mockResolvedValue(issueFixture(qrFixture(60)));

        const { result, rerender } = renderHook(
            ({ open }: { open: boolean }) => useChannelAPairing(open),
            { initialProps: { open: true } },
        );
        await settle();

        expect(result.current.qr?.deepLink).toBe(QR_LINK_FIRST);
        expect(statusMock).toHaveBeenCalledTimes(1);

        // Poll #1 fails: QR hidden, phase error.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        expect(result.current.qr).toBeNull();
        expect(result.current.phase).toBe('error');
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(issueMock).toHaveBeenCalledTimes(1);

        // No automatic retry forever: timers stopped, no further requests.
        await advanceTimers(CHANNEL_A_PAIRING_POLL_INTERVAL_MS * 3);
        expect(statusMock).toHaveBeenCalledTimes(2);
        expect(issueMock).toHaveBeenCalledTimes(1);

        // Only close + reopen restarts the cycle (which fails again while the mock errors).
        rerender({ open: false });
        await settle();
        expect(result.current.phase).toBe('closed');

        rerender({ open: true });
        await settle();
        expect(statusMock).toHaveBeenCalledTimes(3);
        expect(issueMock).toHaveBeenCalledTimes(1);
        expect(result.current.phase).toBe('error');
        expect(result.current.qr).toBeNull();
    });

    it('returns a fully closed slot on EVERY closed render immediately, even before effect cleanup', async () => {
        statusMock.mockResolvedValue(statusFixture('free'));
        issueMock.mockResolvedValue(issueFixture(qrFixture(60)));

        // Snapshots are captured INSIDE the render callback, one per closed render, and copied
        // immediately: the hook return object is fresh per render but its qr field is a shared
        // reference, so only a copy taken during that render is a trustworthy closed record.
        const closedRenderSnapshots: Array<{
            phase: ChannelAPairingPhase;
            qr: ChannelAPairingQr | null;
            remainingSeconds: number;
        }> = [];

        const { result, rerender } = renderHook(
            ({ open }: { open: boolean }) => {
                const value = useChannelAPairing(open);
                if (!open) {
                    closedRenderSnapshots.push({
                        phase: value.phase,
                        qr: value.qr === null ? null : { ...value.qr },
                        remainingSeconds: value.remainingSeconds,
                    });
                }
                return value;
            },
            { initialProps: { open: true } },
        );
        await settle();

        // Precondition: a live QR is genuinely on record before the close.
        expect(result.current.phase).toBe('free');
        expect(result.current.qr).toEqual({ deepLink: QR_LINK_FIRST, expiresInSeconds: 60 });
        expect(result.current.remainingSeconds).toBe(60);

        rerender({ open: false });
        await settle();

        // EVERY closed render — including the very first one, before the open effect's cleanup
        // and state reset flush — must already report the empty closed slot. The existing close
        // test above already covers the later flushed state via result.current; this pins the
        // render-level contract that no closed render ever leaks the previous free+QR state.
        expect(closedRenderSnapshots.length).toBeGreaterThan(0);
        for (const snapshot of closedRenderSnapshots) {
            expect(snapshot.phase).toBe('closed');
            expect(snapshot.qr).toBeNull();
            expect(snapshot.remainingSeconds).toBe(0);
        }

        // The flushed state stays consistent with the render-level contract.
        expect(result.current.phase).toBe('closed');
        expect(result.current.qr).toBeNull();
        expect(result.current.remainingSeconds).toBe(0);
    });
});
