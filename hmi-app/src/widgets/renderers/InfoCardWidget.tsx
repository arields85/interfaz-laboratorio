import type { CSSProperties } from 'react';
import { HelpCircle, Info, type LucideIcon } from 'lucide-react';
import WidgetHeader from '../../components/ui/WidgetHeader';
import type { InfoCardWidgetConfig } from '../../domain/admin.types';
import { DEFAULT_INFO_CARD_VALUE_FONT_SIZE, resolveInfoCardFields } from '../../utils/infoCardDisplayOptions';

interface InfoCardWidgetProps {
    widget: InfoCardWidgetConfig;
    className?: string;
}

const ICON_MAP: Record<string, LucideIcon> = {
    Info,
    HelpCircle,
};

const EMPTY_VALUE = '—';

function resolveDisplayValue(value: string | undefined): string {
    const trimmed = value?.trim() ?? '';

    return trimmed === '' ? EMPTY_VALUE : trimmed;
}

export default function InfoCardWidget({ widget, className }: InfoCardWidgetProps) {
    const displayOptions = widget.displayOptions;
    const fields = resolveInfoCardFields(displayOptions);
    const valueFontSize = displayOptions?.valueFontSize ?? DEFAULT_INFO_CARD_VALUE_FONT_SIZE;
    const valueStyle: CSSProperties = {
        fontFamily: 'var(--font-dashboard-title)',
        fontWeight: 'var(--font-weight-dashboard-title)',
        letterSpacing: 'var(--tracking-dashboard-title)',
        fontSize: `${valueFontSize}px`,
        lineHeight: 1.1,
    };
    const iconSetting = displayOptions?.icon;
    const Icon = typeof iconSetting === 'string'
        ? ICON_MAP[iconSetting] ?? HelpCircle
        : iconSetting === null
          ? null
          : Info;

    return (
        <article className={[className, 'glass-panel group flex h-full w-full min-h-0 flex-col gap-3 p-4'].filter(Boolean).join(' ')}>
            <WidgetHeader
                title={widget.title?.trim() || 'Info card'}
                subtitle={displayOptions?.subtitle}
                icon={Icon ?? undefined}
                iconPosition="right"
                iconTestId="info-card-header-icon"
            />

            {displayOptions?.helpText ? (
                <p className="text-industrial-muted">
                    {displayOptions.helpText}
                </p>
            ) : null}

            <dl className="hmi-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {fields.length > 0 ? fields.map((field) => (
                    <div key={field.id}>
                        <dt className="uppercase text-industrial-muted">
                            {field.label}
                        </dt>
                        <dd className="mt-1 break-words text-industrial-text" style={valueStyle}>
                            {resolveDisplayValue(field.value)}
                        </dd>
                    </div>
                )) : (
                    <div className="py-4 text-center text-industrial-muted">
                        No static fields configured
                    </div>
                )}
            </dl>
        </article>
    );
}
