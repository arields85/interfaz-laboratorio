import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface HmiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger';
    size?: 'sm' | 'md';
    fullWidth?: boolean;
    children: ReactNode;
}

// Shape (radius, corner accent, hover transitions) comes from the shared
// `theme-button` engine (see index.css); each variant below only adds its
// own color recipe on top, so Clasico keeps today's exact look and other
// themes drive radius and border/fill intensity uniformly.
const HMI_BUTTON_BASE_CLS = 'theme-button inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';

const HMI_BUTTON_SIZE_CLS = {
    sm: 'px-3 py-1',
    md: 'px-4 py-1.5',
} satisfies Record<NonNullable<HmiButtonProps['size']>, string>;

const HMI_BUTTON_VARIANT_CLS = {
    primary: 'admin-accent-ghost disabled:border-industrial-border disabled:bg-transparent disabled:text-industrial-muted disabled:hover:bg-transparent',
    secondary: 'theme-button-hmi-secondary text-industrial-muted hover:text-industrial-text disabled:border-industrial-border disabled:bg-industrial-bg/40 disabled:text-industrial-muted',
    danger: 'theme-button-critical text-status-critical disabled:border-industrial-border disabled:bg-transparent disabled:text-industrial-muted',
} satisfies Record<NonNullable<HmiButtonProps['variant']>, string>;

export type { HmiButtonProps };

export default function HmiButton({
    variant = 'secondary',
    size = 'md',
    fullWidth = false,
    className,
    type = 'button',
    children,
    ...props
}: HmiButtonProps) {
    const resolvedClassName = [
        HMI_BUTTON_BASE_CLS,
        HMI_BUTTON_SIZE_CLS[size],
        HMI_BUTTON_VARIANT_CLS[variant],
        fullWidth ? 'w-full' : null,
        className,
    ].filter(Boolean).join(' ');

    return (
        <button
            type={type}
            className={resolvedClassName}
            {...props}
        >
            {children}
        </button>
    );
}
