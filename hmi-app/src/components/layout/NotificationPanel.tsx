import { X } from 'lucide-react';

import { allowedChannelBAccessDecisions, type ChannelBAccessChat, type ChannelBAccessDecision } from '../../domain';
import AdminActionButton from '../admin/AdminActionButton';
import ChannelBAccessIdentity from '../admin/channelBAccess/ChannelBAccessIdentity';
import {
    DECISION_LABELS,
    FEEDBACK_TONE_CLS,
    type ChannelBAccessFeedback,
} from '../admin/channelBAccess/channelBAccessCopy';

interface NotificationPanelProps {
    // Pending Channel B access requests: the first (and today only) notification type.
    requests: readonly ChannelBAccessChat[];
    loading: boolean;
    // Replaces the list when it could not be read.
    errorMessage: string | null;
    // Disables every action while one decision is being sent.
    busy: boolean;
    feedback: ChannelBAccessFeedback | null;
    onDecision: (chat: ChannelBAccessChat, decision: ChannelBAccessDecision) => void;
    onClose: () => void;
}

// Presentational notification list, anchored under the topbar like the background panel.
export default function NotificationPanel({
    requests,
    loading,
    errorMessage,
    busy,
    feedback,
    onDecision,
    onClose,
}: NotificationPanelProps) {
    return (
        <div
            role="dialog"
            aria-label="Notificaciones"
            data-notification-panel
            className="fixed top-16 right-4 z-50 flex max-h-[calc(var(--viewport-height)-5rem)] w-80 flex-col overflow-hidden rounded-xl border border-industrial-border bg-industrial-surface/90 shadow-2xl backdrop-blur-xl"
        >
            <div className="flex shrink-0 items-center justify-between border-b border-industrial-border bg-industrial-surface/95 px-4 py-3">
                <h3 className="uppercase text-industrial-muted">Notificaciones</h3>
                <button
                    type="button"
                    onClick={onClose}
                    title="Cerrar panel"
                    aria-label="Cerrar notificaciones"
                    className="rounded p-1 text-industrial-muted transition-colors hover:bg-white/10 hover:text-white"
                >
                    <X size={14} />
                </button>
            </div>

            <div className="hmi-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3">
                {errorMessage ? (
                    <p className="text-industrial-muted" aria-live="polite">{errorMessage}</p>
                ) : loading ? (
                    <p className="text-industrial-muted" aria-live="polite">Cargando notificaciones...</p>
                ) : requests.length === 0 ? (
                    <p className="text-industrial-muted">No hay notificaciones.</p>
                ) : (
                    <section className="flex flex-col gap-2">
                        <h4 className="uppercase text-industrial-muted">
                            {`Solicitudes de acceso al Canal B (${requests.length})`}
                        </h4>
                        <ul className="flex flex-col gap-2">
                            {requests.map((chat) => (
                                <li
                                    key={chat.chatId}
                                    className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2"
                                >
                                    <ChannelBAccessIdentity chat={chat} />
                                    <div className="flex items-center gap-2">
                                        {allowedChannelBAccessDecisions('pending').map((decision) => (
                                            <AdminActionButton
                                                key={decision}
                                                variant={decision === 'approve' ? 'primary' : 'secondary'}
                                                disabled={busy}
                                                onClick={() => onDecision(chat, decision)}
                                            >
                                                {DECISION_LABELS[decision]}
                                            </AdminActionButton>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {feedback ? (
                    <p role="status" className={FEEDBACK_TONE_CLS[feedback.kind]}>{feedback.text}</p>
                ) : null}
            </div>
        </div>
    );
}
