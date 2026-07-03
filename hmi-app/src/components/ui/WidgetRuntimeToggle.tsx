export interface WidgetRuntimeToggleProps {
    checked: boolean;
    ariaLabel: string;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    title?: string;
}

const WIDGET_RUNTIME_TOGGLE_TRACK_CLASS = 'relative block h-3.5 w-6 shrink-0 rounded-full border border-admin-accent/30 bg-admin-accent/10 transition-all peer-checked:bg-admin-accent/20 peer-disabled:opacity-40 after:absolute after:left-[2px] after:top-1/2 after:h-2.5 after:w-2.5 after:-translate-y-1/2 after:rounded-full after:bg-admin-accent after:transition-all peer-checked:after:translate-x-full';

export default function WidgetRuntimeToggle({
    checked,
    ariaLabel,
    onCheckedChange,
    disabled = false,
    title,
}: WidgetRuntimeToggleProps) {
    return (
        <label className="inline-flex cursor-pointer items-center disabled:cursor-not-allowed">
            <input
                type="checkbox"
                className="peer sr-only"
                checked={checked}
                disabled={disabled}
                aria-label={ariaLabel}
                title={title}
                onChange={(event) => onCheckedChange(event.currentTarget.checked)}
            />
            <span aria-hidden="true" className={WIDGET_RUNTIME_TOGGLE_TRACK_CLASS} />
        </label>
    );
}
