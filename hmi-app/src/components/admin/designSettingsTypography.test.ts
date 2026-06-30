import {
    getAvailableWeightOptions,
    getClosestAvailableWeight,
    normalizeStoredFontOverrides,
    resolveFontCssVariableValue,
} from './designSettingsTypography';

describe('designSettingsTypography', () => {
    it('returns only the weights registered for each font family', () => {
        expect(getAvailableWeightOptions('Plus Jakarta Sans').map((option) => option.value)).toEqual([
            '300',
            '400',
            '500',
            '600',
            '700',
            '800',
        ]);

        expect(getAvailableWeightOptions('Poppins').map((option) => option.value)).toEqual(['300']);
        expect(getAvailableWeightOptions('AtkinsonHyperlegible').map((option) => option.value)).toEqual(['400', '700']);
    });

    it('falls back to the closest available weight when the current one is missing', () => {
        expect(getClosestAvailableWeight('900', getAvailableWeightOptions('Poppins'))).toBe('300');
        expect(getClosestAvailableWeight('500', getAvailableWeightOptions('AtkinsonHyperlegible'))).toBe('400');
        expect(getClosestAvailableWeight('650', getAvailableWeightOptions('IBMPlexSans'))).toBe('600');
    });

    it('migrates legacy sans overrides to the new system tokens', () => {
        expect(normalizeStoredFontOverrides({
            '--font-sans': 'Magistral',
            '--font-weight-sans': '700',
        })).toMatchObject({
            '--font-system': 'Magistral',
            '--font-weight-system': '700',
        });
    });

    it('migrates chart typography overrides to the prod trend floating value token when missing', () => {
        expect(normalizeStoredFontOverrides({
            '--font-chart': 'IBMPlexMono',
            '--font-weight-chart': '500',
            '--font-size-chart': '14px',
            '--tracking-chart': '0.4px',
        })).toMatchObject({
            '--font-widget-value-activity-analytics-prod-trend': 'IBMPlexMono',
            '--font-weight-widget-value-activity-analytics-prod-trend': '500',
            '--font-size-widget-value-activity-analytics-prod-trend': '14px',
            '--tracking-widget-value-activity-analytics-prod-trend': '0.4px',
        });
    });

    it('resolves CSS values with the correct fallback stacks', () => {
        expect(resolveFontCssVariableValue('--font-system', 'Magistral')).toBe('"Magistral"');
        expect(resolveFontCssVariableValue('--font-mono', 'IBMPlexMono')).toBe('"IBMPlexMono"');
    });
});
