import type { ReactNode } from 'react';
import AdminNumberInput from './AdminNumberInput';
import DockInlineControlRow from './DockInlineControlRow';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INLINE_LABEL_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
} from './adminSidebarStyles';

interface DockColorFieldProps {
    label: ReactNode;
    color: string;
    hexCode: string;
    alpha: number | string;
    onColorChange: (color: string) => void;
    onHexCodeChange: (hexCode: string) => void;
    onAlphaChange: (value: string) => void;
    onHexCodeBlur?: () => void;
    className?: string;
    inputClassName?: string;
    disabled?: boolean;
    invalid?: boolean;
    swatchAriaLabel?: string;
    hexInputAriaLabel?: string;
    alphaInputAriaLabel?: string;
    alphaMin?: number;
    alphaMax?: number;
    alphaStep?: number;
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function resolveSwatchColor(color: string): string {
    return HEX_COLOR_PATTERN.test(color) ? color : '#000000';
}

export default function DockColorField({
    label,
    color,
    hexCode,
    alpha,
    onColorChange,
    onHexCodeChange,
    onAlphaChange,
    onHexCodeBlur,
    className = '',
    inputClassName = '',
    disabled = false,
    invalid = false,
    swatchAriaLabel,
    hexInputAriaLabel,
    alphaInputAriaLabel,
    alphaMin = 0,
    alphaMax = 100,
    alphaStep = 1,
}: DockColorFieldProps) {
    return (
        <div className={`flex flex-col gap-2 ${className}`.trim()}>
            <span className={`${ADMIN_SIDEBAR_LABEL_CLS} w-auto`}>
                {label}
            </span>

            <DockInlineControlRow controlsClassName="flex min-w-0 items-center gap-2">
                <input
                    type="color"
                    value={resolveSwatchColor(color)}
                    disabled={disabled}
                    onChange={(event) => onColorChange(event.target.value.trim().toLowerCase())}
                    aria-label={swatchAriaLabel}
                    className="h-6 w-8 shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-none [&::-moz-color-swatch]:border-0"
                />

                <span className={`${ADMIN_SIDEBAR_INLINE_LABEL_CLS} ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Hex #
                </span>

                <input
                    type="text"
                    inputMode="text"
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={6}
                    disabled={disabled}
                    value={hexCode}
                    onChange={(event) => onHexCodeChange(event.target.value)}
                    onBlur={onHexCodeBlur}
                    aria-invalid={invalid}
                    aria-label={hexInputAriaLabel}
                    placeholder="RRGGBB"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} ${inputClassName} ${invalid ? 'border-status-error bg-status-error/10' : ''} ${disabled ? 'cursor-not-allowed text-white/30' : ''}`.trim()}
                />
            </DockInlineControlRow>

            <DockInlineControlRow label="Alfa (%)" labelClassName="w-auto">
                <AdminNumberInput
                    value={alpha}
                    min={alphaMin}
                    max={alphaMax}
                    step={alphaStep}
                    disabled={disabled}
                    commitOnBlur
                    ariaLabel={alphaInputAriaLabel}
                    className="w-24 max-w-full"
                    onChange={onAlphaChange}
                />
            </DockInlineControlRow>
        </div>
    );
}
