import { beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_PRISMA_STORAGE_KEY_RENAMES, migrateLegacyPrismaStorageKeys } from './legacyPrismaStorageMigration';

function createStore(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem: (key: string): string | null => map.get(key) ?? null,
        setItem: (key: string, value: string): void => { map.set(key, value); },
        removeItem: (key: string): void => { map.delete(key); },
    };
}

describe('migrateLegacyPrismaStorageKeys', () => {
    beforeEach(() => localStorage.clear());

    it('lists every renamed browser key', () => {
        expect(LEGACY_PRISMA_STORAGE_KEY_RENAMES).toEqual([
            ['hmi:prisma-hmi-name', 'hmi:leda-hmi-name'],
            ['hmi:prisma-orb-visual-config', 'hmi:leda-orb-visual-config'],
            ['hmi-prisma-voice-prebuffer-history', 'hmi-leda-voice-prebuffer-history'],
        ]);
    });

    it('copies each old value to the new key and removes the old key', () => {
        const store = createStore({
            'hmi:prisma-hmi-name': '"Planta Norte"',
            'hmi:prisma-orb-visual-config': '{"a":1}',
            'hmi-prisma-voice-prebuffer-history': '[1,2]',
        });

        const migrated = migrateLegacyPrismaStorageKeys(store);

        expect(migrated).toBe(3);
        expect(store.getItem('hmi:leda-hmi-name')).toBe('"Planta Norte"');
        expect(store.getItem('hmi:leda-orb-visual-config')).toBe('{"a":1}');
        expect(store.getItem('hmi-leda-voice-prebuffer-history')).toBe('[1,2]');
        expect(store.getItem('hmi:prisma-hmi-name')).toBeNull();
        expect(store.getItem('hmi:prisma-orb-visual-config')).toBeNull();
        expect(store.getItem('hmi-prisma-voice-prebuffer-history')).toBeNull();
    });

    it('never overwrites an existing new value but still drops the old key', () => {
        const store = createStore({ 'hmi:prisma-hmi-name': '"old"', 'hmi:leda-hmi-name': '"new"' });

        expect(migrateLegacyPrismaStorageKeys(store)).toBe(0);

        expect(store.getItem('hmi:leda-hmi-name')).toBe('"new"');
        expect(store.getItem('hmi:prisma-hmi-name')).toBeNull();
    });

    it('is idempotent and touches nothing when there are no old keys', () => {
        const store = createStore({ 'hmi:leda-hmi-name': '"x"', other: 'y' });

        expect(migrateLegacyPrismaStorageKeys(store)).toBe(0);
        expect(migrateLegacyPrismaStorageKeys(store)).toBe(0);

        expect([...store.map.keys()].sort()).toEqual(['hmi:leda-hmi-name', 'other']);
    });

    it('defaults to window.localStorage', () => {
        localStorage.setItem('hmi:prisma-hmi-name', '"A"');

        migrateLegacyPrismaStorageKeys();

        expect(localStorage.getItem('hmi:leda-hmi-name')).toBe('"A"');
        expect(localStorage.getItem('hmi:prisma-hmi-name')).toBeNull();
    });

    it('never throws when storage is unavailable', () => {
        const broken = {
            getItem: (): string | null => { throw new Error('denied'); },
            setItem: (): void => { throw new Error('denied'); },
            removeItem: (): void => { throw new Error('denied'); },
        };

        expect(() => migrateLegacyPrismaStorageKeys(broken)).not.toThrow();
        expect(migrateLegacyPrismaStorageKeys(broken)).toBe(0);
    });
});
