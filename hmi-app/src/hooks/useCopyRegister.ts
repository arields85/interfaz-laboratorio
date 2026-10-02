import { useSyncExternalStore } from 'react';

import { DEFAULT_COPY_REGISTER } from '../domain/copyRegister';
import type { CopyRegister } from '../domain/copyRegister';
import { readCopyRegister } from '../services/copyRegister.service';
import { sharedConfigStorage } from '../services/sharedConfigStorage.service';

// Remote changes (the poll) and this browser's own staged writes both reach the subscribers.
function subscribe(onChange: () => void): () => void {
    const unsubscribeRemote = sharedConfigStorage.subscribe(() => onChange());
    const unsubscribeLocal = sharedConfigStorage.subscribeStatus(onChange);
    return () => {
        unsubscribeRemote();
        unsubscribeLocal();
    };
}

/** Active copy register of the HMI; re-renders when the shared configuration changes it. */
export function useCopyRegister(): CopyRegister {
    return useSyncExternalStore(subscribe, readCopyRegister, () => DEFAULT_COPY_REGISTER);
}
