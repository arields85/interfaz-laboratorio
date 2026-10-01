import type { ChannelBAccessChat } from '../../../domain';
import { channelBAccessDisplayName, formatChannelBAccessDate } from './channelBAccessCopy';

interface ChannelBAccessIdentityProps {
    chat: ChannelBAccessChat;
}

// Who asked for access: name (or "Chat <id>"), @username when known, and the request date.
export default function ChannelBAccessIdentity({ chat }: ChannelBAccessIdentityProps) {
    return (
        <div className="flex min-w-0 flex-col">
            <span className="truncate text-white">{channelBAccessDisplayName(chat)}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-industrial-muted">
                {chat.username ? <span className="truncate">@{chat.username}</span> : null}
                <time dateTime={chat.requestedAt}>{formatChannelBAccessDate(chat.requestedAt)}</time>
            </span>
        </div>
    );
}
