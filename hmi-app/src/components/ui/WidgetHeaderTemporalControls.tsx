export interface WidgetHeaderTemporalControlOption<TValue extends string = string> {
    value: TValue;
    label: string;
    disabled?: boolean;
    ariaLabel?: string;
}

export interface WidgetHeaderTemporalControlGroup<TValue extends string = string> {
    options: ReadonlyArray<WidgetHeaderTemporalControlOption<TValue>>;
    selectedValue: TValue;
    onSelect: (value: TValue) => void;
    testId?: string;
}

export interface WidgetHeaderTemporalControlsProps {
    variant: 'pill' | 'underline';
    groups: ReadonlyArray<WidgetHeaderTemporalControlGroup>;
    testId?: string;
    indicatorTestId?: string;
    separatorTestId?: string;
    className?: string;
}

export default function WidgetHeaderTemporalControls({
    variant,
    groups,
    testId,
    indicatorTestId,
    separatorTestId,
    className = '',
}: WidgetHeaderTemporalControlsProps) {
    return (
        <div data-testid={testId} className={`flex items-center gap-2.5 ${className}`.trim()}>
            {groups.map((group, groupIndex) => (
                <div
                    key={group.testId ?? `temporal-group-${groupIndex}`}
                    data-testid={group.testId}
                    className={`flex flex-nowrap items-center justify-end gap-0 ${groupIndex > 0 ? 'border-l border-industrial-muted/25 pl-2.5' : ''}`.trim()}
                >
                    {groupIndex > 0 ? <span data-testid={separatorTestId} className="sr-only">separator</span> : null}
                    {group.options.map((option) => {
                        const isActive = option.value === group.selectedValue;
                        const isDisabled = option.disabled ?? false;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={isDisabled}
                                aria-disabled={isDisabled}
                                aria-pressed={isActive}
                                aria-label={option.ariaLabel}
                                onClick={() => {
                                    if (isDisabled) {
                                        return;
                                    }

                                    group.onSelect(option.value);
                                }}
                                className={getTemporalControlButtonClass({ variant, isActive, isDisabled })}
                            >
                                <span className="flex flex-col items-center">
                                    <span className="translate-y-[1.5px]">{option.label}</span>
                                    <span
                                        aria-hidden="true"
                                        data-testid={indicatorTestId}
                                        className={getTemporalControlIndicatorClass({ variant, isActive, isDisabled })}
                                    />
                                </span>
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

function getTemporalControlButtonClass({
    variant,
    isActive,
    isDisabled,
}: {
    variant: WidgetHeaderTemporalControlsProps['variant'];
    isActive: boolean;
    isDisabled: boolean;
}) {
    const baseClassName = 'group/control px-2 py-1 uppercase transition-colors';

    if (isDisabled) {
        return `${baseClassName} cursor-default text-industrial-muted/50`;
    }

    if (variant === 'pill') {
        return `${baseClassName} ${isActive
            ? 'rounded-md border border-admin-accent/30 bg-admin-accent/10 text-admin-accent'
            : 'text-industrial-muted hover:text-industrial-text focus-visible:text-industrial-text'}`;
    }

    return `${baseClassName} ${isActive
        ? 'text-industrial-text'
        : 'text-industrial-muted hover:text-industrial-text focus-visible:text-industrial-text'}`;
}

function getTemporalControlIndicatorClass({
    variant,
    isActive,
    isDisabled,
}: {
    variant: WidgetHeaderTemporalControlsProps['variant'];
    isActive: boolean;
    isDisabled: boolean;
}) {
    const baseClassName = 'mt-0.5 block h-[1.5px] w-1/4 min-w-[0.45rem] rounded-full transition-colors';

    if (variant === 'pill' || isDisabled) {
        return `${baseClassName} bg-transparent`;
    }

    return isActive
        ? `${baseClassName} bg-current group-hover/control:bg-current group-focus-visible/control:bg-current`
        : `${baseClassName} bg-transparent group-hover/control:bg-current group-focus-visible/control:bg-current`;
}
