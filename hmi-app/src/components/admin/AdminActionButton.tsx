import type { ButtonHTMLAttributes } from 'react';

type AdminActionButtonVariant = 'primary' | 'secondary' | 'critical';

interface AdminActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant: AdminActionButtonVariant;
}

// Shape (radius, corner accent, hover transitions) comes from the shared
// `theme-button` engine (see index.css); each variant below only adds its
// own color recipe on top (`admin-accent-ghost` / `theme-button-neutral` /
// `theme-button-critical`), so Clasico keeps today's exact look and other
// themes drive radius and border/fill intensity uniformly. See
// `docs/DESIGN_SYSTEM.md` / `themeStyle.service.ts` for the token model.
const ADMIN_ACTION_BUTTON_BASE_CLS = 'theme-button flex items-center gap-2 px-4 py-1.5';

const ADMIN_ACTION_BUTTON_VARIANT_CLS: Record<AdminActionButtonVariant, string> = {
    secondary: 'theme-button-neutral text-industrial-muted hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-transparent disabled:text-industrial-muted disabled:opacity-50',
    primary: 'admin-accent-ghost disabled:cursor-not-allowed disabled:border disabled:border-white/5 disabled:bg-transparent disabled:text-industrial-muted disabled:opacity-50 disabled:shadow-none disabled:hover:bg-transparent',
    critical: 'theme-button-critical uppercase text-status-critical disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-transparent disabled:text-industrial-muted disabled:opacity-50',
};

export default function AdminActionButton({
    variant,
    className,
    type = 'button',
    ...props
}: AdminActionButtonProps) {
    const resolvedClassName = [
        ADMIN_ACTION_BUTTON_BASE_CLS,
        ADMIN_ACTION_BUTTON_VARIANT_CLS[variant],
        className,
    ].filter(Boolean).join(' ');

    return (
        <button
            type={type}
            className={resolvedClassName}
            {...props}
        />
    );
}
