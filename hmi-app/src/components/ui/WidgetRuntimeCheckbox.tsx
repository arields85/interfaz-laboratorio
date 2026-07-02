import { Check } from 'lucide-react';

export interface WidgetRuntimeCheckboxProps {
    checked: boolean;
    ariaLabel: string;
    onCheckedChange: (checked: boolean) => void;
    inputClassName?: string;
    visualTestId?: string;
    checkTestId?: string;
}

export default function WidgetRuntimeCheckbox({
    checked,
    ariaLabel,
    onCheckedChange,
    inputClassName,
    visualTestId,
    checkTestId,
}: WidgetRuntimeCheckboxProps) {
    return (
        <span className="group/runtime-checkbox relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] focus-within:ring-1 focus-within:ring-industrial-border/70 focus-within:ring-offset-0">
            <input
                type="checkbox"
                aria-label={ariaLabel}
                checked={checked}
                onChange={(event) => onCheckedChange(event.currentTarget.checked)}
                className={[
                    'absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none',
                    inputClassName,
                ].filter(Boolean).join(' ')}
            />
            <span
                aria-hidden="true"
                data-testid={visualTestId}
                className={`pointer-events-none flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors ${checked
                    ? 'border-admin-accent/30 bg-admin-accent/10 text-admin-accent group-hover/runtime-checkbox:border-admin-accent group-hover/runtime-checkbox:bg-admin-accent/20'
                    : 'border-admin-accent/30 bg-admin-accent/10 text-transparent group-hover/runtime-checkbox:border-admin-accent group-hover/runtime-checkbox:bg-admin-accent/20 group-hover/runtime-checkbox:text-transparent'}`}
            >
                {checked ? <Check data-testid={checkTestId} size={8} strokeWidth={2.5} /> : null}
            </span>
        </span>
    );
}
