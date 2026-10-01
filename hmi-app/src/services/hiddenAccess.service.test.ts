import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    HIDDEN_ACCESS_STORAGE_KEY,
    isHiddenAccessRevealed,
    setHiddenAccessRevealed,
    subscribeHiddenAccess,
    toggleHiddenAccess,
} from './hiddenAccess.service';
import { SHARED_CONFIG_KEYS } from '../domain/sharedConfig.types';

describe('hidden access flag', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('is hidden by default', () => {
        expect(isHiddenAccessRevealed()).toBe(false);
    });

    it('persists the revealed state in this browser only, never in the shared configuration', () => {
        setHiddenAccessRevealed(true);

        expect(localStorage.getItem(HIDDEN_ACCESS_STORAGE_KEY)).toBe('on');
        expect(isHiddenAccessRevealed()).toBe(true);
        expect(SHARED_CONFIG_KEYS).not.toContain(HIDDEN_ACCESS_STORAGE_KEY);

        setHiddenAccessRevealed(false);

        expect(localStorage.getItem(HIDDEN_ACCESS_STORAGE_KEY)).toBeNull();
        expect(isHiddenAccessRevealed()).toBe(false);
    });

    it('toggles and returns the new state', () => {
        expect(toggleHiddenAccess()).toBe(true);
        expect(toggleHiddenAccess()).toBe(false);
    });

    it('treats any stored value other than the exact on marker as hidden', () => {
        localStorage.setItem(HIDDEN_ACCESS_STORAGE_KEY, 'true');

        expect(isHiddenAccessRevealed()).toBe(false);
    });

    it('notifies subscribers on change and stops after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeHiddenAccess(listener);

        setHiddenAccessRevealed(true);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        setHiddenAccessRevealed(false);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('follows a change made in another tab of the same browser', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeHiddenAccess(listener);

        window.dispatchEvent(new StorageEvent('storage', { key: HIDDEN_ACCESS_STORAGE_KEY, newValue: 'on' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'on' }));

        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('stays hidden and does not throw when storage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });

        expect(isHiddenAccessRevealed()).toBe(false);
        expect(() => setHiddenAccessRevealed(true)).not.toThrow();
    });
});
