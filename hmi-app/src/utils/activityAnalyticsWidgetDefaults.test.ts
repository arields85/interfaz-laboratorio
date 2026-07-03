import { describe, expect, it } from 'vitest';
import {
    ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS,
    ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS,
    DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS,
    DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR,
    DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_DONUT_EFFECTS,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUP_BAR_WIDTHS,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUPED_BAR_EFFECTS,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_ALPHAS,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_BLEND_MODE,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_COLORS,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENT_ALPHAS,
    DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENTS,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
    DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS,
    DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS,
    createDefaultActivityAnalyticsDisplayOptions,
    resolveActivityAnalyticsGroupBarWidthForGroup,
    resolveActivityAnalyticsGroupBarWidths,
    resolveActivityAnalyticsStateGradientAlphas,
    resolveActivityAnalyticsDisplayOptions,
    resolveActivityAnalyticsCoverageColor,
    resolveActivityAnalyticsProdTrendBands,
    resolveActivityAnalyticsStateGradients,
    resolveActivityAnalyticsVisualEffects,
} from './activityAnalyticsWidgetDefaults';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

describe('activityAnalyticsWidgetDefaults', () => {
    it('exposes only first-release display modes', () => {
        expect(ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS).toEqual(['kpis-and-bars']);
    });

    it('defaults unsupported legacy display modes back to kpis-and-bars', () => {
        expect(createDefaultActivityAnalyticsDisplayOptions().displayMode).toBe('kpis-and-bars');
        expect(createDefaultActivityAnalyticsDisplayOptions().range).toBe('7d');
        expect(createDefaultActivityAnalyticsDisplayOptions().groupBy).toBe('shift');
        expect(createDefaultActivityAnalyticsDisplayOptions().groupBarWidth).toBe(0.2);
        expect(createDefaultActivityAnalyticsDisplayOptions().groupBarWidths).toEqual(DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUP_BAR_WIDTHS);
        expect(createDefaultActivityAnalyticsDisplayOptions().coverageColor).toBe(DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR);
        expect(createDefaultActivityAnalyticsDisplayOptions().stateGradients).toEqual(
            DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENTS,
        );
        expect(createDefaultActivityAnalyticsDisplayOptions().stateGradientAlphas).toEqual(
            DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENT_ALPHAS,
        );
        expect(createDefaultActivityAnalyticsDisplayOptions().visualEffects).toEqual({
            groupedBars: DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUPED_BAR_EFFECTS,
            donut: DEFAULT_ACTIVITY_ANALYTICS_INITIAL_DONUT_EFFECTS,
        });
        expect(createDefaultActivityAnalyticsDisplayOptions().prodTrendBands).toEqual({
            colors: DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_COLORS,
            alphas: DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_ALPHAS,
            blendMode: DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_BLEND_MODE,
        });
        expect(
            resolveActivityAnalyticsDisplayOptions({
                displayMode: 'kpis-bars-and-secondary',
            }),
        ).toMatchObject({
            displayMode: 'kpis-and-bars',
            groupBarWidth: 1,
            groupBarWidths: {
                shift: 1,
                day: 1,
                week: 1,
                month: 1,
            },
            coverageColor: DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR,
            stateGradients: DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS,
            stateGradientAlphas: DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS,
            visualEffects: {
                groupedBars: DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS,
                donut: DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS,
            },
            prodTrendBands: {
                colors: [undefined, undefined, undefined],
                alphas: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS,
                blendMode: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
            },
        });
    });

    it('resolves safe default prod trend bands for missing persisted widgets', () => {
        expect(resolveActivityAnalyticsProdTrendBands()).toEqual({
            colors: [undefined, undefined, undefined],
            alphas: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS,
            blendMode: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
        });

        expect(resolveActivityAnalyticsDisplayOptions().prodTrendBands).toEqual({
            colors: [undefined, undefined, undefined],
            alphas: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS,
            blendMode: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
        });
    });

    it('normalizes prod trend band malformed colors, clamps alphas independently, and falls back unsupported blend modes', () => {
        expect(resolveActivityAnalyticsProdTrendBands({
            colors: ['#112233', 'bad-token', '   '] as [string, string, string],
            alphas: [-10, 150, Number.NaN],
            blendMode: 'difference' as never,
        })).toEqual({
            colors: ['#112233', undefined, undefined],
            alphas: [0, 100, DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS[2]],
            blendMode: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
        });

        expect(resolveActivityAnalyticsDisplayOptions({
            prodTrendBands: {
                colors: ['#abcdef', null, '#654321'] as unknown as [string, string, string],
                alphas: [30, 'oops', 70] as unknown as [number, number, number],
                blendMode: 'screen',
            },
        }).prodTrendBands).toEqual({
            colors: ['#abcdef', undefined, '#654321'],
            alphas: [30, DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS[1], 70],
            blendMode: 'screen',
        });
    });

    it('resolves safe default state gradients for missing persisted widgets', () => {
        expect(resolveActivityAnalyticsStateGradients()).toEqual(
            DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS,
        );

        expect(resolveActivityAnalyticsDisplayOptions()).toMatchObject({
            stateGradients: DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS,
        });
    });

    it('resolves a safe default coverage color and falls back for malformed persisted values', () => {
        expect(resolveActivityAnalyticsCoverageColor()).toBe(DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR);
        expect(resolveActivityAnalyticsCoverageColor('#112233')).toBe('#112233');
        expect(resolveActivityAnalyticsCoverageColor('var(--color-industrial-muted)')).toBe(DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR);
        expect(resolveActivityAnalyticsDisplayOptions({ coverageColor: 'bad-value' })).toMatchObject({
            coverageColor: DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR,
        });
    });

    it('returns color-input-compatible hex defaults for every resolved state gradient slot', () => {
        const resolvedStateGradients = resolveActivityAnalyticsDisplayOptions().stateGradients;

        expect(Object.values(DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS).flat()).toHaveLength(6);
        expect(Object.values(DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS).flat()).toEqual(
            expect.arrayContaining(Object.values(resolvedStateGradients).flat()),
        );

        for (const gradient of Object.values(resolvedStateGradients)) {
            expect(gradient[0]).toMatch(HEX_COLOR_PATTERN);
            expect(gradient[1]).toMatch(HEX_COLOR_PATTERN);
        }
    });

    it('resolves safe default alpha pairs for missing persisted widgets and falls back per slot', () => {
        expect(resolveActivityAnalyticsStateGradientAlphas()).toEqual(
            DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS,
        );

        expect(
            resolveActivityAnalyticsStateGradientAlphas({
                prod: [0, 50],
                setup: [Number.NaN, 150],
                stopped: ['bad', null] as unknown as [number, number],
            }),
        ).toEqual({
            prod: [0, 50],
            setup: [DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS.setup[0], 100],
            stopped: DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS.stopped,
        });
    });

    it('preserves valid tuples while filling missing tuple slots from defaults', () => {
        expect(
            resolveActivityAnalyticsStateGradients({
                prod: ['#010203', '#040506'],
                setup: ['#111111', ''],
            }),
        ).toEqual({
            prod: ['#010203', '#040506'],
            setup: ['#111111', DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.setup[1]],
            stopped: DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.stopped,
        });
    });

    it('falls back per slot when persisted state gradients are malformed, blank, or non-hex', () => {
        expect(
            resolveActivityAnalyticsStateGradients({
                prod: ['var(--brand-accent)', '#abcdef'],
                setup: ['#123456', 'color-mix(in srgb, #123456 60%, white)'],
                stopped: ['red', null] as unknown as [string, string],
            }),
        ).toEqual({
            prod: [DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.prod[0], '#abcdef'],
            setup: ['#123456', DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.setup[1]],
            stopped: DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.stopped,
        });

        expect(
            resolveActivityAnalyticsStateGradients({
                prod: ['   ', '#abcdef'],
                setup: ['#123456'] as unknown as [string, string],
                stopped: [42, null] as unknown as [string, string],
            }),
        ).toEqual({
            prod: [DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.prod[0], '#abcdef'],
            setup: ['#123456', DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.setup[1]],
            stopped: DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.stopped,
        });
    });

    it('clamps grouped-bars and donut effects independently while preserving per-surface defaults', () => {
        expect(resolveActivityAnalyticsVisualEffects()).toEqual({
            groupedBars: DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS,
            donut: DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS,
        });

        expect(
            resolveActivityAnalyticsVisualEffects({
                groupedBars: {
                    glow: -10,
                    blur: 10,
                    topCap: false,
                    topCapGlow: Number.NaN,
                },
                donut: {
                    glow: 25,
                    blur: 4,
                    topCap: true,
                    topCapGlow: 120,
                },
            }),
        ).toEqual({
            groupedBars: {
                glow: 0,
                blur: 8,
                topCap: false,
                topCapGlow: DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS.topCapGlow,
            },
            donut: {
                glow: 25,
                blur: 4,
                topCap: true,
                topCapGlow: 100,
            },
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                visualEffects: {
                    groupedBars: { glow: 35 },
                    donut: { blur: 6 },
                },
            }),
        ).toMatchObject({
            visualEffects: {
                groupedBars: {
                    glow: 35,
                    blur: DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS.blur,
                    topCap: DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS.topCap,
                    topCapGlow: DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS.topCapGlow,
                },
                donut: {
                    glow: DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS.glow,
                    blur: 6,
                    topCap: DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS.topCap,
                    topCapGlow: DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS.topCapGlow,
                },
            },
        });
    });

    it('defaults and clamps grouped bar width to the production-history-safe range independently per group', () => {
        expect(resolveActivityAnalyticsDisplayOptions()).toMatchObject({
            groupBarWidth: 1,
            groupBarWidths: {
                shift: 1,
                day: 1,
                week: 1,
                month: 1,
            },
        });

        expect(resolveActivityAnalyticsDisplayOptions({ groupBarWidth: 0.4 })).toMatchObject({
            groupBarWidth: 0.4,
            groupBarWidths: {
                shift: 0.4,
                day: 0.4,
                week: 0.4,
                month: 0.4,
            },
        });

        expect(resolveActivityAnalyticsDisplayOptions({ groupBarWidth: 1.4 })).toMatchObject({
            groupBarWidth: 1.4,
        });

        expect(resolveActivityAnalyticsDisplayOptions({ groupBarWidth: 2 })).toMatchObject({
            groupBarWidth: 1.5,
        });

        expect(resolveActivityAnalyticsDisplayOptions({ groupBarWidth: Number.NaN })).toMatchObject({
            groupBarWidth: 1,
        });

        expect(resolveActivityAnalyticsDisplayOptions({
            range: '30d',
            groupBy: 'week',
            groupBarWidth: 1.2,
            groupBarWidths: {
                shift: 0.05,
                day: 0.25,
                week: 9,
            },
        })).toMatchObject({
            groupBarWidth: 1.5,
            groupBarWidths: {
                shift: 0.1,
                day: 0.25,
                week: 1.5,
                month: 1.2,
            },
        });
    });

    it('resolves per-group widths with legacy fallback and group-specific lookup', () => {
        expect(resolveActivityAnalyticsGroupBarWidths(undefined, 0.6)).toEqual({
            shift: 0.6,
            day: 0.6,
            week: 0.6,
            month: 0.6,
        });

        expect(ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS.map((groupBy) => resolveActivityAnalyticsGroupBarWidthForGroup(groupBy, {
            shift: 0.2,
            day: 0.7,
            week: 1.1,
            month: 1.4,
        }))).toEqual([0.2, 0.7, 1.1, 1.4]);
    });

    it('normalizes legacy 1h, removed 24h, and invalid grouped combinations through the shared rules contract', () => {
        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '1h',
                groupBy: 'month',
            }),
        ).toMatchObject({
            range: '7d',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '24h',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: '7d',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: 'custom',
                start: '2026-06-01T10:00:00.000Z',
                end: '2026-06-01T18:00:00.000Z',
                groupBy: 'week',
            }),
        ).toMatchObject({
            range: 'custom',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: 'custom',
                start: '2026-06-01T10:00:00.000Z',
                end: '2026-06-11T10:00:00.000Z',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: 'custom',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '30d',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: '30d',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '12m',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: '12m',
            groupBy: 'shift',
        });
    });
});
