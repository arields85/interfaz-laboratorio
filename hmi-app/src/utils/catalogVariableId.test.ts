import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCatalogVariableId } from './catalogVariableId';

describe('buildCatalogVariableId', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('normalizes accented names and units into stable catalog id segments', () => {
        vi.spyOn(Date, 'now').mockReturnValue(46_656);
        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

        const catalogVariableId = buildCatalogVariableId('Temperatura de salida', '°C');

        expect(catalogVariableId).toMatch(/^cv-temperatura-de-salida-c-1000-[a-z0-9]{4}$/);
    });

    it('falls back to variable segments when name or unit slugify to empty content', () => {
        vi.spyOn(Date, 'now').mockReturnValue(46_656);
        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

        const catalogVariableId = buildCatalogVariableId('   ', '///');

        expect(catalogVariableId).toMatch(/^cv-variable-variable-1000-[a-z0-9]{4}$/);
    });
});
