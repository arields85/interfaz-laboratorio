import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deferWhileHeld, setHeldChangesHandler } from '../services/sharedConfigReapplyHold.service';
import { useHoldSharedConfigReapply } from './useHoldSharedConfigReapply';

describe('useHoldSharedConfigReapply', () => {
    afterEach(() => setHeldChangesHandler(null));

    it('holds remote changes only while active and hands them over on release', () => {
        const handler = vi.fn();
        setHeldChangesHandler(handler);
        const { rerender, unmount } = renderHook(({ active }) => useHoldSharedConfigReapply(active), {
            initialProps: { active: false },
        });

        expect(deferWhileHeld(['hmi-frame-shape'])).toBe(false);

        rerender({ active: true });
        expect(deferWhileHeld(['hmi-frame-shape'])).toBe(true);
        expect(handler).not.toHaveBeenCalled();

        rerender({ active: false });
        expect(handler).toHaveBeenCalledWith(['hmi-frame-shape']);

        rerender({ active: true });
        unmount();
        expect(deferWhileHeld(['hmi-frame-shape'])).toBe(false);
    });
});
