import type { ChannelBAccessChat, ChannelBAccessDecision, ChannelBAccessStatus } from '../../../domain';
import { allowedChannelBAccessDecisions } from '../../../domain';
import AdminActionButton from '../AdminActionButton';
import ChannelBAccessIdentity from './ChannelBAccessIdentity';
import { DECISION_LABELS } from './channelBAccessCopy';

interface ChannelBAccessListProps {
    chats: readonly ChannelBAccessChat[];
    // Disables every action while one decision is being sent.
    busy: boolean;
    onDecision: (chat: ChannelBAccessChat, decision: ChannelBAccessDecision) => void;
}

const GROUPS: ReadonlyArray<{ label: string; statuses: readonly ChannelBAccessStatus[] }> = [
    { label: 'Pendientes', statuses: ['pending'] },
    { label: 'Aprobados', statuses: ['approved'] },
    { label: 'Rechazados o revocados', statuses: ['rejected', 'revoked'] },
];

const DECISION_VARIANT: Record<ChannelBAccessDecision, 'primary' | 'secondary' | 'critical'> = {
    approve: 'primary',
    reject: 'secondary',
    revoke: 'critical',
};

// Presentational: groups the requests by status and offers only the valid actions per row.
export default function ChannelBAccessList({ chats, busy, onDecision }: ChannelBAccessListProps) {
    return (
        <div className="flex flex-col gap-4">
            {GROUPS.map(({ label, statuses }) => {
                const members = chats.filter((chat) => statuses.includes(chat.status));
                if (members.length === 0) return null;
                const title = `${label} (${members.length})`;
                return (
                    <div key={label} role="group" aria-label={title} className="flex flex-col gap-2">
                        <h4 className="uppercase text-industrial-muted">{title}</h4>
                        <ul className="flex flex-col gap-2">
                            {members.map((chat) => (
                                <li
                                    key={chat.chatId}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2"
                                >
                                    <ChannelBAccessIdentity chat={chat} />
                                    <div className="flex items-center gap-2">
                                        {allowedChannelBAccessDecisions(chat.status).map((decision) => (
                                            <AdminActionButton
                                                key={decision}
                                                variant={DECISION_VARIANT[decision]}
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
                    </div>
                );
            })}
        </div>
    );
}
