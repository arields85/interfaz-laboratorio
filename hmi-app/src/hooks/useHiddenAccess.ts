import { useSyncExternalStore } from 'react';

import { isHiddenAccessRevealed, subscribeHiddenAccess } from '../services/hiddenAccess.service';

/** Whether this browser currently shows the users icon and the Leda control. */
export function useHiddenAccess(): boolean {
    return useSyncExternalStore(subscribeHiddenAccess, isHiddenAccessRevealed, () => false);
}
