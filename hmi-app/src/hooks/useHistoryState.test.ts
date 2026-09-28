import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHistoryState } from './useHistoryState';

describe('useHistoryState', () => {
    it('starts with the initial value and no undo/redo available', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        expect(result.current.value).toEqual({ count: 0 });
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });

    it('set() updates the value and enables undo', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.set({ count: 1 }, { coalesce: false }));

        expect(result.current.value).toEqual({ count: 1 });
        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(false);
    });

    it('undo() reverts to the previous value and enables redo', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.set({ count: 1 }, { coalesce: false }));
        act(() => result.current.undo());

        expect(result.current.value).toEqual({ count: 0 });
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(true);
    });

    it('redo() reapplies an undone change', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.set({ count: 1 }, { coalesce: false }));
        act(() => result.current.undo());
        act(() => result.current.redo());

        expect(result.current.value).toEqual({ count: 1 });
        expect(result.current.canRedo).toBe(false);
    });

    it('undo() and redo() are no-ops when their stacks are empty', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.undo());
        act(() => result.current.redo());

        expect(result.current.value).toEqual({ count: 0 });
    });

    it('set() after undo clears the redo stack (a new branch discards the old future)', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.set({ count: 1 }, { coalesce: false }));
        act(() => result.current.set({ count: 2 }, { coalesce: false }));
        act(() => result.current.undo());

        expect(result.current.canRedo).toBe(true);

        act(() => result.current.set({ count: 5 }, { coalesce: false }));

        expect(result.current.canRedo).toBe(false);

        act(() => result.current.undo());

        expect(result.current.value).toEqual({ count: 1 });
    });

    it('reset() clears past and future and re-baselines on the given value', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.set({ count: 1 }, { coalesce: false }));
        act(() => result.current.undo());
        act(() => result.current.reset({ count: 42 }));

        expect(result.current.value).toEqual({ count: 42 });
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });

    it('replaceCurrent() swaps the value without recording a step or touching past/future', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.set({ count: 1 }, { coalesce: false }));
        act(() => result.current.replaceCurrent({ count: 99 }));

        expect(result.current.value).toEqual({ count: 99 });
        expect(result.current.canUndo).toBe(true);

        act(() => result.current.undo());

        expect(result.current.value).toEqual({ count: 0 });
    });

    it('does not record a step when the exact same reference is set again (cheap identity check)', () => {
        const same = { count: 0 };
        const { result } = renderHook(() => useHistoryState(same));

        act(() => result.current.set(same, { coalesce: false }));

        expect(result.current.canUndo).toBe(false);
    });

    it('records a step for a structurally identical but new object reference (no deep compare)', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.set({ count: 0 }, { coalesce: false }));

        expect(result.current.canUndo).toBe(true);
    });

    it('bounds history size, dropping the oldest step once the limit is exceeded', () => {
        const { result } = renderHook(() => useHistoryState(0, { limit: 3 }));

        act(() => {
            result.current.set(1, { coalesce: false });
            result.current.set(2, { coalesce: false });
            result.current.set(3, { coalesce: false });
            result.current.set(4, { coalesce: false });
        });

        act(() => result.current.undo());
        act(() => result.current.undo());
        act(() => result.current.undo());

        expect(result.current.value).toBe(1);
        expect(result.current.canUndo).toBe(false);
    });

    it('coalesces consecutive changes within the time window into a single undo step', () => {
        let now = 1000;
        const { result } = renderHook(() => useHistoryState('', { now: () => now }));

        act(() => result.current.set('a'));
        now += 100;
        act(() => result.current.set('ab'));
        now += 100;
        act(() => result.current.set('abc'));

        expect(result.current.value).toBe('abc');

        act(() => result.current.undo());

        expect(result.current.value).toBe('');
        expect(result.current.canUndo).toBe(false);
    });

    it('does not coalesce once the time window has elapsed', () => {
        let now = 1000;
        const { result } = renderHook(() => useHistoryState('', { now: () => now, coalesceWindowMs: 500 }));

        act(() => result.current.set('a'));
        now += 600;
        act(() => result.current.set('ab'));

        act(() => result.current.undo());
        expect(result.current.value).toBe('a');

        act(() => result.current.undo());
        expect(result.current.value).toBe('');
    });

    it('an explicit coalesce:false always creates its own step even within the window', () => {
        let now = 1000;
        const { result } = renderHook(() => useHistoryState('', { now: () => now }));

        act(() => result.current.set('a', { coalesce: false }));
        now += 10;
        act(() => result.current.set('ab', { coalesce: false }));

        act(() => result.current.undo());

        expect(result.current.value).toBe('a');
    });

    it('a hard (coalesce:false) step is a boundary a later default-coalescing set cannot merge across', () => {
        let now = 1000;
        const { result } = renderHook(() => useHistoryState('base', { now: () => now }));

        act(() => result.current.set('widget-added', { coalesce: false }));
        now += 10;
        act(() => result.current.set('widget-added-t'));

        act(() => result.current.undo());
        expect(result.current.value).toBe('widget-added');

        act(() => result.current.undo());
        expect(result.current.value).toBe('base');
    });

    it('transient updates change the live value without recording any step', () => {
        const { result } = renderHook(() => useHistoryState({ x: 0 }));

        act(() => result.current.set({ x: 5 }, { transient: true }));

        expect(result.current.value).toEqual({ x: 5 });
        expect(result.current.canUndo).toBe(false);
    });

    it('a commit that concludes a transient sequence records exactly one step from the pre-drag value', () => {
        const { result } = renderHook(() => useHistoryState({ x: 0 }));

        act(() => result.current.set({ x: 3 }, { transient: true }));
        act(() => result.current.set({ x: 7 }, { transient: true }));
        act(() => result.current.set({ x: 10 }, { coalesce: false }));

        expect(result.current.value).toEqual({ x: 10 });
        expect(result.current.canUndo).toBe(true);

        act(() => result.current.undo());

        expect(result.current.value).toEqual({ x: 0 });
        expect(result.current.canUndo).toBe(false);
    });

    it('a transient sequence that returns to its exact starting reference commits no step', () => {
        const initial = { x: 0 };
        const { result } = renderHook(() => useHistoryState(initial));

        act(() => result.current.set({ x: 3 }, { transient: true }));
        act(() => result.current.set(initial, { coalesce: false }));

        expect(result.current.value).toBe(initial);
        expect(result.current.canUndo).toBe(false);
    });

    it('mapAll() transforms every past, current and future entry without recording a step', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0, tag: 'a' }));

        act(() => result.current.set({ count: 1, tag: 'a' }, { coalesce: false }));
        act(() => result.current.set({ count: 2, tag: 'a' }, { coalesce: false }));
        act(() => result.current.undo());

        // Now: past = [{count:0,tag:'a'}], current = {count:1,tag:'a'}, future = [{count:2,tag:'a'}]
        act(() => result.current.mapAll((entry) => ({ ...entry, tag: 'b' })));

        expect(result.current.value).toEqual({ count: 1, tag: 'b' });
        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(true);

        act(() => result.current.undo());
        expect(result.current.value).toEqual({ count: 0, tag: 'b' });

        act(() => result.current.redo());
        act(() => result.current.redo());
        expect(result.current.value).toEqual({ count: 2, tag: 'b' });
    });

    it('mapAll() does not create an undo step for the transform itself', () => {
        const { result } = renderHook(() => useHistoryState({ count: 0 }));

        act(() => result.current.mapAll((entry) => ({ ...entry, count: entry.count + 1 })));

        expect(result.current.value).toEqual({ count: 1 });
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });
});
