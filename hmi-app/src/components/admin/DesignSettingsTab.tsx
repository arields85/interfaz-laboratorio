import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import AdminActionButton from './AdminActionButton';
import AdminNumberInput from './AdminNumberInput';
import AdminSelect from './AdminSelect';
import AdminTag from './AdminTag';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_SECTION_BODY_CLS,
    ADMIN_SIDEBAR_SECTION_BUTTON_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';
import {
    ACTIVITY_ANALYTICS_VALUE_FONT_SIZE_RANGE,
    AVAILABLE_FONTS,
    CHART_FONT_SIZE_RANGE,
    DASHBOARD_TITLE_FONT_SIZE_RANGE,
    DEFAULT_ACTIVITY_ANALYTICS_VALUE_FONT_SIZE_PX,
    DEFAULT_CHART_FONT_SIZE_PX,
    DEFAULT_DASHBOARD_TITLE_FONT_SIZE_PX,
    DEFAULT_FONT_TRACKING_PX,
    DEFAULT_MONO_FONT_SIZE_PX,
    DEFAULT_SYSTEM_FONT_SIZE_PX,
    DEFAULT_WIDGET_GAUGE_UNIT_FONT_SIZE_PX,
    DEFAULT_WIDGET_GAUGE_VALUE_FONT_SIZE_PX,
    DEFAULT_WIDGET_UNIT_FONT_SIZE_PX,
    DEFAULT_WIDGET_VALUE_FONT_SIZE_PX,
    FONT_TRACKING_RANGE,
    getAvailableWeightOptions,
    getClosestAvailableWeight,
    isFontName,
    normalizeActivityAnalyticsValueFontSizeValue,
    normalizeChartFontSizeValue,
    normalizeDashboardTitleFontSizeValue,
    normalizeFontTrackingValue,
    normalizeStoredFontOverrides,
    normalizeSystemFontSizeValue,
    normalizeWidgetGaugeUnitFontSizeValue,
    normalizeWidgetGaugeValueFontSizeValue,
    normalizeWidgetUnitFontSizeValue,
    normalizeWidgetValueFontSizeValue,
    parseActivityAnalyticsValueFontSizeValue,
    parseChartFontSizeValue,
    parseDashboardTitleFontSizeValue,
    parseFontTrackingValue,
    parseSystemFontSizeValue,
    parseWidgetGaugeUnitFontSizeValue,
    parseWidgetGaugeValueFontSizeValue,
    parseWidgetUnitFontSizeValue,
    parseWidgetValueFontSizeValue,
    resolveFontCssVariableValue,
    SYSTEM_FONT_SIZE_RANGE,
    WIDGET_GAUGE_UNIT_FONT_SIZE_RANGE,
    WIDGET_GAUGE_VALUE_FONT_SIZE_RANGE,
    WIDGET_UNIT_FONT_SIZE_RANGE,
    type FontFamilyTokenKey,
    type FontName,
    WIDGET_VALUE_FONT_SIZE_RANGE,
} from './designSettingsTypography';

const FONT_STORAGE_KEY = 'hmi-theme-fonts';
const COLOR_STORAGE_KEY = 'hmi-theme-colors';

const FONT_SIZE_TOKEN_KEYS = [
    '--font-size-system',
    '--font-size-mono',
    '--font-size-chart',
    '--font-size-dashboard-title',
    '--font-size-widget-value',
    '--font-size-widget-unit',
    '--font-size-widget-value-gauge',
    '--font-size-widget-unit-gauge',
    '--font-size-widget-value-activity-analytics',
] as const;

const TRACKING_TOKEN_KEYS = [
    '--tracking-system',
    '--tracking-mono',
    '--tracking-chart',
    '--tracking-dashboard-title',
    '--tracking-widget-value',
    '--tracking-widget-value-gauge',
    '--tracking-widget-value-activity-analytics',
] as const;

type FontSizeTokenKey = (typeof FONT_SIZE_TOKEN_KEYS)[number];
type TrackingTokenKey = (typeof TRACKING_TOKEN_KEYS)[number];
type FontTokenKey = '--font-system' | '--font-mono' | '--font-chart' | '--font-dashboard-title' | '--font-widget-value' | '--font-widget-value-gauge' | '--font-widget-value-activity-analytics';
type InlineFontSizeTokenKey = Extract<FontSizeTokenKey, '--font-size-system' | '--font-size-mono' | '--font-size-chart' | '--font-size-dashboard-title' | '--font-size-widget-value' | '--font-size-widget-value-activity-analytics'>;
type FontToken = {
    key: FontTokenKey;
    label: string;
    weightKey: string;
    trackingKey: TrackingTokenKey;
    sizeKey?: InlineFontSizeTokenKey;
};

const FONT_TOKENS = [
    { key: '--font-system', label: 'TEXTOS EN GENERAL', weightKey: '--font-weight-system', sizeKey: '--font-size-system', trackingKey: '--tracking-system' },
    { key: '--font-mono', label: 'TEXTOS TÉCNICOS', weightKey: '--font-weight-mono', sizeKey: '--font-size-mono', trackingKey: '--tracking-mono' },
    { key: '--font-chart', label: 'TEXTOS WIDGET GRÁFICOS', weightKey: '--font-weight-chart', sizeKey: '--font-size-chart', trackingKey: '--tracking-chart' },
    { key: '--font-dashboard-title', label: 'TÍTULOS DE DASHBOARD', weightKey: '--font-weight-dashboard-title', sizeKey: '--font-size-dashboard-title', trackingKey: '--tracking-dashboard-title' },
    { key: '--font-widget-value', label: 'VALORES NUMERICOS MOSTRADOS POR:', weightKey: '--font-weight-widget-value', sizeKey: '--font-size-widget-value', trackingKey: '--tracking-widget-value' },
    { key: '--font-widget-value-gauge', label: 'VALORES NUMERICOS MOSTRADOS POR:', weightKey: '--font-weight-widget-value-gauge', trackingKey: '--tracking-widget-value-gauge' },
    { key: '--font-widget-value-activity-analytics', label: 'VALORES NUMERICOS MOSTRADOS POR:', weightKey: '--font-weight-widget-value-activity-analytics', sizeKey: '--font-size-widget-value-activity-analytics', trackingKey: '--tracking-widget-value-activity-analytics' },
] as const satisfies readonly FontToken[];

