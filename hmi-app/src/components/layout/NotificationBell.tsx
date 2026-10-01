import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ChannelBAccessChat, ChannelBAccessDecision } from '../../domain';
import {
    useChannelBAccess,
    type ChannelBAccessClient,
    type ChannelBAccessController,
} from '../../hooks/useChannelBAccess';
import {
    channelBAccessDecisionFeedback,
    channelBAccessErrorText,
    isChannelBAccessUnavailable,
    type ChannelBAccessFeedback,
} from '../admin/channelBAccess/channelBAccessCopy';
import NotificationPanel from './NotificationPanel';
import { TOPBAR_ICON_BUTTON_ACTIVE_CLS, TOPBAR_ICON_BUTTON_CLS } from './topbarIconButtonStyles';

interface NotificationBellProps {
    client?: ChannelBAccessClient;
    controller?: ChannelBAccessController;
}

const BADGE_MAX_COUNT = 9;
const CHANNEL_B_INACTIVE_TEXT = 'El Canal B no está activo.';

function bellLabel(count: number): string {
    if (count === 0) return 'Notificaciones';
    return `Notificaciones: ${count} ${count === 1 ? 'pendiente' : 'pendientes'}`;
}

// Admin notification entry point. Mounted only with an admin session (Topbar decides), so the
// 30 s polling and the requester names never reach a plain viewer. Container: owns the query,
// the open state and the feedback line; the list itself is presentational.
export default function NotificationBell({ client, controller }: NotificationBellProps) {
    const [open, setOpen] = useState(false);
    const [feedback, setFeedback] = useState<ChannelBAccessFeedback | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const access = useChannelBAccess({ client, controller, polling: true });

    const pending: ChannelBAccessChat[] = (access.chats ?? []).filter((chat) => chat.status === 'pending');
    const count = pending.length;

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
            setOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setOpen(false);
            buttonRef.current?.focus();
        };
        document.addEventListener('mousedown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const handleDecision = async (chat: ChannelBAccessChat, decision: ChannelBAccessDecision) => {
        try {
            setFeedback(channelBAccessDecisionFeedback(decision, await access.decide(chat.chatId, decision)));
        } catch (error) {
            setFeedback({ kind: 'error', text: channelBAccessErrorText(error) });
        }
    };

    const errorMessage = access.error
        ? (isChannelBAccessUnavailable(access.error) ? CHANNEL_B_INACTIVE_TEXT : channelBAccessErrorText(access.error))
        : null;

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                title="Notificaciones"
                aria-label={bellLabel(count)}
                aria-haspopup="dialog"
                aria-expanded={open}
                className={`${TOPBAR_ICON_BUTTON_CLS} ${open ? TOPBAR_ICON_BUTTON_ACTIVE_CLS : ''}`}
                onClick={() => setOpen((value) => !value)}
            >
                <Bell size={20} />
                {count > 0 ? (
                    <span
                        data-testid="notification-badge"
                        aria-hidden="true"
                        className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-xs font-bold leading-none text-white"
                    >
                        {count > BADGE_MAX_COUNT ? `${BADGE_MAX_COUNT}+` : count}
                    </span>
                ) : null}
            </button>
            {open ? (
                <div ref={panelRef}>
                    <NotificationPanel
                        requests={pending}
                        loading={access.isLoading}
                        errorMessage={errorMessage}
                        busy={access.pendingChatId !== null}
                        feedback={feedback}
                        onDecision={(chat, decision) => { void handleDecision(chat, decision); }}
                        onClose={() => setOpen(false)}
                    />
                </div>
            ) : null}
        </div>
    );
}
