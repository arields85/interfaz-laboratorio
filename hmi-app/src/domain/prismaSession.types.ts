export interface PrismaSessionMetadata {
    ok: true;
    idleExpiresAt: number;
    absoluteExpiresAt: number;
}

export interface PrismaSessionRequestSnapshot {
    epoch: number;
}
