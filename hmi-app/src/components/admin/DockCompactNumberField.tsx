import type { ReactNode } from 'react';
import AdminNumberInput from './AdminNumberInput';
import DockInlineControlRow from './DockInlineControlRow';
import { ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS } from './adminSidebarStyles';

interface DockCompactNumberFieldProps {
    label: ReactNode;
    value: number | string;
    onChange: (value: string) => void;
    ariaLabel?: string;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    className?: string;
    labelClassName?: string;
}

export default function DockCompactNumberField({
    label,
    value,
    onChange,
    ariaLabel,
    min,
    max,
    step = 1,
    disabled = false,
    className = '',
    labelClassName = 'w-14',
}: DockCompactNumberFieldProps) {
    return (
        <DockInlineControlRow
            label={label}
            className={className}
            labelClassName={labelClassName}
            controlsClassName="flex justify-end"
        >
            <AdminNumberInput
                value={value}
                onChange={onChange}
                ariaLabel={ariaLabel}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                commitOnBlur
                className={ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS}
            />
        </DockInlineControlRow>
    );
}
