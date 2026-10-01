import { useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';

import { HmiButton } from '../ui';
import { sharedConfigStorage } from '../../services/sharedConfigStorage.service';
import { CONTEXT_BAR_NOTICE_WARNING_TONE_CLS } from './ContextBarNotice';

type SaveStatusSource = Pick<typeof sharedConfigStorage, 'getStatus' | 'subscribeStatus' | 'retrySave'>;

interface SharedConfigSaveNoticeProps {
    storage?: SaveStatusSource;
}

// Admin-only strip shown while a configuration save has not reached the server. The
// viewer never mounts it (it lives in AdminLayout), so a plain browser stays untouched.
export default function SharedConfigSaveNotice({ storage = sharedConfigStorage }: SharedConfigSaveNoticeProps) {
    const status = useSyncExternalStore(storage.subscribeStatus, storage.getStatus);

    if (status.saveError === null) return null;

    return (
        <div
            role="alert"
            className={`flex shrink-0 items-center justify-center gap-3 px-6 py-1.5 ${CONTEXT_BAR_NOTICE_WARNING_TONE_CLS}`}
        >
            <AlertTriangle size={14} />
            <span>No se pudo guardar la configuración en el servidor.</span>
            <HmiButton variant="secondary" size="sm" onClick={() => { void storage.retrySave(); }}>
                Reintentar
            </HmiButton>
        </div>
    );
}
