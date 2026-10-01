import { AlertTriangle } from 'lucide-react';

import { HmiButton } from '../ui';
import { CONTEXT_BAR_NOTICE_WARNING_TONE_CLS } from '../admin/ContextBarNotice';
import { useAuthStore } from '../../store/auth.store';

// Shown on whatever route the browser lands on after another login displaced this administrator
// session. It lives next to the session lifecycle (above every route) because the auth store's
// `error` is only visible while the login overlay is open, and a plain viewer keeps it hidden.
export default function SessionReplacedNotice() {
    const replaced = useAuthStore((state) => state.sessionReplaced);

    if (!replaced) return null;

    return (
        <div
            role="alert"
            className={`fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-industrial-border px-6 py-2 backdrop-blur-xl ${CONTEXT_BAR_NOTICE_WARNING_TONE_CLS}`}
        >
            <AlertTriangle size={14} />
            <span>Su sesión se cerró porque se inició sesión en otro equipo.</span>
            <HmiButton
                variant="secondary"
                size="sm"
                onClick={() => useAuthStore.setState({ sessionReplaced: false })}
            >
                Entendido
            </HmiButton>
        </div>
    );
}