const COLOR_GROUPS = [
    {
        title: 'Base',
        colors: [
            { key: '--color-industrial-bg', label: 'Fondo Principal', defaultValue: '#05070a' },
            { key: '--color-industrial-surface', label: 'Superficie', defaultValue: '#0e1117' },
            { key: '--color-industrial-hover', label: 'Hover', defaultValue: '#161b22' },
            { key: '--color-industrial-border', label: 'Borde Industrial', defaultValue: '#ffffff14' },
            { key: '--color-industrial-text', label: 'Texto Principal', defaultValue: '#f1f5f9' },
            { key: '--color-industrial-text-soft', label: 'Texto Suave', defaultValue: '#c5c9d1' },
            { key: '--color-industrial-muted', label: 'Texto Secundario', defaultValue: '#94a3b8' },
        ],
    },
    {
        title: 'Acentos',
        colors: [
            { key: '--color-accent-cyan', label: 'Cian', defaultValue: '#22d3ee' },
            { key: '--color-accent-purple', label: 'Violeta', defaultValue: '#a855f7' },
            { key: '--color-accent-purple-light', label: 'Violeta Claro', defaultValue: '#927bec' },
            { key: '--color-accent-pink', label: 'Rosa', defaultValue: '#ec4899' },
            { key: '--color-accent-blue', label: 'Azul', defaultValue: '#3b82f6' },
            { key: '--color-accent-blue-glow', label: 'Azul Glow', defaultValue: '#60a5fa' },
            { key: '--color-accent-green', label: 'Verde', defaultValue: '#10b981' },
            { key: '--color-accent-green-glow', label: 'Verde Glow', defaultValue: '#22d3ee' },
            { key: '--color-accent-amber', label: 'Ambar', defaultValue: '#f59e0b' },
            { key: '--color-accent-ruby', label: 'Rojo Ruby', defaultValue: '#ef4444' },
        ],
    },
    {
        title: 'Admin',
        colors: [
            { key: '--color-admin-accent', label: 'Acento Admin', defaultValue: '#a48dff' },
        ],
    },
    {
        title: 'Widgets',
        colors: [
            { key: '--color-widget-gradient-from', label: 'Gradiente Desde', defaultValue: '#3b82f6' },
            { key: '--color-widget-gradient-to', label: 'Gradiente Hasta', defaultValue: '#a855f7' },
            { key: '--color-widget-icon', label: 'Icono Widget', defaultValue: '#927bec' },
        ],
    },
    {
        title: 'Umbrales Dinamicos',
        colors: [
            { key: '--color-dynamic-normal-from', label: 'Normal Desde', defaultValue: '#22d3ee' },
            { key: '--color-dynamic-normal-to', label: 'Normal Hasta', defaultValue: '#10b981' },
            { key: '--color-dynamic-warning-from', label: 'Alerta Desde', defaultValue: '#f59e0b' },
            { key: '--color-dynamic-warning-to', label: 'Alerta Hasta', defaultValue: '#ef4444' },
            { key: '--color-dynamic-critical-from', label: 'Critico Desde', defaultValue: '#ef4444' },
            { key: '--color-dynamic-critical-to', label: 'Critico Hasta', defaultValue: '#ef4444' },
        ],
    },
    {
        title: 'Estado',
        colors: [
            { key: '--color-status-normal', label: 'Estado Normal', defaultValue: '#10b981' },
            { key: '--color-status-warning', label: 'Estado Alerta', defaultValue: '#f59e0b' },
            { key: '--color-status-critical', label: 'Estado Critico', defaultValue: '#ef4444' },
        ],
    },
] as const;

type ColorTokenKey = (typeof COLOR_GROUPS)[number]['colors'][number]['key'];

const DEFAULT_FONT_VALUES: Record<FontTokenKey, FontName> = {
    '--font-system': 'JetBrainsMono',
    '--font-mono': 'IBMPlexMono',
    '--font-chart': 'IBMPlexMono',
    '--font-dashboard-title': 'Magistral',
    '--font-widget-value': 'Magistral',
    '--font-widget-value-gauge': 'Magistral',
    '--font-widget-value-activity-analytics': 'Magistral',
};

const DEFAULT_WEIGHT_VALUES: Record<string, string> = {
    '--font-weight-system': '400',
    '--font-weight-mono': '400',
    '--font-weight-chart': '400',
    '--font-weight-dashboard-title': '400',
    '--font-weight-widget-value': '400',
    '--font-weight-widget-value-gauge': '400',
    '--font-weight-widget-value-activity-analytics': '400',
};

const FONT_SIZE_FIELD_CONFIG = {
    '--font-size-system': {
        defaultValue: String(DEFAULT_SYSTEM_FONT_SIZE_PX),
        range: SYSTEM_FONT_SIZE_RANGE,
        normalize: normalizeSystemFontSizeValue,
        parse: parseSystemFontSizeValue,
    },
    '--font-size-mono': {
        defaultValue: String(DEFAULT_MONO_FONT_SIZE_PX),
        range: SYSTEM_FONT_SIZE_RANGE,
        normalize: normalizeSystemFontSizeValue,
        parse: parseSystemFontSizeValue,
    },
    '--font-size-chart': {
        defaultValue: String(DEFAULT_CHART_FONT_SIZE_PX),
        range: CHART_FONT_SIZE_RANGE,
        normalize: normalizeChartFontSizeValue,
        parse: parseChartFontSizeValue,
    },
    '--font-size-dashboard-title': {
        defaultValue: String(DEFAULT_DASHBOARD_TITLE_FONT_SIZE_PX),
        range: DASHBOARD_TITLE_FONT_SIZE_RANGE,
        normalize: normalizeDashboardTitleFontSizeValue,
        parse: parseDashboardTitleFontSizeValue,
    },
    '--font-size-widget-value': {
        defaultValue: String(DEFAULT_WIDGET_VALUE_FONT_SIZE_PX),
        range: WIDGET_VALUE_FONT_SIZE_RANGE,
        normalize: normalizeWidgetValueFontSizeValue,
        parse: parseWidgetValueFontSizeValue,
    },
    '--font-size-widget-unit': {
        defaultValue: String(DEFAULT_WIDGET_UNIT_FONT_SIZE_PX),
        range: WIDGET_UNIT_FONT_SIZE_RANGE,
        normalize: normalizeWidgetUnitFontSizeValue,
        parse: parseWidgetUnitFontSizeValue,
    },
    '--font-size-widget-value-gauge': {
        defaultValue: String(DEFAULT_WIDGET_GAUGE_VALUE_FONT_SIZE_PX),
        range: WIDGET_GAUGE_VALUE_FONT_SIZE_RANGE,
        normalize: normalizeWidgetGaugeValueFontSizeValue,
        parse: parseWidgetGaugeValueFontSizeValue,
    },
    '--font-size-widget-unit-gauge': {
        defaultValue: String(DEFAULT_WIDGET_GAUGE_UNIT_FONT_SIZE_PX),
        range: WIDGET_GAUGE_UNIT_FONT_SIZE_RANGE,
        normalize: normalizeWidgetGaugeUnitFontSizeValue,
        parse: parseWidgetGaugeUnitFontSizeValue,
    },
    '--font-size-widget-value-activity-analytics': {
        defaultValue: String(DEFAULT_ACTIVITY_ANALYTICS_VALUE_FONT_SIZE_PX),
        range: ACTIVITY_ANALYTICS_VALUE_FONT_SIZE_RANGE,
        normalize: normalizeActivityAnalyticsValueFontSizeValue,
        parse: parseActivityAnalyticsValueFontSizeValue,
    },
} as const satisfies Record<FontSizeTokenKey, {
    defaultValue: string;
    range: { min: number; max: number };
    normalize: (value: string | number) => string;
    parse: (value: string | undefined) => number;
}>;

