import { useEffect, useState } from 'react';

import { sharedConfigStorage } from '../services/sharedConfigStorage.service';

/**
 * Counts the remote changes (made by another browser) that touched any of `keys`.
 * Put the returned number in a load effect's dependencies so the view re-reads the
 * shared configuration when an administrator elsewhere changed it. Local saves do not
 * count: the adapter only notifies about changes that arrived from the server.
 * Pass a stable array (a module-level constant) so the subscription is not recreated.
 */
export function useSharedConfigVersion(keys: readonly string[]): number {
    const [version, setVersion] = useState(0);

    useEffect(() => sharedConfigStorage.subscribe(({ changedKeys }) => {
        if (changedKeys.some((key) => keys.includes(key))) {
            setVersion((current) => current + 1);
        }
    }), [keys]);

    return version;
}
