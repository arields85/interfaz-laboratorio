export interface LedaSessionMetadata {
    ok: true;
    idleExpiresAt: number;
    absoluteExpiresAt: number;
}

declare const contextIntentBrand: unique symbol;

/** Opaque local intent; authority and ordering remain private to its client. */
export interface LedaContextIntent {
    readonly [contextIntentBrand]: true;
}

export type LedaContextCommand =
    | { version: 1; command: 'publish'; order: number; snapshot: unknown; frameGeneration?: number }
    | { version: 1; command: 'invalidate'; order: number };

export interface LedaSessionRequestSnapshot {
    epoch: number;
}
