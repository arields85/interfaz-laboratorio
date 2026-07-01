import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
    ADMIN_SIDEBAR_DISCLOSURE_BODY_CLS,
    ADMIN_SIDEBAR_DISCLOSURE_BUTTON_CLS,
    ADMIN_SIDEBAR_HINT_CLS,
} from './adminSidebarStyles';

interface DockDetailDisclosureProps {
    summary: ReactNode;
    children: ReactNode;
    defaultOpen?: boolean;
    className?: string;
    summaryClassName?: string;
}

export default function DockDetailDisclosure({
    summary,
    children,
    defaultOpen = false,
    className = '',
    summaryClassName = '',
}: DockDetailDisclosureProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={`flex flex-col gap-2 ${className}`.trim()}>
            <button
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                className={ADMIN_SIDEBAR_DISCLOSURE_BUTTON_CLS}
                aria-expanded={open}
            >
                <span className={`min-w-0 flex-1 truncate ${ADMIN_SIDEBAR_HINT_CLS} ${summaryClassName}`.trim()}>
                    {summary}
                </span>
                <ChevronDown size={14} className={`shrink-0 text-industrial-muted transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open ? (
                <div className={ADMIN_SIDEBAR_DISCLOSURE_BODY_CLS}>
                    {children}
                </div>
            ) : null}
        </div>
    );
}
