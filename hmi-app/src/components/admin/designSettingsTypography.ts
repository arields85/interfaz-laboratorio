export const AVAILABLE_FONTS = [
    'Plus Jakarta Sans',
    'Magistral',
    'Poppins',
    'SpaceGrotesk',
    'JetBrainsMono',
    'AtkinsonHyperlegible',
    'IBMPlexSans',
    'IBMPlexMono',
    'Ubuntu',
    'Lato',
    'Mojang',
    'PixelArial',
] as const;

export type FontName = (typeof AVAILABLE_FONTS)[number];

export const AVAILABLE_WEIGHT_OPTIONS = [
    { name: 'Thin', value: '100' },
    { name: 'Extra Light', value: '200' },
    { name: 'Light', value: '300' },
    { name: 'Book', value: '400' },
    { name: 'Medium', value: '500' },
    { name: 'Semi Bold', value: '600' },
    { name: 'Bold', value: '700' },
    { name: 'Extra Bold', value: '800' },
    { name: 'Black', value: '900' },
] as const;

type WeightOption = (typeof AVAILABLE_WEIGHT_OPTIONS)[number];
type FontStackKind = 'sans' | 'mono';

export const DEFAULT_SYSTEM_FONT_SIZE_PX = 11;
export const SYSTEM_FONT_SIZE_RANGE = {
    min: 10,
    max: 20,
} as const;

export const DEFAULT_MONO_FONT_SIZE_PX = 10;

export const DEFAULT_CHART_FONT_SIZE_PX = 10;
export const CHART_FONT_SIZE_RANGE = {
    min: 10,
    max: 20,
} as const;

export const DEFAULT_DASHBOARD_TITLE_FONT_SIZE_PX = 48;
export const DASHBOARD_TITLE_FONT_SIZE_RANGE = {
    min: 10,
    max: 72,
} as const;

export const DEFAULT_WIDGET_VALUE_FONT_SIZE_PX = 35;
export const WIDGET_VALUE_FONT_SIZE_RANGE = {
    min: 10,
    max: 72,
} as const;

export const DEFAULT_WIDGET_GAUGE_VALUE_FONT_SIZE_PX = DEFAULT_WIDGET_VALUE_FONT_SIZE_PX;
export const WIDGET_GAUGE_VALUE_FONT_SIZE_RANGE = {
    min: 10,
    max: 72,
} as const;

export const DEFAULT_WIDGET_UNIT_FONT_SIZE_PX = 20;
export const WIDGET_UNIT_FONT_SIZE_RANGE = {
    min: 10,
    max: 40,
} as const;

export const DEFAULT_WIDGET_GAUGE_UNIT_FONT_SIZE_PX = DEFAULT_WIDGET_UNIT_FONT_SIZE_PX;
export const WIDGET_GAUGE_UNIT_FONT_SIZE_RANGE = {
    min: 10,
    max: 40,
} as const;

export const DEFAULT_FONT_TRACKING_PX = 0;
export const FONT_TRACKING_RANGE = {
    min: -2,
    max: 5,
    step: 0.1,
} as const;

const FONT_WEIGHT_REGISTRY: Record<FontName, readonly WeightOption['value'][]> = {
    'Plus Jakarta Sans': ['300', '400', '500', '600', '700', '800'],
    Magistral: ['300', '400', '500', '700', '800'],
    Poppins: ['300'],
    SpaceGrotesk: ['400', '500', '600', '700'],
    JetBrainsMono: ['400', '500', '600', '700'],
    AtkinsonHyperlegible: ['400', '700'],
    IBMPlexSans: ['400', '600', '700'],
    IBMPlexMono: ['400', '600', '700'],
    Ubuntu: ['400'],
    Lato: ['400'],
    Mojang: ['400'],
    PixelArial: ['400'],
};

export const FONT_STACKS_BY_TOKEN = {
    '--font-system': 'sans',
    '--font-mono': 'mono',
    '--font-chart': 'mono',
    '--font-dashboard-title': 'sans',
    '--font-widget-value': 'sans',
    '--font-widget-value-gauge': 'sans',
} as const satisfies Record<string, FontStackKind>;

export type FontFamilyTokenKey = keyof typeof FONT_STACKS_BY_TOKEN;

export function isFontName(value: string): value is FontName {
    return (AVAILABLE_FONTS as readonly string[]).includes(value);
}

export function getAvailableWeightOptions(fontName: FontName): readonly WeightOption[] {
    const supportedWeights = FONT_WEIGHT_REGISTRY[fontName];
    return AVAILABLE_WEIGHT_OPTIONS.filter((option) => supportedWeights.includes(option.value));
}

export function getClosestAvailableWeight(requestedWeight: string, availableWeights: readonly WeightOption[]): string {
    const [firstWeight] = availableWeights;
    if (!firstWeight) {
        return '400';
    }

    const target = Number.parseInt(requestedWeight, 10);
    if (Number.isNaN(target)) {
        return firstWeight.value;
    }

    return availableWeights.reduce((closest, current) => {
        const closestDistance = Math.abs(Number.parseInt(closest.value, 10) - target);
        const currentDistance = Math.abs(Number.parseInt(current.value, 10) - target);

        if (currentDistance < closestDistance) {
            return current;
        }

        if (currentDistance === closestDistance && Number.parseInt(current.value, 10) < Number.parseInt(closest.value, 10)) {
            return current;
        }

        return closest;
    }, firstWeight).value;
}

