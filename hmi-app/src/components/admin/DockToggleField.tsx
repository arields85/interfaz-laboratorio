import type { ReactNode } from 'react';
import DockInlineControlRow from './DockInlineControlRow';

interface DockToggleFieldProps {
    label: ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
    ariaLabel?: string;
    disabled?: boolean;
    className?: string;
    labelClassName?: string;
}

const DOCK_TOGGLE_TRACK_CLS = "relative block h-3.5 w-6 shrink-0 rounded-full border border-transparent bg-white/10 transition-all peer-checked:border-white/30 peer-checked:bg-white/20 peer-disabled:opacity-40 peer-disabled:after:bg-white/60 after:absolute after:left-[2px] after:top-1/2 after:h-2.5 after:w-2.5 after:-translate-y-1/2 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full";

export default function DockToggleField({
    label,
    checked,
    onChange,
    ariaLabel,
    disabled = false,
    className = '',
    labelClassName = 'w-14',
}: DockToggleFieldProps) {
    const resolvedAriaLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);

    return (
        <DockInlineControlRow
            label={label}
            className={className}
            labelClassName={labelClassName}
            controlsClassName="flex justify-end"
        >
            <label className="inline-flex cursor-pointer items-center disabled:cursor-not-allowed">
                <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    disabled={disabled}
                    aria-label={resolvedAriaLabel}
                    onChange={(event) => onChange(event.target.checked)}
                />
                <span aria-hidden="true" className={DOCK_TOGGLE_TRACK_CLS} />
            </label>
        </DockInlineControlRow>
    );
}
