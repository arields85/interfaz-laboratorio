import type {
    ChannelBAccessChat,
    ChannelBAccessDecision,
    ChannelBAccessDecisionResult,
} from '../../../domain';
import { AdminAuthError } from '../../../services/adminAuth.service';

// Every user-visible string of the Channel B access feature, in the formal "usted" register.
// Shared by the Leda settings tab and the topbar notification panel.

export type ChannelBAccessFeedback = { kind: 'success' | 'warning' | 'error'; text: string };

export const CHANNEL_B_ACCESS_UNAVAILABLE_CODE = 'CHANNEL_B_ACCESS_UNAVAILABLE';

export const DECISION_LABELS: Record<ChannelBAccessDecision, string> = {
    approve: 'Aprobar',
    reject: 'Rechazar',
    revoke: 'Revocar',
};

export const CHANNEL_B_ACCESS_UNAVAILABLE_TEXT =
    'El Canal B no está activo. Inicie el bot para gestionar las solicitudes de acceso.';

function errorCode(error: unknown): string {
    return error instanceof AdminAuthError ? error.code : '';
}

export function isChannelBAccessUnavailable(error: unknown): boolean {
    return errorCode(error) === CHANNEL_B_ACCESS_UNAVAILABLE_CODE;
}

export function channelBAccessErrorText(error: unknown): string {
    return {
        [CHANNEL_B_ACCESS_UNAVAILABLE_CODE]: CHANNEL_B_ACCESS_UNAVAILABLE_TEXT,
        CHANNEL_B_INVALID_TRANSITION: 'La solicitud cambió mientras tanto. Se actualizó la lista.',
        CHANNEL_B_CHAT_NOT_FOUND: 'La solicitud ya no existe. Se actualizó la lista.',
        TELEGRAM_STATE_UNAVAILABLE: 'No se pudo leer el estado de acceso del Canal B. Intente nuevamente.',
        AUTHENTICATION_REQUIRED: 'La sesión de administrador ya no está disponible.',
        CSRF_VALIDATION_FAILED: 'La sesión cambió. Vuelva a intentar la acción.',
    }[errorCode(error)] ?? 'No se pudo completar la operación con el servicio local.';
}

export function channelBAccessDisplayName(chat: ChannelBAccessChat): string {
    return chat.displayName.trim() || `Chat ${chat.chatId}`;
}

export function formatChannelBAccessDate(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function channelBAccessDecisionFeedback(
    decision: ChannelBAccessDecision,
    { chat, noticeSent }: ChannelBAccessDecisionResult,
): ChannelBAccessFeedback {
    const name = channelBAccessDisplayName(chat);
    if (decision === 'approve') {
        return noticeSent
            ? { kind: 'success', text: `Acceso aprobado para ${name}.` }
            : { kind: 'warning', text: `Acceso aprobado para ${name}, pero no se pudo enviar el aviso por Telegram.` };
    }
    return decision === 'reject'
        ? { kind: 'success', text: `Solicitud de ${name} rechazada.` }
        : { kind: 'success', text: `Acceso de ${name} revocado.` };
}

export const FEEDBACK_TONE_CLS: Record<ChannelBAccessFeedback['kind'], string> = {
    success: 'text-status-normal',
    warning: 'text-status-warning',
    error: 'text-status-critical',
};
