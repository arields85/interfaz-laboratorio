import { useEffect, useState } from 'react';
import type { ChannelAPairingQr, ChannelAPairingState } from '../domain/channelAPairing.types';
import {
    PrismaChannelAPairingError,
    prismaChannelAPairing,
} from '../services/prismaChannelAPairing.service';
import { PrismaStaleSessionResponse, prismaSessionClient } from '../services/prismaSessionClient';

// One routine poll cadence for the whole pairing round: a single GET (plus at most one POST
// issuance) runs per interval, never concurrently.
export const CHANNEL_A_PAIRING_POLL_INTERVAL_MS = 2000;

// Live-QR countdown granularity: the remaining seconds are recomputed once per second from the
// deadline anchored at POST dispatch, and the QR is hidden by its own exact deadline timeout.
const COUNTDOWN_TICK_INTERVAL_MS = 1000;

// UI-only ephemeral phase for the pairing panel. This is client UI state, not an industrial
// domain type, so it lives with the hook that owns it.
export type ChannelAPairingPhase = 'closed' | 'loading' | 'error' | ChannelAPairingState;

export interface UseChannelAPairingResult {
    phase: ChannelAPairingPhase;
    qr: ChannelAPairingQr | null;
    remainingSeconds: number;
}

// Canonical closed slot, returned directly from render on every closed render so no closed
// render can ever leak the previous open state, even before the effect's cleanup flushes.
const CLOSED_RESULT: UseChannelAPairingResult = {
    phase: 'closed',
    qr: null,
    remainingSeconds: 0,
};

// Abort and stale-session rejections are ordinary quiet cleanup: the close/unmount/reset path
// already discarded that generation, so they must never surface as pairing errors.
function isQuietCleanupError(error: unknown): boolean {
    return (error instanceof DOMException && error.name === 'AbortError')
        || error instanceof PrismaStaleSessionResponse;
}

// 409 reaches this hook only as a pairing conflict thrown by the POST issuance; the status GET
// never conflicts.
function isPairingConflict(error: unknown): boolean {
    return error instanceof PrismaChannelAPairingError && error.kind === 'conflict';
}