const DEFAULT_FONT_SIZE_VALUES: Record<FontSizeTokenKey, string> = Object.fromEntries(
    Object.entries(FONT_SIZE_FIELD_CONFIG).map(([key, config]) => [key, config.defaultValue]),
) as Record<FontSizeTokenKey, string>;

const TRACKING_FIELD_CONFIG = {
    '--tracking-system': {
        defaultValue: String(DEFAULT_FONT_TRACKING_PX),
        range: FONT_TRACKING_RANGE,
        normalize: normalizeFontTrackingValue,
        parse: parseFontTrackingValue,
    },
    '--tracking-mono': {
        defaultValue: String(DEFAULT_FONT_TRACKING_PX),
        range: FONT_TRACKING_RANGE,
        normalize: normalizeFontTrackingValue,
        parse: parseFontTrackingValue,
    },
    '--tracking-chart': {
        defaultValue: String(DEFAULT_FONT_TRACKING_PX),
        range: FONT_TRACKING_RANGE,
        normalize: normalizeFontTrackingValue,
        parse: parseFontTrackingValue,
    },
    '--tracking-dashboard-title': {
        defaultValue: String(DEFAULT_FONT_TRACKING_PX),
        range: FONT_TRACKING_RANGE,
        normalize: normalizeFontTrackingValue,
        parse: parseFontTrackingValue,
    },
    '--tracking-widget-value': {
        defaultValue: String(DEFAULT_FONT_TRACKING_PX),
        range: FONT_TRACKING_RANGE,
        normalize: normalizeFontTrackingValue,
        parse: parseFontTrackingValue,
    },
    '--tracking-widget-value-gauge': {
        defaultValue: String(DEFAULT_FONT_TRACKING_PX),
        range: FONT_TRACKING_RANGE,
        normalize: normalizeFontTrackingValue,
        parse: parseFontTrackingValue,
    },
    '--tracking-widget-value-activity-analytics': {
        defaultValue: String(DEFAULT_FONT_TRACKING_PX),
        range: FONT_TRACKING_RANGE,
        normalize: normalizeFontTrackingValue,
        parse: parseFontTrackingValue,
    },
} as const satisfies Record<TrackingTokenKey, {
    defaultValue: string;
    range: { min: number; max: number; step: number };
    normalize: (value: string | number) => string;
    parse: (value: string | undefined) => number;
}>;

const DEFAULT_TRACKING_VALUES: Record<TrackingTokenKey, string> = Object.fromEntries(
    Object.entries(TRACKING_FIELD_CONFIG).map(([key, config]) => [key, config.defaultValue]),
) as Record<TrackingTokenKey, string>;

const DEFAULT_COLOR_VALUES: Record<ColorTokenKey, string> = COLOR_GROUPS.reduce((accumulator, group) => {
    for (const color of group.colors) {
        accumulator[color.key] = color.defaultValue;
    }

    return accumulator;
}, {} as Record<ColorTokenKey, string>);

const FONT_SELECT_WIDTH_CH = Math.max(...AVAILABLE_FONTS.map((fontName) => fontName.length)) + 4;
const TYPOGRAPHY_SECTION_ROW_CLS = 'flex flex-wrap min-w-0 items-center gap-x-3 gap-y-2 overflow-hidden pb-1';
const TYPOGRAPHY_CONTROL_LABEL_CLS = 'text-industrial-muted';
const TYPOGRAPHY_COMPACT_NUMBER_CLS = 'w-16 shrink-0';

