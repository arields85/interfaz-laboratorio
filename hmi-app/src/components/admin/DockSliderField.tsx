import type { ReactNode } from 'react';
import AdminNumberInput from './AdminNumberInput';
import { ADMIN_SIDEBAR_LABEL_CLS } from './adminSidebarStyles';

export interface DockSliderFieldProps {
    label: ReactNode;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    ariaLabel?: string;
    disabled?: boolean;
    className?: string;
}

function getStepPrecision(step: number): number {
    const fractionalDigits = step.toString().split('.')[1];

    return fractionalDigits?.length ?? 0;
}

function normalizeValue(value: number, min: number, max: number, step: number): number {
    const clampedValue = Math.min(max, Math.max(min, value));
    const precision = getStepPrecision(step);
    const steppedValue = min + Math.round((clampedValue - min) / step) * step;

    return Number(steppedValue.toFixed(precision));
}

export default function DockSliderField({
    label,
    value,
    min,
    max,
    step = 1,
    onChange,
    ariaLabel,
    disabled = false,
    className = '',
}: DockSliderFieldProps) {
    const resolvedAriaLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);

    const handleNumericChange = (nextValue: string) => {
        const parsedValue = Number(nextValue);

        if (Number.isNaN(parsedValue)) {
            return;
        }

        onChange(normalizeValue(parsedValue, min, max, step));
    };

    return (
        <div className={`flex flex-col gap-2 ${className}`.trim()}>
            <div className="flex items-center justify-between gap-2">
                <span className={`${ADMIN_SIDEBAR_LABEL_CLS} w-auto min-w-0`}>
                    {label}
                </span>

                <AdminNumberInput
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                    commitOnBlur
                    ariaLabel={resolvedAriaLabel ? `${resolvedAriaLabel} value` : undefined}
                    className="w-24 max-w-full shrink-0"
                    onChange={handleNumericChange}
                />
            </div>

            <input
                aria-label={resolvedAriaLabel}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(Number(event.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/8 accent-admin-accent disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-admin-accent [&::-webkit-slider-thumb]:shadow-[0_0_6px_var(--color-admin-accent)]"
            />
        </div>
    );
}
