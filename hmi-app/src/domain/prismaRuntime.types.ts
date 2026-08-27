export type PrismaRuntimeMode = 'central' | 'local';

export type PrismaRuntimeProfileSource = 'persisted' | 'query';

export interface PrismaRuntimeProfile {
    mode: PrismaRuntimeMode;
    source: PrismaRuntimeProfileSource;
    isTemporaryOverride: boolean;
    revision: number;
}
