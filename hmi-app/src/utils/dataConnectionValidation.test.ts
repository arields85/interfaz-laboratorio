import { describe, expect, it } from 'vitest';

import { validateDataConnectionValues } from './dataConnectionValidation';

const VALID = {
    baseUrl: 'https://node-red.local:1880',
    endpoint: '/api/hmi-data',
    historyEndpoint: '/api/hmi-data/history',
    activitySeriesEndpoint: '/api/hmi-data/activity-series',
};

describe('validateDataConnectionValues', () => {
    it('accepts valid values and trims them', () => {
        const result = validateDataConnectionValues({ ...VALID, baseUrl: '  http://10.0.0.5:1880  ', endpoint: ' /api/x ' });

        expect(result).toEqual({ ok: true, values: { ...VALID, baseUrl: 'http://10.0.0.5:1880', endpoint: '/api/x' } });
    });

    it('allows empty history and activity-series endpoints (feature disabled)', () => {
        const result = validateDataConnectionValues({ ...VALID, historyEndpoint: '', activitySeriesEndpoint: ' ' });

        expect(result).toEqual({ ok: true, values: { ...VALID, historyEndpoint: '', activitySeriesEndpoint: '' } });
    });

    it.each([
        ['', 'La URL base es obligatoria.'],
        ['node-red.local', 'La URL base debe ser una URL absoluta http o https.'],
        ['/relative', 'La URL base debe ser una URL absoluta http o https.'],
        ['ftp://node-red.local', 'La URL base debe ser una URL absoluta http o https.'],
        ['javascript:alert(1)', 'La URL base debe ser una URL absoluta http o https.'],
    ])('rejects base URL %j', (baseUrl, message) => {
        expect(validateDataConnectionValues({ ...VALID, baseUrl })).toEqual({ ok: false, message });
    });

    it.each([
        ['endpoint', '', 'El endpoint snapshot es obligatorio.'],
        ['endpoint', 'api/hmi-data', 'El endpoint snapshot debe ser una ruta que comience con "/".'],
        ['endpoint', 'https://x.local/api', 'El endpoint snapshot debe ser una ruta que comience con "/".'],
        ['endpoint', '//x.local/api', 'El endpoint snapshot debe ser una ruta que comience con "/".'],
        ['historyEndpoint', 'history', 'El endpoint histórico debe ser una ruta que comience con "/".'],
        ['activitySeriesEndpoint', '/with space', 'El endpoint activity-series debe ser una ruta que comience con "/".'],
    ])('rejects %s = %j', (field, value, message) => {
        expect(validateDataConnectionValues({ ...VALID, [field]: value })).toEqual({ ok: false, message });
    });
});
