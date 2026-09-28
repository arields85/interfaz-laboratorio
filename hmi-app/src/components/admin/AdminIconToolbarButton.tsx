import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { clsx } from 'clsx';
import HoverTooltip, { type HoverTooltipProps } from '../ui/HoverTooltip';

// Shape + fill/border come from the shared `theme-button`/`theme-button-
// icon-neutral` engine (index.css): Clasico keeps today's borderless
// look (a hover-only white/5 wash), other themes gain the uniform outline.
const ADMIN_ICON_TOOLBAR_BUTTON_CLS = 'theme-button theme-button-icon-neutral inline-flex h-9 w-9 items-center justify-center text-industrial-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

interface AdminIconToolbarButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
    label: string;
    icon: LucideIcon;
    tooltipLabel?: string;
    tooltipPosition?: HoverTooltipProps['position'];
    iconProps?: LucideProps;
}

export default function AdminIconToolbarButton({
    label,
    icon: Icon,
    tooltipLabel,
    tooltipPosition = 'bottom',
    iconProps,
    className,
    type = 'button',
    ...buttonProps
}: AdminIconToolbarButtonProps) {
    return (
        <HoverTooltip label={tooltipLabel ?? label} position={tooltipPosition} className="flex">
            <span className="flex">
                <button
                    type={type}
                    aria-label={label}
                    className={clsx(ADMIN_ICON_TOOLBAR_BUTTON_CLS, className)}
                    {...buttonProps}
                >
                    <Icon size={18} {...iconProps} />
                </button>
            </span>
        </HoverTooltip>
    );
}
