import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { clsx } from 'clsx';
import HoverTooltip, { type HoverTooltipProps } from '../ui/HoverTooltip';

const ADMIN_ICON_TOOLBAR_BUTTON_CLS = 'inline-flex h-9 w-9 items-center justify-center rounded-md text-industrial-muted transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

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