export function useChannelAPairing(open: boolean): UseChannelAPairingResult {
    // State is initialized from the initial open prop; prop transitions are canonicalized at
    // render time below, so the effect body never adjusts state directly.
    const [phase, setPhase] = useState<ChannelAPairingPhase>(open ? 'loading' : 'closed');
    const [qr, setQr] = useState<ChannelAPairingQr | null>(null);
    const [remainingSeconds, setRemainingSeconds] = useState(0);
    const [previousOpen, setPreviousOpen] = useState(open);

    // Prop-transition canonicalization (React-permitted conditional self-state adjustment
    // during render): whenever the open prop flips, the slot is re-canonicalized synchronously
    // at render — closed stays empty, a fresh opening starts clean so no old QR can ever leak
    // on reopen — and no requests are made during render. The effect below only owns the
    // subscription, the requests and the timers.
    if (open !== previousOpen) {
        setPreviousOpen(open);
        setPhase(open ? 'loading' : 'closed');
        setQr(null);
        setRemainingSeconds(0);
    }

    useEffect(() => {
        if (!open) {
            // Closed: no subscription and no owned timers; the canonical empty slot is already
            // guaranteed by the render-time adjustment and the render-level return below.
            return;
        }

        // Per-effect-instance lifecycle guards. Every async continuation re-checks them, so a
        // late old-generation response can never set state, re-issue, or schedule another poll.
        let disposed = false;
        let roundEpoch = 0;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        let countdownTimer: ReturnType<typeof setInterval> | null = null;
        let expiryTimer: ReturnType<typeof setTimeout> | null = null;
        let qrDeadline: number | null = null;
        let activeController: AbortController | null = null;

        const isCurrent = (epoch: number, signal: AbortSignal): boolean =>
            !disposed && epoch === roundEpoch && !signal.aborted;

        const clearCountdownTimers = (): void => {
            if (countdownTimer !== null) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }
            if (expiryTimer !== null) {
                clearTimeout(expiryTimer);
                expiryTimer = null;
            }
            qrDeadline = null;
        };

        const hasLiveQr = (): boolean => qrDeadline !== null && performance.now() < qrDeadline;

        const clearQr = (): void => {
            clearCountdownTimers();
            setQr(null);
            setRemainingSeconds(0);
        };

        const stopPolling = (): void => {
            if (pollTimer !== null) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
        };

        const abortActiveRequest = (): void => {
            if (activeController !== null) {
                activeController.abort();
                activeController = null;
            }
        };

        const applyQr = (issued: ChannelAPairingQr, deadline: number): void => {
            // The QR payload keeps the original server value; remaining time is derived
            // separately from the dispatch-anchored deadline and never mutates the payload.
            qrDeadline = deadline;
            setQr(issued);
            setRemainingSeconds(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
            countdownTimer = setInterval(() => {
                if (qrDeadline === null) return;
                const remainingMs = qrDeadline - performance.now();
                setRemainingSeconds(remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 1000));
            }, COUNTDOWN_TICK_INTERVAL_MS);
            expiryTimer = setTimeout(() => {
                // Hide exactly at the deadline; renewal happens only through the next routine
                // poll, never as an immediate POST from expiry.
                clearQr();
            }, Math.max(0, deadline - performance.now()));
        };

        const schedulePoll = (): void => {
            // Exactly one pending poll timer: each round schedules once after it settles, and
            // timers are cleared on close, unmount and session reset.
            if (pollTimer !== null) return;
            pollTimer = setTimeout(() => {
                pollTimer = null;
                void runRound(true);
            }, CHANNEL_A_PAIRING_POLL_INTERVAL_MS);
        };

        const runRound = async (allowIssue: boolean): Promise<void> => {
            if (disposed) return;
            const epoch = roundEpoch;
            const controller = new AbortController();
            activeController = controller;

            try {
                const status = await prismaChannelAPairing.status(controller.signal);
                if (!isCurrent(epoch, controller.signal)) return;

                setPhase(status.state);
                if (status.state !== 'free') {
                    clearQr();
                    // 'unavailable' is terminal until close/reopen; pending and linked keep the
                    // routine poll running (linked must observe a phone unlink).
                    if (status.state === 'unavailable') return;
                    schedulePoll();
                    return;
                }

                // Free with a live QR: keep showing it, the routine poll only observes. A
                // conflict refresh (allowIssue=false) observes without re-issuing.
                if (hasLiveQr() || !allowIssue) {
                    schedulePoll();
                    return;
                }

                // The countdown deadline is anchored at POST dispatch, never at arrival.
                const dispatchedAt = performance.now();
                const issue = await prismaChannelAPairing.issue(controller.signal);
                if (!isCurrent(epoch, controller.signal)) return;

                const deadline = dispatchedAt + issue.qr.expiresInSeconds * 1000;
                if (performance.now() >= deadline) {
                    // The TTL elapsed while the response was in flight: the QR is never shown
                    // and renewal waits for the next routine poll.
                    schedulePoll();
                    return;
                }
                applyQr(issue.qr, deadline);
                schedulePoll();
            } catch (error) {
                if (!isCurrent(epoch, controller.signal)) return;
                if (isQuietCleanupError(error)) return;
                if (isPairingConflict(error)) {
                    // 409 from the POST: clear the QR slot, then exactly ONE immediate refresh
                    // GET. The refresh never re-issues while the state is free; the next
                    // issuance may only come from the routine poll it schedules.
                    clearQr();
                    await runRound(false);
                    return;
                }
                // Honest terminal failure: hide the QR and stop polling until close/reopen.
                setPhase('error');
                clearQr();
            }
        };

        const handleSessionReset = (): void => {
            if (disposed) return;
            // A session reset invalidates the current generation: the fresh GET decides the
            // phase, and the old generation's late responses stay quiet cleanup.
            roundEpoch += 1;
            stopPolling();
            abortActiveRequest();
            clearQr();
            setPhase('loading');
            void runRound(true);
        };

        const unsubscribeFromSessionReset = prismaSessionClient.subscribeToReset(handleSessionReset);

        // The fresh-opening canonical state (loading / empty slot) was already applied at render
        // time by the prop-transition adjustment above; the effect only starts the round.
        void runRound(true);

        return () => {
            // Cleanup never touches React state (it also runs on unmount): it only discards
            // timers, aborts the in-flight request and drops the reset subscription.
            disposed = true;
            roundEpoch += 1;
            unsubscribeFromSessionReset();
            stopPolling();
            clearCountdownTimers();
            abortActiveRequest();
        };
    }, [open]);

    // Render-level normalization: while closed, the empty slot is returned immediately from the
    // render itself (before any effect runs); all hooks above already executed unconditionally.
    return open ? { phase, qr, remainingSeconds } : CLOSED_RESULT;
}
