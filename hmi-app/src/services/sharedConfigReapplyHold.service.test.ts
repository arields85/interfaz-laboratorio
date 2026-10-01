import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deferWhileHeld,
    holdSharedConfigReapply,
    setHeldChangesHandler,
} from './sharedConfigReapplyHold.service';

describe('sharedConfigReapplyHold', () => {
    afterEach(() => { setHeldChangesHandler(null); });

    it('does not defer while nothing holds the re-apply', () => {
        expect(deferWhileHeld(['hmi:a'])).toBe(false);
    });

    it('hands the deferred keys to the handler when the last hold is released', () => {
        const handler = vi.fn();
        setHeldChangesHandler(handler);
        const releaseA = holdSharedConfigReapply();
        const releaseB = holdSharedConfigReapply();

        expect(deferWhileHeld(['hmi:a'])).toBe(true);
        expect(deferWhileHeld(['hmi:b', 'hmi:a'])).toBe(true);
        releaseA();
        expect(handler).not.toHaveBeenCalled();
        releaseB();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(['hmi:a', 'hmi:b']);
    });

    it('keeps the deferred keys when no handler exists at release and delivers them once one is set', () => {
        const release = holdSharedConfigReapply();
        deferWhileHeld(['hmi:a']);
        release();

        const handler = vi.fn();
        setHeldChangesHandler(handler);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(['hmi:a']);

        // Delivered once: a later handler gets nothing.
        const next = vi.fn();
        setHeldChangesHandler(next);
        expect(next).not.toHaveBeenCalled();
    });
});
