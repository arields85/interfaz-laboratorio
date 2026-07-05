import type React from 'react';

export const CONTEXT_BAR_NOTICE_WARNING_TONE_CLS = 'bg-[color:color-mix(in_srgb,var(--color-status-warning)_10%,transparent)] text-status-warning';

export interface ContextBarNoticeProps {
    /** Lucide icon component to render */
    icon: React.ComponentType<{ size?: number; className?: string }>;
    /** Text label to display */
    label: string;
    /** Optional extra className */
    className?: string;
}

export default function ContextBarNotice({ icon: Icon, label, className }: ContextBarNoticeProps) {
    return (
        <div
            className={`flex items-center gap-1.5 rounded px-2 py-1 uppercase ${CONTEXT_BAR_NOTICE_WARNING_TONE_CLS}${className ? ` ${className}` : ''}`}
        >
            <Icon size={12} />
            {label}
        </div>
    );
}