function TypographySection({
    header,
    children,
    defaultOpen = true,
}: {
    header: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <section className={ADMIN_SIDEBAR_SECTION_CLS}>
            <button
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                className={ADMIN_SIDEBAR_SECTION_BUTTON_CLS}
            >
                <span className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>{header}</span>
                <ChevronDown
                    size={14}
                    className={`text-industrial-muted transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <div className={ADMIN_SIDEBAR_SECTION_BODY_CLS}>
                    {children}
                </div>
            )}
        </section>
    );
}

function getWeightSelectWidthCh(weightOptions: { label: string }[]): number {
    return Math.max(...weightOptions.map((weightOption) => weightOption.label.length), 10) + 4;
}

function isRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).every((entry) => typeof entry === 'string');
}

function readStoredOverrides(storageKey: string): Record<string, string> {
    try {
        const storedValue = localStorage.getItem(storageKey);
        if (!storedValue) {
            return {};
        }

        const parsedValue: unknown = JSON.parse(storedValue);
        return isRecord(parsedValue) ? parsedValue : {};
    } catch {
        return {};
    }
}

function writeStoredOverrides(storageKey: string, overrides: Record<string, string>): void {
    if (Object.keys(overrides).length === 0) {
        localStorage.removeItem(storageKey);
        return;
    }

    localStorage.setItem(storageKey, JSON.stringify(overrides));
}

function isFontSizeTokenKey(value: string): value is FontSizeTokenKey {
    return value in FONT_SIZE_FIELD_CONFIG;
}

function isTrackingTokenKey(value: string): value is TrackingTokenKey {
    return value in TRACKING_FIELD_CONFIG;
}

function normalizeColorForInput(colorValue: string): string {
    const trimmedValue = colorValue.trim();

    if (/^#[0-9a-f]{6}$/i.test(trimmedValue)) {
        return trimmedValue.toLowerCase();
    }

    if (/^#[0-9a-f]{8}$/i.test(trimmedValue)) {
        return trimmedValue.slice(0, 7).toLowerCase();
    }

    const rgbMatch = trimmedValue.match(/rgba?\(([^)]+)\)/i);
    if (!rgbMatch) {
        return '#000000';
    }

    const [red = '0', green = '0', blue = '0'] = rgbMatch[1].split(',').map((part) => part.trim());
    const toHex = (value: string) => Math.max(0, Math.min(255, Number.parseInt(value, 10))).toString(16).padStart(2, '0');

    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function buildFontStorageOverrides(
    fontValues: Record<FontTokenKey, FontName>,
    weightValues: Record<string, string>,
    fontSizeValues: Record<FontSizeTokenKey, string>,
    trackingValues: Record<TrackingTokenKey, string>,
): Record<string, string> {
    const overrides = FONT_TOKENS.reduce((accumulator, fontToken) => {
        const selectedFont = fontValues[fontToken.key];
        if (selectedFont !== DEFAULT_FONT_VALUES[fontToken.key]) {
            accumulator[fontToken.key] = selectedFont;
        }

        if (fontToken.weightKey) {
            const selectedWeight = weightValues[fontToken.weightKey] ?? DEFAULT_WEIGHT_VALUES[fontToken.weightKey];
            if (selectedWeight !== DEFAULT_WEIGHT_VALUES[fontToken.weightKey]) {
                accumulator[fontToken.weightKey] = selectedWeight;
            }
        }

        return accumulator;
    }, {} as Record<string, string>);

    for (const sizeKey of FONT_SIZE_TOKEN_KEYS) {
        const config = FONT_SIZE_FIELD_CONFIG[sizeKey];
        const normalizedSize = config.normalize(fontSizeValues[sizeKey] || config.defaultValue);
        if (normalizedSize !== config.normalize(config.defaultValue)) {
            overrides[sizeKey] = normalizedSize;
        }
    }

    for (const trackingKey of TRACKING_TOKEN_KEYS) {
        const config = TRACKING_FIELD_CONFIG[trackingKey];
        const normalizedTracking = config.normalize(trackingValues[trackingKey] || config.defaultValue);
        if (normalizedTracking !== config.normalize(config.defaultValue)) {
            overrides[trackingKey] = normalizedTracking;
        }
    }

    return overrides;
}

// eslint-disable-next-line react-refresh/only-export-components -- App bootstrap imports this initializer.
export function applyThemeOverrides(): void {
    try {
        const fonts = localStorage.getItem('hmi-theme-fonts');
        if (fonts) {
            const parsed = normalizeStoredFontOverrides(JSON.parse(fonts) as Record<string, string>);
            const resolvedFontValues = { ...DEFAULT_FONT_VALUES };
            for (const fontToken of FONT_TOKENS) {
                const storedFontName = parsed[fontToken.key];
                if (storedFontName && isFontName(storedFontName)) {
                    resolvedFontValues[fontToken.key] = storedFontName;
                }
            }

            const resolvedWeightValues = { ...DEFAULT_WEIGHT_VALUES };
            for (const fontToken of FONT_TOKENS) {
                if (!fontToken.weightKey) {
                    continue;
                }

                const requestedWeight = parsed[fontToken.weightKey] ?? DEFAULT_WEIGHT_VALUES[fontToken.weightKey];
                resolvedWeightValues[fontToken.weightKey] = getClosestAvailableWeight(
                    requestedWeight,
                    getAvailableWeightOptions(resolvedFontValues[fontToken.key]),
                );
            }

            const resolvedFontSizeValues = { ...DEFAULT_FONT_SIZE_VALUES };
            for (const sizeKey of FONT_SIZE_TOKEN_KEYS) {
                const config = FONT_SIZE_FIELD_CONFIG[sizeKey];
                resolvedFontSizeValues[sizeKey] = String(config.parse(parsed[sizeKey]));
            }

            const resolvedTrackingValues = { ...DEFAULT_TRACKING_VALUES };
            for (const trackingKey of TRACKING_TOKEN_KEYS) {
                const config = TRACKING_FIELD_CONFIG[trackingKey];
                resolvedTrackingValues[trackingKey] = String(config.parse(parsed[trackingKey]));
            }

            const normalizedOverrides = buildFontStorageOverrides(
                resolvedFontValues,
                resolvedWeightValues,
                resolvedFontSizeValues,
                resolvedTrackingValues,
            );
            writeStoredOverrides(FONT_STORAGE_KEY, normalizedOverrides);

            for (const [key, value] of Object.entries(normalizedOverrides)) {
                if ((FONT_TOKENS as readonly { key: FontTokenKey }[]).some((fontToken) => fontToken.key === key)) {
                    document.documentElement.style.setProperty(key, resolveFontCssVariableValue(key as FontFamilyTokenKey, value));
                    continue;
                }

                if (isFontSizeTokenKey(key)) {
                    document.documentElement.style.setProperty(key, FONT_SIZE_FIELD_CONFIG[key].normalize(value));
                    continue;
                }

                if (isTrackingTokenKey(key)) {
                    document.documentElement.style.setProperty(key, TRACKING_FIELD_CONFIG[key].normalize(value));
                    continue;
                }

                document.documentElement.style.setProperty(key, value);
            }
        }
        const colors = localStorage.getItem('hmi-theme-colors');
        if (colors) {
            const parsed = JSON.parse(colors) as Record<string, string>;
            for (const [key, value] of Object.entries(parsed)) {
                document.documentElement.style.setProperty(key, value);
            }
        }
    } catch { /* ignore corrupt data */ }
}

interface DesignSettingsTabProps {
    onDirtyChange?: (dirty: boolean) => void;
    saveRef?: { current: (() => void) | null };
    revertRef?: { current: (() => void) | null };
}

export default function DesignSettingsTab({ onDirtyChange, saveRef, revertRef }: DesignSettingsTabProps) {
    const initialThemeState = useMemo(() => {
        const storedFonts = normalizeStoredFontOverrides(readStoredOverrides(FONT_STORAGE_KEY));
        const storedColors = readStoredOverrides(COLOR_STORAGE_KEY);

        const nextFontValues = { ...DEFAULT_FONT_VALUES };
        for (const fontToken of FONT_TOKENS) {
            const storedFontName = storedFonts[fontToken.key];
            if (storedFontName && isFontName(storedFontName)) {
                nextFontValues[fontToken.key] = storedFontName;
            }
        }

        const nextWeightValues = { ...DEFAULT_WEIGHT_VALUES };
        for (const fontToken of FONT_TOKENS) {
            if (!fontToken.weightKey) {
                continue;
            }

            const selectedFont = nextFontValues[fontToken.key];
            const requestedWeight = storedFonts[fontToken.weightKey] ?? DEFAULT_WEIGHT_VALUES[fontToken.weightKey];
            nextWeightValues[fontToken.weightKey] = getClosestAvailableWeight(requestedWeight, getAvailableWeightOptions(selectedFont));
        }

        const nextFontSizeValues = { ...DEFAULT_FONT_SIZE_VALUES };
        for (const sizeKey of FONT_SIZE_TOKEN_KEYS) {
            const config = FONT_SIZE_FIELD_CONFIG[sizeKey];
            nextFontSizeValues[sizeKey] = String(config.parse(storedFonts[sizeKey]));
        }

        const nextTrackingValues = { ...DEFAULT_TRACKING_VALUES };
        for (const trackingKey of TRACKING_TOKEN_KEYS) {
            const config = TRACKING_FIELD_CONFIG[trackingKey];
            nextTrackingValues[trackingKey] = String(config.parse(storedFonts[trackingKey]));
        }

        const nextColorValues = {
            ...DEFAULT_COLOR_VALUES,
            ...(storedColors as Partial<Record<ColorTokenKey, string>>),
        };

        return {
            fontValues: nextFontValues,
            weightValues: nextWeightValues,
            fontSizeValues: nextFontSizeValues,
            trackingValues: nextTrackingValues,
            colorValues: nextColorValues,
        };
    }, []);
    const [fontValues, setFontValues] = useState<Record<FontTokenKey, FontName>>(initialThemeState.fontValues);
    const [weightValues, setWeightValues] = useState<Record<string, string>>(initialThemeState.weightValues);
    const [fontSizeValues, setFontSizeValues] = useState<Record<FontSizeTokenKey, string>>(initialThemeState.fontSizeValues);
    const [trackingValues, setTrackingValues] = useState<Record<TrackingTokenKey, string>>(initialThemeState.trackingValues);
    const [colorValues, setColorValues] = useState<Record<ColorTokenKey, string>>(initialThemeState.colorValues);

    const snapshotRef = useRef<{
        fontValues: Record<FontTokenKey, FontName>;
        weightValues: Record<string, string>;
        fontSizeValues: Record<FontSizeTokenKey, string>;
        trackingValues: Record<TrackingTokenKey, string>;
        colorValues: Record<ColorTokenKey, string>;
    } | null>({
        ...initialThemeState,
    });

    useEffect(() => {
        applyThemeOverrides();
        writeStoredOverrides(FONT_STORAGE_KEY, buildFontStorageOverrides(
            initialThemeState.fontValues,
            initialThemeState.weightValues,
            initialThemeState.fontSizeValues,
            initialThemeState.trackingValues,
        ));
    }, [initialThemeState]);

    const fontStorageOverrides = useMemo(() => {
        return buildFontStorageOverrides(fontValues, weightValues, fontSizeValues, trackingValues);
    }, [fontSizeValues, fontValues, trackingValues, weightValues]);

    const colorStorageOverrides = useMemo(() => {
        return Object.entries(colorValues).reduce((accumulator, [key, value]) => {
            const colorKey = key as ColorTokenKey;
            if (normalizeColorForInput(value) !== normalizeColorForInput(DEFAULT_COLOR_VALUES[colorKey])) {
                accumulator[colorKey] = value;
            }

            return accumulator;
        }, {} as Record<string, string>);
    }, [colorValues]);

    const fontOptions = useMemo(() => {
        return AVAILABLE_FONTS.map((fontName) => ({
            value: fontName,
            label: fontName,
        }));
    }, []);

    const gaugeWeightOptions = useMemo(() => {
        return getAvailableWeightOptions(fontValues['--font-widget-value-gauge']).map((weightOption) => ({
            value: weightOption.value,
            label: `${weightOption.name} (${weightOption.value})`,
        }));
    }, [fontValues]);

    const gaugeWeightSelectWidthCh = useMemo(() => {
        return getWeightSelectWidthCh(gaugeWeightOptions);
    }, [gaugeWeightOptions]);

    const activityAnalyticsWeightOptions = useMemo(() => {
        return getAvailableWeightOptions(fontValues['--font-widget-value-activity-analytics']).map((weightOption) => ({
            value: weightOption.value,
            label: `${weightOption.name} (${weightOption.value})`,
        }));
    }, [fontValues]);

    const activityAnalyticsWeightSelectWidthCh = useMemo(() => {
        return getWeightSelectWidthCh(activityAnalyticsWeightOptions);
    }, [activityAnalyticsWeightOptions]);

    const handleFontChange = (fontKey: FontTokenKey, nextFont: FontName) => {
        const nextValues = {
            ...fontValues,
            [fontKey]: nextFont,
        } satisfies Record<FontTokenKey, FontName>;

        const fontToken = FONT_TOKENS.find((token) => token.key === fontKey);
        const nextWeights = { ...weightValues };

        if (fontToken?.weightKey) {
            const currentWeight = weightValues[fontToken.weightKey] ?? DEFAULT_WEIGHT_VALUES[fontToken.weightKey];
            nextWeights[fontToken.weightKey] = getClosestAvailableWeight(currentWeight, getAvailableWeightOptions(nextFont));
        }

        setFontValues(nextValues);
        setWeightValues(nextWeights);

        if (nextFont === DEFAULT_FONT_VALUES[fontKey]) {
            document.documentElement.style.removeProperty(fontKey);
        } else {
            document.documentElement.style.setProperty(fontKey, resolveFontCssVariableValue(fontKey as FontFamilyTokenKey, nextFont));
        }

        if (fontToken?.weightKey) {
            const nextWeight = nextWeights[fontToken.weightKey];
            if (nextWeight === DEFAULT_WEIGHT_VALUES[fontToken.weightKey]) {
                document.documentElement.style.removeProperty(fontToken.weightKey);
            } else {
                document.documentElement.style.setProperty(fontToken.weightKey, nextWeight);
            }
        }

        onDirtyChange?.(true);
    };

    const handleColorChange = (colorKey: ColorTokenKey, nextColor: string) => {
        const defaultPickerValue = normalizeColorForInput(DEFAULT_COLOR_VALUES[colorKey]);
        const shouldRemoveOverride = normalizeColorForInput(nextColor) === defaultPickerValue;
        const resolvedColor = shouldRemoveOverride ? DEFAULT_COLOR_VALUES[colorKey] : nextColor;
        const nextValues = {
            ...colorValues,
            [colorKey]: resolvedColor,
        } satisfies Record<ColorTokenKey, string>;

        setColorValues(nextValues);

        if (shouldRemoveOverride) {
            document.documentElement.style.removeProperty(colorKey);
        } else {
            document.documentElement.style.setProperty(colorKey, nextColor);
        }

        onDirtyChange?.(true);
    };

    const handleWeightChange = (weightKey: string, nextWeight: string) => {
        const relatedFontToken = FONT_TOKENS.find((fontToken) => fontToken.weightKey === weightKey);
        const selectedFont = relatedFontToken ? fontValues[relatedFontToken.key] : DEFAULT_FONT_VALUES['--font-system'];
        const resolvedWeight = getClosestAvailableWeight(nextWeight, getAvailableWeightOptions(selectedFont));
        const nextWeightValues = { ...weightValues, [weightKey]: resolvedWeight };

        setWeightValues(nextWeightValues);

        if (resolvedWeight === DEFAULT_WEIGHT_VALUES[weightKey]) {
            document.documentElement.style.removeProperty(weightKey);
        } else {
            document.documentElement.style.setProperty(weightKey, resolvedWeight);
        }

        onDirtyChange?.(true);
    };

    const handleFontSizeChange = (sizeKey: FontSizeTokenKey, nextValue: string) => {
        const trimmedValue = nextValue.trim();
        if (!trimmedValue) {
            setFontSizeValues((currentValues) => ({
                ...currentValues,
                [sizeKey]: '',
            }));
            return;
        }

        const config = FONT_SIZE_FIELD_CONFIG[sizeKey];
        const normalizedSize = config.normalize(trimmedValue);
        const nextSizeValues = {
            ...fontSizeValues,
            [sizeKey]: normalizedSize.replace('px', ''),
        } satisfies Record<FontSizeTokenKey, string>;

        setFontSizeValues(nextSizeValues);
        document.documentElement.style.setProperty(sizeKey, normalizedSize);
        onDirtyChange?.(true);
    };

    const handleFontSizeBlur = (sizeKey: FontSizeTokenKey) => {
        const config = FONT_SIZE_FIELD_CONFIG[sizeKey];
        const normalizedSize = config.normalize(fontSizeValues[sizeKey] || config.defaultValue);
        const nextSizeValues = {
            ...fontSizeValues,
            [sizeKey]: normalizedSize.replace('px', ''),
        } satisfies Record<FontSizeTokenKey, string>;

        setFontSizeValues(nextSizeValues);

        if (normalizedSize === config.normalize(config.defaultValue)) {
            document.documentElement.style.removeProperty(sizeKey);
        } else {
            document.documentElement.style.setProperty(sizeKey, normalizedSize);
        }
    };

    const handleTrackingChange = (trackingKey: TrackingTokenKey, nextValue: string) => {
        const trimmedValue = nextValue.trim();
        if (!trimmedValue) {
            setTrackingValues((currentValues) => ({
                ...currentValues,
                [trackingKey]: '',
            }));
            return;
        }

        const config = TRACKING_FIELD_CONFIG[trackingKey];
        const normalizedTracking = config.normalize(trimmedValue);
        const nextTrackingValues = {
            ...trackingValues,
            [trackingKey]: normalizedTracking.replace('px', ''),
        } satisfies Record<TrackingTokenKey, string>;

        setTrackingValues(nextTrackingValues);
        document.documentElement.style.setProperty(trackingKey, normalizedTracking);
        onDirtyChange?.(true);
    };

    const handleTrackingBlur = (trackingKey: TrackingTokenKey) => {
        const config = TRACKING_FIELD_CONFIG[trackingKey];
        const normalizedTracking = config.normalize(trackingValues[trackingKey] || config.defaultValue);
        const nextTrackingValues = {
            ...trackingValues,
            [trackingKey]: normalizedTracking.replace('px', ''),
        } satisfies Record<TrackingTokenKey, string>;

        setTrackingValues(nextTrackingValues);

        if (normalizedTracking === config.normalize(config.defaultValue)) {
            document.documentElement.style.removeProperty(trackingKey);
        } else {
            document.documentElement.style.setProperty(trackingKey, normalizedTracking);
        }
    };

    const handleResetFonts = () => {
        localStorage.removeItem(FONT_STORAGE_KEY);
        for (const fontToken of FONT_TOKENS) {
            document.documentElement.style.removeProperty(fontToken.key);
            if (fontToken.weightKey) {
                document.documentElement.style.removeProperty(fontToken.weightKey);
            }
        }
        for (const sizeKey of FONT_SIZE_TOKEN_KEYS) {
            document.documentElement.style.removeProperty(sizeKey);
        }
        for (const trackingKey of TRACKING_TOKEN_KEYS) {
            document.documentElement.style.removeProperty(trackingKey);
        }
        setFontValues(DEFAULT_FONT_VALUES);
        setWeightValues(DEFAULT_WEIGHT_VALUES);
        setFontSizeValues(DEFAULT_FONT_SIZE_VALUES);
        setTrackingValues(DEFAULT_TRACKING_VALUES);

        const prevColorSnapshot = snapshotRef.current?.colorValues ?? DEFAULT_COLOR_VALUES;
        snapshotRef.current = {
            fontValues: DEFAULT_FONT_VALUES,
            weightValues: DEFAULT_WEIGHT_VALUES,
            fontSizeValues: DEFAULT_FONT_SIZE_VALUES,
            trackingValues: DEFAULT_TRACKING_VALUES,
            colorValues: prevColorSnapshot,
        };
        const colorsDirty = Object.entries(colorValues).some(([k, v]) => {
            const snapV = prevColorSnapshot[k as ColorTokenKey];
            return normalizeColorForInput(v) !== normalizeColorForInput(snapV);
        });
        onDirtyChange?.(colorsDirty);
    };

    const handleReset = () => {
        localStorage.removeItem(FONT_STORAGE_KEY);
        localStorage.removeItem(COLOR_STORAGE_KEY);

        for (const fontToken of FONT_TOKENS) {
            document.documentElement.style.removeProperty(fontToken.key);
            if (fontToken.weightKey) {
                document.documentElement.style.removeProperty(fontToken.weightKey);
            }
        }
        for (const sizeKey of FONT_SIZE_TOKEN_KEYS) {
            document.documentElement.style.removeProperty(sizeKey);
        }
        for (const trackingKey of TRACKING_TOKEN_KEYS) {
            document.documentElement.style.removeProperty(trackingKey);
        }

        for (const group of COLOR_GROUPS) {
            for (const color of group.colors) {
                document.documentElement.style.removeProperty(color.key);
            }
        }

        setFontValues(DEFAULT_FONT_VALUES);
        setWeightValues(DEFAULT_WEIGHT_VALUES);
        setFontSizeValues(DEFAULT_FONT_SIZE_VALUES);
        setTrackingValues(DEFAULT_TRACKING_VALUES);
        setColorValues(DEFAULT_COLOR_VALUES);

        snapshotRef.current = {
            fontValues: DEFAULT_FONT_VALUES,
            weightValues: DEFAULT_WEIGHT_VALUES,
            fontSizeValues: DEFAULT_FONT_SIZE_VALUES,
            trackingValues: DEFAULT_TRACKING_VALUES,
            colorValues: DEFAULT_COLOR_VALUES,
        };
        onDirtyChange?.(false);
    };

    useEffect(() => {
        if (!saveRef) {
            return;
        }

        saveRef.current = () => {
            writeStoredOverrides(FONT_STORAGE_KEY, buildFontStorageOverrides(fontValues, weightValues, fontSizeValues, trackingValues));
            writeStoredOverrides(COLOR_STORAGE_KEY, colorStorageOverrides);
            snapshotRef.current = { fontValues, weightValues, fontSizeValues, trackingValues, colorValues };
            onDirtyChange?.(false);
        };

        return () => {
            saveRef.current = null;
        };
    }, [colorStorageOverrides, colorValues, fontSizeValues, fontValues, onDirtyChange, saveRef, trackingValues, weightValues]);

    useEffect(() => {
        if (!revertRef) {
            return;
        }

        revertRef.current = () => {
            if (!snapshotRef.current) return;
            const snap = snapshotRef.current;
            setFontValues(snap.fontValues);
            setWeightValues(snap.weightValues);
            setFontSizeValues(snap.fontSizeValues);
            setTrackingValues(snap.trackingValues);
            setColorValues(snap.colorValues);
            applyThemeOverrides();
            onDirtyChange?.(false);
        };

        return () => {
            revertRef.current = null;
        };
    }, [onDirtyChange, revertRef]);

    return (
        <div className="max-h-[55vh] overflow-y-auto hmi-scrollbar pr-1">
            <section>
                <div className="space-y-3">
                    {FONT_TOKENS.filter((fontToken) => fontToken.key !== '--font-widget-value-gauge' && fontToken.key !== '--font-widget-value-activity-analytics').map((fontToken) => {
                        const selectedFont = fontValues[fontToken.key];
                        const availableWeights = fontToken.weightKey
                            ? getAvailableWeightOptions(selectedFont)
                            : [];
                        const weightOptions = availableWeights.map((weightOption) => ({
                            value: weightOption.value,
                            label: `${weightOption.name} (${weightOption.value})`,
                        }));
                        const weightSelectWidthCh = getWeightSelectWidthCh(weightOptions);

                        return (
                            <TypographySection
                                key={fontToken.key}
                                header={fontToken.key === '--font-widget-value' ? (
                                    <>
                                        <span>{fontToken.label}</span>
                                        <AdminTag label="METRIC-CARD" variant="admin" />
                                    </>
                                ) : (
                                    fontToken.label
                                )}
                            >
                                <div className={TYPOGRAPHY_SECTION_ROW_CLS}>
                                    <AdminSelect
                                        value={selectedFont}
                                        options={fontOptions}
                                        onChange={(value) => handleFontChange(fontToken.key, value as FontName)}
                                        className="min-w-fit"
                                        style={{ width: `${FONT_SELECT_WIDTH_CH}ch` }}
                                        placeholder="Seleccionar fuente"
                                    />
                                    {fontToken.sizeKey && (
                                        <div className="flex items-center gap-2">
                                            <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tamaño</span>
                                            <AdminNumberInput
                                                value={fontSizeValues[fontToken.sizeKey] ?? FONT_SIZE_FIELD_CONFIG[fontToken.sizeKey].defaultValue}
                                                onChange={(value) => handleFontSizeChange(fontToken.sizeKey!, value)}
                                                onBlur={() => handleFontSizeBlur(fontToken.sizeKey!)}
                                                min={FONT_SIZE_FIELD_CONFIG[fontToken.sizeKey].range.min}
                                                max={FONT_SIZE_FIELD_CONFIG[fontToken.sizeKey].range.max}
                                                className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                                aria-label={`${fontToken.label} tamaño base`}
                                            />
                                        </div>
                                    )}
                                    {fontToken.trackingKey && (
                                        <div className="flex items-center gap-2">
                                            <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tracking</span>
                                            <AdminNumberInput
                                                value={trackingValues[fontToken.trackingKey] ?? TRACKING_FIELD_CONFIG[fontToken.trackingKey].defaultValue}
                                                onChange={(value) => handleTrackingChange(fontToken.trackingKey!, value)}
                                                onBlur={() => handleTrackingBlur(fontToken.trackingKey!)}
                                                min={TRACKING_FIELD_CONFIG[fontToken.trackingKey].range.min}
                                                max={TRACKING_FIELD_CONFIG[fontToken.trackingKey].range.max}
                                                step={TRACKING_FIELD_CONFIG[fontToken.trackingKey].range.step}
                                                className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                                aria-label={`${fontToken.label} tracking`}
                                            />
                                        </div>
                                    )}
                                    {fontToken.weightKey && (
                                        <div className="flex items-center gap-2">
                                            <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Peso</span>
                                            <AdminSelect
                                                value={weightValues[fontToken.weightKey] ?? DEFAULT_WEIGHT_VALUES[fontToken.weightKey]}
                                                onChange={(value) => handleWeightChange(fontToken.weightKey!, value)}
                                                options={weightOptions}
                                                className="shrink-0"
                                                style={{ width: `${weightSelectWidthCh}ch` }}
                                                placeholder="Seleccionar peso"
                                            />
                                        </div>
                                    )}
                                </div>

                                {fontToken.key === '--font-widget-value' && (
                                    <div className={TYPOGRAPHY_SECTION_ROW_CLS}>
                                        <div className="flex items-center gap-2">
                                            <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tamaño de las unidades</span>
                                            <AdminNumberInput
                                                value={fontSizeValues['--font-size-widget-unit'] ?? FONT_SIZE_FIELD_CONFIG['--font-size-widget-unit'].defaultValue}
                                                onChange={(value) => handleFontSizeChange('--font-size-widget-unit', value)}
                                                onBlur={() => handleFontSizeBlur('--font-size-widget-unit')}
                                                min={FONT_SIZE_FIELD_CONFIG['--font-size-widget-unit'].range.min}
                                                max={FONT_SIZE_FIELD_CONFIG['--font-size-widget-unit'].range.max}
                                                className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                                aria-label="METRIC-CARD tamaño de las unidades"
                                            />
                                        </div>
                                    </div>
                                )}
                            </TypographySection>
                        );
                    })}

                    <TypographySection
                        header={(
                            <>
                                <span>VALORES NUMERICOS MOSTRADOS POR:</span>
                                <AdminTag label="KPI" variant="admin" />
                                <AdminTag label="MACHINE-ACTIVITY" variant="admin" />
                            </>
                        )}
                    >
                        <div className={TYPOGRAPHY_SECTION_ROW_CLS}>
                            <AdminSelect
                                value={fontValues['--font-widget-value-gauge']}
                                options={fontOptions}
                                onChange={(value) => handleFontChange('--font-widget-value-gauge', value as FontName)}
                                className="min-w-fit"
                                style={{ width: `${FONT_SELECT_WIDTH_CH}ch` }}
                                placeholder="Seleccionar fuente"
                            />
                            <div className="flex items-center gap-2">
                                <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tamaño</span>
                                <AdminNumberInput
                                    value={fontSizeValues['--font-size-widget-value-gauge'] ?? FONT_SIZE_FIELD_CONFIG['--font-size-widget-value-gauge'].defaultValue}
                                    onChange={(value) => handleFontSizeChange('--font-size-widget-value-gauge', value)}
                                    onBlur={() => handleFontSizeBlur('--font-size-widget-value-gauge')}
                                    min={FONT_SIZE_FIELD_CONFIG['--font-size-widget-value-gauge'].range.min}
                                    max={FONT_SIZE_FIELD_CONFIG['--font-size-widget-value-gauge'].range.max}
                                    className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                    aria-label="VALORES EN KPI / MACHINE-ACTIVITY tamaño base"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tracking</span>
                                <AdminNumberInput
                                    value={trackingValues['--tracking-widget-value-gauge'] ?? TRACKING_FIELD_CONFIG['--tracking-widget-value-gauge'].defaultValue}
                                    onChange={(value) => handleTrackingChange('--tracking-widget-value-gauge', value)}
                                    onBlur={() => handleTrackingBlur('--tracking-widget-value-gauge')}
                                    min={TRACKING_FIELD_CONFIG['--tracking-widget-value-gauge'].range.min}
                                    max={TRACKING_FIELD_CONFIG['--tracking-widget-value-gauge'].range.max}
                                    step={TRACKING_FIELD_CONFIG['--tracking-widget-value-gauge'].range.step}
                                    className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                    aria-label="VALORES EN KPI / MACHINE-ACTIVITY tracking"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Peso</span>
                                <AdminSelect
                                    value={weightValues['--font-weight-widget-value-gauge'] ?? DEFAULT_WEIGHT_VALUES['--font-weight-widget-value-gauge']}
                                    onChange={(value) => handleWeightChange('--font-weight-widget-value-gauge', value)}
                                    options={gaugeWeightOptions}
                                    className="shrink-0"
                                    style={{ width: `${gaugeWeightSelectWidthCh}ch` }}
                                    placeholder="Seleccionar peso"
                                />
                            </div>
                        </div>
                        <div className={TYPOGRAPHY_SECTION_ROW_CLS}>
                            <div className="flex items-center gap-2">
                                <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tamaño de las unidades</span>
                                <AdminNumberInput
                                    value={fontSizeValues['--font-size-widget-unit-gauge'] ?? FONT_SIZE_FIELD_CONFIG['--font-size-widget-unit-gauge'].defaultValue}
                                    onChange={(value) => handleFontSizeChange('--font-size-widget-unit-gauge', value)}
                                    onBlur={() => handleFontSizeBlur('--font-size-widget-unit-gauge')}
                                    min={FONT_SIZE_FIELD_CONFIG['--font-size-widget-unit-gauge'].range.min}
                                    max={FONT_SIZE_FIELD_CONFIG['--font-size-widget-unit-gauge'].range.max}
                                    className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                    aria-label="VALORES EN KPI / MACHINE-ACTIVITY tamaño de las unidades"
                                />
                            </div>
                        </div>
                    </TypographySection>

                    <TypographySection
                        header={(
                            <>
                                <span>VALORES NUMERICOS MOSTRADOS POR:</span>
                                <AdminTag label="ACTIVITY-ANALYTICS" variant="admin" />
                            </>
                        )}
                    >
                        <div className={TYPOGRAPHY_SECTION_ROW_CLS}>
                            <AdminSelect
                                value={fontValues['--font-widget-value-activity-analytics']}
                                options={fontOptions}
                                onChange={(value) => handleFontChange('--font-widget-value-activity-analytics', value as FontName)}
                                className="min-w-fit"
                                style={{ width: `${FONT_SELECT_WIDTH_CH}ch` }}
                                placeholder="Seleccionar fuente"
                            />
                            <div className="flex items-center gap-2">
                                <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tamaño</span>
                                <AdminNumberInput
                                    value={fontSizeValues['--font-size-widget-value-activity-analytics'] ?? FONT_SIZE_FIELD_CONFIG['--font-size-widget-value-activity-analytics'].defaultValue}
                                    onChange={(value) => handleFontSizeChange('--font-size-widget-value-activity-analytics', value)}
                                    onBlur={() => handleFontSizeBlur('--font-size-widget-value-activity-analytics')}
                                    min={FONT_SIZE_FIELD_CONFIG['--font-size-widget-value-activity-analytics'].range.min}
                                    max={FONT_SIZE_FIELD_CONFIG['--font-size-widget-value-activity-analytics'].range.max}
                                    className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                    aria-label="VALORES EN ACTIVITY-ANALYTICS tamaño base"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Tracking</span>
                                <AdminNumberInput
                                    value={trackingValues['--tracking-widget-value-activity-analytics'] ?? TRACKING_FIELD_CONFIG['--tracking-widget-value-activity-analytics'].defaultValue}
                                    onChange={(value) => handleTrackingChange('--tracking-widget-value-activity-analytics', value)}
                                    onBlur={() => handleTrackingBlur('--tracking-widget-value-activity-analytics')}
                                    min={TRACKING_FIELD_CONFIG['--tracking-widget-value-activity-analytics'].range.min}
                                    max={TRACKING_FIELD_CONFIG['--tracking-widget-value-activity-analytics'].range.max}
                                    step={TRACKING_FIELD_CONFIG['--tracking-widget-value-activity-analytics'].range.step}
                                    className={TYPOGRAPHY_COMPACT_NUMBER_CLS}
                                    aria-label="VALORES EN ACTIVITY-ANALYTICS tracking"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={TYPOGRAPHY_CONTROL_LABEL_CLS}>Peso</span>
                                <AdminSelect
                                    value={weightValues['--font-weight-widget-value-activity-analytics'] ?? DEFAULT_WEIGHT_VALUES['--font-weight-widget-value-activity-analytics']}
                                    onChange={(value) => handleWeightChange('--font-weight-widget-value-activity-analytics', value)}
                                    options={activityAnalyticsWeightOptions}
                                    className="shrink-0"
                                    style={{ width: `${activityAnalyticsWeightSelectWidthCh}ch` }}
                                    placeholder="Seleccionar peso"
                                />
                            </div>
                        </div>
                    </TypographySection>
                </div>

                <div className="mt-3 flex justify-end">
                    <AdminActionButton
                        variant="secondary"
                        onClick={handleResetFonts}
                        disabled={Object.keys(fontStorageOverrides).length === 0}
                    >
                        Restaurar tipografias
                    </AdminActionButton>
                </div>
            </section>

            <section className="border-t border-white/5 pt-4 mt-4">
                <div>
                    <h4 className="uppercase text-industrial-muted">
                        Colores
                    </h4>
                    <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                        Ajusta la paleta activa y guarda overrides locales en este navegador.
                    </p>
                </div>

                <div className="mt-3 space-y-4">
                    {COLOR_GROUPS.map((group) => (
                        <div key={group.title} className="space-y-2">
                            <p className="uppercase text-industrial-muted">
                                {group.title}
                            </p>

                            <div className="space-y-2">
                                {group.colors.map((color) => {
                                    const currentColor = colorValues[color.key];

                                    return (
                                        <div
                                            key={color.key}
                                            className="flex items-center gap-3 rounded-md border border-white/5 bg-black/10 px-3 py-2"
                                        >
                                            <div
                                                className="w-4 h-4 rounded border border-white/20 shrink-0"
                                                style={{ backgroundColor: currentColor }}
                                                aria-hidden="true"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-white">{color.label}</p>
                                            </div>
                                            <input
                                                type="color"
                                                value={normalizeColorForInput(currentColor)}
                                                onChange={(event) => handleColorChange(color.key, event.target.value)}
                                                className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0 appearance-none"
                                                aria-label={`Elegir color para ${color.label}`}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <div className="border-t border-white/5 pt-4 mt-4 flex justify-end">
                <AdminActionButton variant="secondary" onClick={handleReset} disabled={Object.keys(fontStorageOverrides).length === 0 && Object.keys(colorStorageOverrides).length === 0}>
                    Restaurar paleta original
                </AdminActionButton>
            </div>
        </div>
    );
}
