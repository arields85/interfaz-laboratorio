import type { ReactNode } from 'react';
import {
    ADMIN_SIDEBAR_INLINE_LABEL_CLS,
    ADMIN_SIDEBAR_INLINE_ROW_CLS,
} from './adminSidebarStyles';

interface DockInlineControlRowProps {
    label?: ReactNode;
    children: ReactNode;
    className?: string;
    labelClassName?: string;
    controlsClassName?: string;
}

export default function DockInlineControlRow({
    label,
    children,
    className = '',
    labelClassName = '',
    controlsClassName = '',
}: DockInlineControlRowProps) {
    return (
        <div className={`${ADMIN_SIDEBAR_INLINE_ROW_CLS} ${className}`.trim()}>
            {label ? (
                <span className={`${ADMIN_SIDEBAR_INLINE_LABEL_CLS} ${labelClassName}`.trim()}>
                    {label}
                </span>
            ) : null}
            <div className={`min-w-0 max-w-full flex-1 ${controlsClassName}`.trim()}>
                {children}
            </div>
        </div>
    );
}
