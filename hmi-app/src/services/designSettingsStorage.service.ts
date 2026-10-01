import { sharedConfigStorage } from './sharedConfigStorage.service';

// Persistence side of the design settings (Configuración general -> Diseño): the font and colour
// override maps live in the shared configuration, so every browser applies the administrator's design.
export const DESIGN_FONT_STORAGE_KEY = 'hmi-theme-fonts';
export const DESIGN_COLOR_STORAGE_KEY = 'hmi-theme-colors';

function isStringRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).every((entry) => typeof entry === 'string');
}

/** The stored override map for a design key; anything absent or malformed reads as empty. */
export function readDesignOverrides(storageKey: string): Record<string, string> {
    try {
        const storedValue = sharedConfigStorage.getItem(storageKey);
        if (!storedValue) {
            return {};
        }

        const parsedValue: unknown = JSON.parse(storedValue);
        return isStringRecord(parsedValue) ? parsedValue : {};
    } catch {
        return {};
    }
}

/** The raw stored JSON for a design key, or null when it was never saved. */
export function readRawDesignOverrides(storageKey: string): string | null {
    return sharedConfigStorage.getItem(storageKey);
}

export function writeDesignOverrides(storageKey: string, overrides: Record<string, string>): void {
    if (Object.keys(overrides).length === 0) {
        sharedConfigStorage.removeItem(storageKey);
        return;
    }

    sharedConfigStorage.setItem(storageKey, JSON.stringify(overrides));
}

export function clearDesignOverrides(storageKey: string): void {
    sharedConfigStorage.removeItem(storageKey);
}
