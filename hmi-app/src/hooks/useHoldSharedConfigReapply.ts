import { useEffect } from 'react';

import { holdSharedConfigReapply } from '../services/sharedConfigReapplyHold.service';

/**
 * While `active`, remote configuration changes are not re-applied to the document, so an editor
 * with unsaved drafts keeps its live preview. The held changes apply when it turns inactive or unmounts.
 */
export function useHoldSharedConfigReapply(active: boolean): void {
    useEffect(() => {
        if (!active) return undefined;
        return holdSharedConfigReapply();
    }, [active]);
}
