import { useCallback, useState } from 'react';

const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_COALESCE_WINDOW_MS = 500;

export interface HistoryStateOptions<T> {
    /** Maximum number of undoable steps kept; the oldest step is dropped once exceeded. */
    limit?: number;
    /** Time window, in ms, within which consecutive committed changes merge into one step. */
    coalesceWindowMs?: number;
    /**
     * Cheap equality check used to skip recording a step for a no-op `set` call. Defaults to
     * reference equality (`Object.is`): callers in this codebase always produce a new object
     * reference via immutable spreads when a draft actually changes (see the
     * `setDraft(prev => { if (!prev) return prev; ... })` bail-out pattern already used
     * throughout `DashboardBuilderPage`), so a cheap identity check filters genuine no-ops
     * without paying for a deep compare of the whole dashboard tree on every keystroke.
     */
    isEqual?: (a: T, b: T) => boolean;
    /** Injectable clock, so coalescing is deterministic in tests. Defaults to `Date.now`. */
    now?: () => number;
}

export interface SetValueOptions {
    /**
     * When `false`, this change always becomes its own history step, even if it happens
     * within the coalescing window of the previous change, and it becomes a hard boundary
     * that a later default-coalescing change cannot merge backward across. Discrete,
     * deliberate actions (add/delete/duplicate a widget, confirm a dialog, commit a drag or
     * resize) should pass `false`; continuous edits (typing in a property field) can rely on
     * the default (`true`).
     */
    coalesce?: boolean;
    /**
     * When `true`, updates the live value without recording a history step. Used for a
     * continuous, not-yet-committed preview (e.g. a drag/resize driven purely by pointer
     * movement). The eventual non-transient `set` call that concludes the sequence records
     * exactly one step, comparing against the value from before the sequence started.
     */
    transient?: boolean;
}

export interface HistoryStateApi<T> {
    value: T;
    set: (next: T | ((prev: T) => T), options?: SetValueOptions) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    /** Clears past/future and re-baselines on `value` (e.g. loading a different dashboard). */
    reset: (value: T) => void;
    /**
     * Replaces the current value in place without recording a step and without touching
     * past/future (e.g. re-syncing the draft with the server response after Save/Publish,
     * which must keep history intact).
     */
    replaceCurrent: (value: T) => void;
}

interface TransientBase<T> {
    value: T;
}

interface InternalHistoryState<T> {
    past: T[];
    current: T;
    future: T[];
    lastCommitAt: number | null;
    transientBase: TransientBase<T> | null;
}

function createInitialState<T>(value: T): InternalHistoryState<T> {
    return { past: [], current: value, future: [], lastCommitAt: null, transientBase: null };
}

function boundPast<T>(past: T[], limit: number): T[] {
    return past.length > limit ? past.slice(past.length - limit) : past;
}

/**
 * Generic undo/redo history over a single value. All bookkeeping (past/future stacks,
 * coalescing clock, in-flight transient base) lives in one `useState` object updated through
 * pure functional updaters, so it renders from ordinary React state (never a ref read during
 * render) and stays correct under React StrictMode's double-invocation of updater functions.
 */
export function useHistoryState<T>(
    initialValue: T,
    options: HistoryStateOptions<T> = {},
): HistoryStateApi<T> {
    const {
        limit = DEFAULT_HISTORY_LIMIT,
        coalesceWindowMs = DEFAULT_COALESCE_WINDOW_MS,
        isEqual = Object.is,
        now = Date.now,
    } = options;

    const [state, setState] = useState<InternalHistoryState<T>>(() => createInitialState(initialValue));

    const set = useCallback((next: T | ((prev: T) => T), setOptions: SetValueOptions = {}) => {
        setState((prevState) => {
            const resolvedNext = typeof next === 'function'
                ? (next as (prev: T) => T)(prevState.current)
                : next;

            if (setOptions.transient) {
                if (isEqual(resolvedNext, prevState.current)) {
                    return prevState;
                }

                return {
                    ...prevState,
                    current: resolvedNext,
                    transientBase: prevState.transientBase ?? { value: prevState.current },
                };
            }

            const transientBase = prevState.transientBase;
            const concludesTransient = transientBase !== null;
            const baseValue = transientBase ? transientBase.value : prevState.current;

            if (isEqual(resolvedNext, baseValue)) {
                // Net no-op — including a transient sequence that returned to its start value.
                return {
                    ...prevState,
                    current: resolvedNext,
                    transientBase: null,
                };
            }

            const explicitNoCoalesce = setOptions.coalesce === false;
            const shouldCoalesce = !concludesTransient
                && !explicitNoCoalesce
                && prevState.lastCommitAt !== null
                && (now() - prevState.lastCommitAt) <= coalesceWindowMs;

            const nextPast = shouldCoalesce
                ? prevState.past
                : boundPast([...prevState.past, baseValue], limit);

            return {
                past: nextPast,
                current: resolvedNext,
                future: [],
                transientBase: null,
                // An explicit hard step, or one concluding a transient sequence, is itself a
                // boundary: nothing may merge backward into it, so the clock resets.
                lastCommitAt: (explicitNoCoalesce || concludesTransient) ? null : now(),
            };
        });
    }, [coalesceWindowMs, isEqual, limit, now]);

    const undo = useCallback(() => {
        setState((prevState) => {
            if (prevState.past.length === 0) {
                return prevState;
            }

            const previous = prevState.past[prevState.past.length - 1];

            return {
                past: prevState.past.slice(0, -1),
                current: previous,
                future: [prevState.current, ...prevState.future],
                transientBase: null,
                lastCommitAt: null,
            };
        });
    }, []);

    const redo = useCallback(() => {
        setState((prevState) => {
            if (prevState.future.length === 0) {
                return prevState;
            }

            const [next, ...rest] = prevState.future;

            return {
                past: boundPast([...prevState.past, prevState.current], limit),
                current: next,
                future: rest,
                transientBase: null,
                lastCommitAt: null,
            };
        });
    }, [limit]);

    const reset = useCallback((value: T) => {
        setState(createInitialState(value));
    }, []);

    const replaceCurrent = useCallback((value: T) => {
        setState((prevState) => ({
            ...prevState,
            current: value,
            transientBase: null,
            lastCommitAt: null,
        }));
    }, []);

    return {
        value: state.current,
        set,
        undo,
        redo,
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0,
        reset,
        replaceCurrent,
    };
}
