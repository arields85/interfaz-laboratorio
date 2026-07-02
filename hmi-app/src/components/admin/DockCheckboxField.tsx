import type { ReactNode } from 'react';
import DockInlineControlRow from './DockInlineControlRow';
import WidgetRuntimeCheckbox from '../ui/WidgetRuntimeCheckbox';

interface DockCheckboxFieldProps {
    label: ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
    ariaLabel?: string;
    disabled?: boolean;
    className?: string;
    labelClassName?: string;
    inputClassName?: string;
    visualTestId?: string;
    checkTestId?: string;
}

export default function DockCheckboxField({
    label,
    checked,
    onChange,
    ariaLabel,
    disabled = false,
    className = '',
    labelClassName = 'w-14',
    inputClassName,
    visualTestId,
    checkTestId,
}: DockCheckboxFieldProps) {
    const resolvedAriaLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);

    return (
        <DockInlineControlRow
            label={label}
            className={className}
            labelClassName={labelClassName}
            controlsClassName="flex justify-end"
        >
            <WidgetRuntimeCheckbox
                ariaLabel={resolvedAriaLabel ?? 'Checkbox'}
                checked={checked}
                disabled={disabled}
                onCheckedChange={onChange}
                inputClassName={inputClassName}
                visualTestId={visualTestId}
                checkTestId={checkTestId}
            />
        </DockInlineControlRow>
    );
}
