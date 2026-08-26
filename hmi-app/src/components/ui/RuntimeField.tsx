interface RuntimeFieldProps {
    defaultValue?: string;
    label: string;
    multiline?: boolean;
    type?: 'date' | 'datetime-local' | 'text';
}

const CONTROL_CLASS_NAME = 'font-system text-industrial-text rounded-lg border border-industrial-border bg-industrial-hover outline-none focus:border-admin-accent';

export default function RuntimeField({
    defaultValue = '',
    label,
    multiline = false,
    type = 'text',
}: RuntimeFieldProps) {
    return (
        <label className={`flex min-w-0 flex-col gap-1.5 font-system text-industrial-muted ${multiline ? 'col-span-2' : ''}`}>
            <span>{label}</span>
            {multiline ? (
                <textarea
                    aria-label={label}
                    defaultValue={defaultValue}
                    className={`${CONTROL_CLASS_NAME} hmi-scrollbar min-h-18 resize-y px-2.5 py-2`}
                />
            ) : (
                <input
                    aria-label={label}
                    type={type}
                    defaultValue={defaultValue}
                    className={`${CONTROL_CLASS_NAME} min-h-9 px-2.5`}
                />
            )}
        </label>
    );
}

export type { RuntimeFieldProps };
