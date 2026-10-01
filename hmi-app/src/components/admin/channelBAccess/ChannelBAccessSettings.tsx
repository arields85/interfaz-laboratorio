import { RefreshCw, UserCheck } from 'lucide-react';
import { useState } from 'react';

import type { ChannelBAccessChat, ChannelBAccessDecision } from '../../../domain';
import {
    useChannelBAccess,
    type ChannelBAccessClient,
    type ChannelBAccessController,
} from '../../../hooks/useChannelBAccess';
import AdminDestructiveDialog from '../AdminDestructiveDialog';
import AdminIconToolbarButton from '../AdminIconToolbarButton';
import { ADMIN_SIDEBAR_SECTION_CLS, ADMIN_SIDEBAR_SECTION_HEADER_CLS } from '../adminSidebarStyles';
import ChannelBAccessList from './ChannelBAccessList';
import {
    channelBAccessDecisionFeedback,
    channelBAccessDisplayName,
    channelBAccessErrorText,
    FEEDBACK_TONE_CLS,
    type ChannelBAccessFeedback,
} from './channelBAccessCopy';

interface ChannelBAccessSettingsProps {
    active: boolean;
    client?: ChannelBAccessClient;
    controller?: ChannelBAccessController;
}

// "Acceso al Canal B" in Configuración general -> Leda: who may use the Telegram assistant.
// Container: owns the query, the revoke confirmation and the feedback line.
export default function ChannelBAccessSettings({ active, client, controller }: ChannelBAccessSettingsProps) {
    const access = useChannelBAccess({ client, controller, enabled: active });
    const [feedback, setFeedback] = useState<ChannelBAccessFeedback | null>(null);
    const [revoking, setRevoking] = useState<ChannelBAccessChat | null>(null);

    const submit = async (chat: ChannelBAccessChat, decision: ChannelBAccessDecision) => {
        try {
            setFeedback(channelBAccessDecisionFeedback(decision, await access.decide(chat.chatId, decision)));
        } catch (error) {
            setFeedback({ kind: 'error', text: channelBAccessErrorText(error) });
        }
    };

    const handleDecision = (chat: ChannelBAccessChat, decision: ChannelBAccessDecision) => {
        if (decision === 'revoke') {
            setRevoking(chat);
            return;
        }
        void submit(chat, decision);
    };

    const confirmRevoke = () => {
        if (!revoking) return;
        const chat = revoking;
        setRevoking(null);
        void submit(chat, 'revoke');
    };

    return (
        <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`} aria-label="Acceso al Canal B">
            <div className={`${ADMIN_SIDEBAR_SECTION_HEADER_CLS} justify-between`}>
                <span className="flex items-center gap-1.5">
                    <UserCheck size={14} aria-hidden="true" />
                    Acceso al Canal B
                </span>
                <AdminIconToolbarButton
                    label="Actualizar solicitudes"
                    icon={RefreshCw}
                    onClick={() => { void access.refresh(); }}
                />
            </div>

            {access.error ? (
                <p className="text-industrial-muted" aria-live="polite">{channelBAccessErrorText(access.error)}</p>
            ) : access.chats === null ? (
                <p className="text-industrial-muted" aria-live="polite">Cargando solicitudes de acceso...</p>
            ) : access.chats.length === 0 ? (
                <p className="text-industrial-muted">No hay solicitudes de acceso.</p>
            ) : (
                <ChannelBAccessList
                    chats={access.chats}
                    busy={access.pendingChatId !== null}
                    onDecision={handleDecision}
                />
            )}

            {feedback ? (
                <p role="status" className={`mt-3 ${FEEDBACK_TONE_CLS[feedback.kind]}`}>{feedback.text}</p>
            ) : null}

            <AdminDestructiveDialog
                open={revoking !== null}
                title="Revocar acceso"
                onClose={() => setRevoking(null)}
                onConfirm={confirmRevoke}
                warningMessage="La persona dejará de recibir respuestas del Canal B desde su próximo mensaje."
                affectedLabel="Persona afectada"
                affectedItems={revoking ? [{
                    name: channelBAccessDisplayName(revoking),
                    id: String(revoking.chatId),
                }] : []}
                confirmMessage="¿Desea revocar este acceso? Podrá aprobarlo de nuevo más adelante."
                actionLabel="Revocar"
            />
        </section>
    );
}
