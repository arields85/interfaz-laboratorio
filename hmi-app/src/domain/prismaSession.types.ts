export interface PrismaSessionMetadata {
    ok: true;
    idleExpiresAt: number;
    absoluteExpiresAt: number;
}

declare const contextIntentBrand: unique symbol;

/** Opaque local intent; authority and ordering remain private to its client. */
export interface PrismaContextIntent {
    readonly [contextIntentBrand]: true;
}

export type PrismaContextCommand =
    | { version: 1; command: 'publish'; order: number; snapshot: unknown }
    | { version: 1; command: 'invalidate'; order: number };

export interface PrismaSessionRequestSnapshot {
    epoch: number;
}
