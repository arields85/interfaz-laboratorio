import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { variableCatalogStorage } from './VariableCatalogStorageService';
import { DASHBOARDS_STORAGE_KEY, VARIABLE_CATALOG_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import { makeDashboard, makeWidget } from '../test/fixtures/dashboard.fixture';
import type { CatalogVariable } from '../domain';
import { mockVariableCatalog } from '../mocks/variableCatalog.mock';

type StoredCatalogVariable = CatalogVariable & { dataType?: string };

function makeVariable(overrides: Partial<StoredCatalogVariable> = {}): StoredCatalogVariable {
    return {
        id: 'cv-1',
        name: 'Rotor speed',
        description: 'Main rotor speed',
        unit: 'RPM',
        dataType: 'number',
        ...overrides,
    };
}

describe('VariableCatalogStorageService', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('seeds mock catalog when storage is empty', async () => {
        const variablesPromise = variableCatalogStorage.getAll();

        await vi.advanceTimersByTimeAsync(200);
        const variables = await variablesPromise;

        expect(variables).toEqual(mockVariableCatalog);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual(mockVariableCatalog);
    });

    it('reads variables from VARIABLE_CATALOG_STORAGE_KEY', async () => {
        const variables: CatalogVariable[] = [makeVariable()];

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(variables));

        const variablesPromise = variableCatalogStorage.getAll();

        await vi.advanceTimersByTimeAsync(200);
        await expect(variablesPromise).resolves.toEqual(variables);
    });

    it('returns a variable by id or null when missing', async () => {
        const variables = [makeVariable(), makeVariable({ id: 'cv-2', name: 'Outlet temperature', unit: '°C' })];

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(variables));

        await expect(variableCatalogStorage.getById('cv-2')).resolves.toEqual(variables[1]);
        await expect(variableCatalogStorage.getById('missing-id')).resolves.toBeNull();
    });

    it('returns variables by exact unit matches', async () => {
        const variables = [
            makeVariable(),
            makeVariable({ id: 'cv-2', name: 'Aux speed', unit: 'RPM' }),
            makeVariable({ id: 'cv-3', name: 'Pressure', unit: 'bar' }),
            makeVariable({ id: 'cv-4', name: 'Temperature', unit: 'rpm' }),
        ];

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(variables));

        await expect(variableCatalogStorage.getByUnit('RPM')).resolves.toEqual([variables[0], variables[1]]);
    });

    it('creates and persists a new variable', async () => {
        const existing = [makeVariable()];
        const created = makeVariable({
            id: 'cv-2',
            name: 'Hydraulic pressure',
            description: 'Hydraulic circuit pressure',
            unit: 'bar',
        });

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(existing));

        await expect(variableCatalogStorage.create(created)).resolves.toEqual(created);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual([...existing, created]);
    });

    it('rejects duplicate create names in the same unit case-insensitively', async () => {
        localStorage.setItem(
            VARIABLE_CATALOG_STORAGE_KEY,
            JSON.stringify([makeVariable({ name: 'Rotor speed', unit: 'RPM' })]),
        );

        await expect(
            variableCatalogStorage.create(makeVariable({ id: 'cv-2', name: 'ROTOR SPEED', unit: 'RPM' })),
        ).rejects.toThrow('Variable "ROTOR SPEED" already exists for unit "RPM"');
    });

    it('returns null when updating a missing variable', async () => {
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([makeVariable()]));

        await expect(
            variableCatalogStorage.update('missing-id', { name: 'Updated name', description: 'Updated description' }),
        ).resolves.toBeNull();
    });

    it('preserves id, unit, and dataType while updating name and description', async () => {
        const storedVariable = makeVariable();
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([storedVariable]));

        const updated = await variableCatalogStorage.update(storedVariable.id, {
            name: 'Updated rotor speed',
            description: 'Updated description',
        });

        expect(updated).toEqual({
            ...storedVariable,
            name: 'Updated rotor speed',
            description: 'Updated description',
        });
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual([
            {
                ...storedVariable,
                name: 'Updated rotor speed',
                description: 'Updated description',
            },
        ]);
    });

    it('rejects duplicate update names in the same unit', async () => {
        const variables = [
            makeVariable({ id: 'cv-1', name: 'Rotor speed', unit: 'RPM' }),
            makeVariable({ id: 'cv-2', name: 'Aux speed', unit: 'RPM' }),
        ];

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(variables));

        await expect(
            variableCatalogStorage.update('cv-2', { name: 'ROTOR SPEED', description: 'Duplicate name' }),
        ).rejects.toThrow('Variable "ROTOR SPEED" already exists for unit "RPM"');
    });

    it('returns false and does not rewrite storage when deleting a missing variable', async () => {
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
        const variables = [makeVariable()];

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(variables));
        setItemSpy.mockClear();

        await expect(variableCatalogStorage.delete('missing-id')).resolves.toBe(false);
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual(variables);
    });

    it('returns true and removes the variable when deleting an existing variable', async () => {
        const variables = [makeVariable(), makeVariable({ id: 'cv-2', name: 'Aux speed' })];

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(variables));

        await expect(variableCatalogStorage.delete('cv-2')).resolves.toBe(true);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual([variables[0]]);
    });

    it('returns an empty array when dashboard storage is absent', async () => {
        await expect(variableCatalogStorage.getAffectedDashboards('cv-1')).resolves.toEqual([]);
    });

    it('reads affected dashboards from DASHBOARDS_STORAGE_KEY', async () => {
        const dashboards = [
            makeDashboard({
                id: 'dashboard-1',
                name: 'Dashboard afectado',
                widgets: [
                    makeWidget({
                        id: 'widget-1',
                        binding: { mode: 'real_variable', catalogVariableId: 'cv-1' },
                    }),
                ],
            }),
        ];

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(dashboards));

        await expect(variableCatalogStorage.getAffectedDashboards('cv-1')).resolves.toEqual([
            { id: 'dashboard-1', name: 'Dashboard afectado' },
        ]);
    });

    it('ignores dashboards without matching bindings', async () => {
        const dashboards = [
            makeDashboard({
                id: 'dashboard-1',
                name: 'No binding',
                widgets: [makeWidget({ id: 'widget-1' })],
            }),
            makeDashboard({
                id: 'dashboard-2',
                name: 'Different variable',
                widgets: [
                    makeWidget({
                        id: 'widget-2',
                        binding: { mode: 'real_variable', catalogVariableId: 'cv-2' },
                    }),
                ],
            }),
            makeDashboard({
                id: 'dashboard-3',
                name: 'Matching dashboard',
                widgets: [
                    makeWidget({
                        id: 'widget-3',
                        binding: { mode: 'real_variable', catalogVariableId: 'cv-1' },
                    }),
                ],
            }),
        ];

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(dashboards));

        await expect(variableCatalogStorage.getAffectedDashboards('cv-1')).resolves.toEqual([
            { id: 'dashboard-3', name: 'Matching dashboard' },
        ]);
    });
});