export function normalizeStoredFontOverrides(overrides: Record<string, string>): Record<string, string> {
    const normalizedOverrides = { ...overrides };

    if (normalizedOverrides['--font-sans'] && !normalizedOverrides['--font-system']) {
        normalizedOverrides['--font-system'] = normalizedOverrides['--font-sans'];
    }

    if (normalizedOverrides['--font-weight-sans'] && !normalizedOverrides['--font-weight-system']) {
        normalizedOverrides['--font-weight-system'] = normalizedOverrides['--font-weight-sans'];
    }

    delete normalizedOverrides['--font-sans'];
    delete normalizedOverrides['--font-weight-sans'];

    return normalizedOverrides;
}

export function resolveFontCssVariableValue(_tokenKey: FontFamilyTokenKey, fontName: string): string {
    return JSON.stringify(fontName);
}

export function normalizeSystemFontSizeValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_SYSTEM_FONT_SIZE_PX, SYSTEM_FONT_SIZE_RANGE);
}

export function parseSystemFontSizeValue(value: string | undefined): number {
    return Number.parseInt(normalizeSystemFontSizeValue(value ?? DEFAULT_SYSTEM_FONT_SIZE_PX), 10);
}

export function normalizeChartFontSizeValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_CHART_FONT_SIZE_PX, CHART_FONT_SIZE_RANGE);
}

export function parseChartFontSizeValue(value: string | undefined): number {
    return Number.parseInt(normalizeChartFontSizeValue(value ?? DEFAULT_CHART_FONT_SIZE_PX), 10);
}

export function normalizeDashboardTitleFontSizeValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_DASHBOARD_TITLE_FONT_SIZE_PX, DASHBOARD_TITLE_FONT_SIZE_RANGE);
}

export function parseDashboardTitleFontSizeValue(value: string | undefined): number {
    return Number.parseInt(normalizeDashboardTitleFontSizeValue(value ?? DEFAULT_DASHBOARD_TITLE_FONT_SIZE_PX), 10);
}

export function normalizeWidgetValueFontSizeValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_WIDGET_VALUE_FONT_SIZE_PX, WIDGET_VALUE_FONT_SIZE_RANGE);
}

export function parseWidgetValueFontSizeValue(value: string | undefined): number {
    return Number.parseInt(normalizeWidgetValueFontSizeValue(value ?? DEFAULT_WIDGET_VALUE_FONT_SIZE_PX), 10);
}

export function normalizeWidgetGaugeValueFontSizeValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_WIDGET_GAUGE_VALUE_FONT_SIZE_PX, WIDGET_GAUGE_VALUE_FONT_SIZE_RANGE);
}

export function parseWidgetGaugeValueFontSizeValue(value: string | undefined): number {
    return Number.parseInt(normalizeWidgetGaugeValueFontSizeValue(value ?? DEFAULT_WIDGET_GAUGE_VALUE_FONT_SIZE_PX), 10);
}

export function normalizeWidgetUnitFontSizeValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_WIDGET_UNIT_FONT_SIZE_PX, WIDGET_UNIT_FONT_SIZE_RANGE);
}

export function parseWidgetUnitFontSizeValue(value: string | undefined): number {
    return Number.parseInt(normalizeWidgetUnitFontSizeValue(value ?? DEFAULT_WIDGET_UNIT_FONT_SIZE_PX), 10);
}

export function normalizeWidgetGaugeUnitFontSizeValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_WIDGET_GAUGE_UNIT_FONT_SIZE_PX, WIDGET_GAUGE_UNIT_FONT_SIZE_RANGE);
}

export function parseWidgetGaugeUnitFontSizeValue(value: string | undefined): number {
    return Number.parseInt(normalizeWidgetGaugeUnitFontSizeValue(value ?? DEFAULT_WIDGET_GAUGE_UNIT_FONT_SIZE_PX), 10);
}

export function normalizeFontTrackingValue(value: string | number): string {
    return normalizePixelValue(value, DEFAULT_FONT_TRACKING_PX, FONT_TRACKING_RANGE, 1);
}

export function parseFontTrackingValue(value: string | undefined): number {
    return Number.parseFloat(normalizeFontTrackingValue(value ?? DEFAULT_FONT_TRACKING_PX));
}

function normalizePixelValue(
    value: string | number,
    fallback: number,
    range: { min: number; max: number },
    precision = 0,
): string {
    const parsedValue = typeof value === 'number' ? value : Number.parseFloat(value);
    const safeValue = Number.isFinite(parsedValue) ? parsedValue : fallback;
    const clampedValue = Math.max(range.min, Math.min(range.max, safeValue));
    const formattedValue = precision === 0
        ? String(Math.round(clampedValue))
        : clampedValue.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');

    return `${formattedValue}px`;
}
