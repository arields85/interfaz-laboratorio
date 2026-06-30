import type { CSSProperties } from 'react';
import type { TextTitleDisplayOptions, TextTitleWidgetConfig } from '../../domain/admin.types';

export const DEFAULT_TEXT_TITLE_FONT_SIZE = 35;

const TEXT_COLOR_MAP: Record<string, string> = {
    white: 'var(--color-industrial-text)',
    soft: 'var(--color-industrial-text-soft)',
    muted: 'var(--color-industrial-muted)',
};

interface TextTitleWidgetProps {
    widget: TextTitleWidgetConfig;
    className?: string;
}

export default function TextTitleWidget({ widget, className }: TextTitleWidgetProps) {
    const displayOptions = widget.displayOptions as TextTitleDisplayOptions | undefined;
    const fontSize = displayOptions?.fontSize ?? DEFAULT_TEXT_TITLE_FONT_SIZE;
    const textAlign = displayOptions?.textAlign ?? 'left';
    const textColor = displayOptions?.textColor ?? 'muted';
    const titleStyle: CSSProperties = {
        fontFamily: 'var(--font-dashboard-title)',
        fontWeight: 'var(--font-weight-dashboard-title)',
        letterSpacing: 'var(--tracking-dashboard-title)',
        fontSize: `${fontSize}px`,
        lineHeight: 1.1,
        color: TEXT_COLOR_MAP[textColor] ?? TEXT_COLOR_MAP.muted,
        textAlign,
    };

    const content = (
        <span className="block w-full break-words" style={titleStyle}>
            {widget.title ?? ''}
        </span>
    );

    return (
        <div className={[className, 'flex h-full w-full items-center'].filter(Boolean).join(' ')}>
            {content}
        </div>
    );
}
