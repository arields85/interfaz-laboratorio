import type {
    PrismaRuntimeMode,
    PrismaRuntimeProfile,
} from '../domain/prismaRuntime.types';
export const PRISMA_RUNTIME_MODE_STORAGE_KEY = 'hmi:prisma-runtime-mode';
export const PRISMA_RUNTIME_MODE_CHANGED_EVENT = 'hmi:prisma-runtime-mode-changed';
export const PRISMA_RUNTIME_QUERY_PARAMETER = 'prismaMode';
export const PRISMA_RUNTIME_LOCAL_QUERY_VALUE = 'local';
export const DEFAULT_PRISMA_RUNTIME_MODE: PrismaRuntimeMode = 'central';

let profileRevision = 0;
let lastProfileKey: string | null = null;
function isPrismaRuntimeMode(value: unknown): value is PrismaRuntimeMode {
    return value === 'central' || value === 'local';
}

function getCurrentSearch(): string {
    return typeof window === 'undefined' ? '' : window.location.search;
}
function readQueryOverride(search: string): boolean {
    try {
        const params = new URLSearchParams(search);
        const values = params.getAll(PRISMA_RUNTIME_QUERY_PARAMETER);
        return values.length === 1 && values[0] === PRISMA_RUNTIME_LOCAL_QUERY_VALUE;
    } catch {
        return false;
    }
}
function withCurrentRevision(
    mode: PrismaRuntimeMode,
    source: PrismaRuntimeProfile['source'],
): PrismaRuntimeProfile {
    const profileKey = `${mode}:${source}`;
    if (lastProfileKey !== null && lastProfileKey !== profileKey) {
        profileRevision += 1;
    }
    lastProfileKey = profileKey;

    return {
        mode,
        source,
        isTemporaryOverride: source === 'query',
        revision: profileRevision,
    };
}
export function readPrismaRuntimeMode(): PrismaRuntimeMode {
    try {
        const stored = localStorage.getItem(PRISMA_RUNTIME_MODE_STORAGE_KEY);
        return isPrismaRuntimeMode(stored) ? stored : DEFAULT_PRISMA_RUNTIME_MODE;
    } catch {
        return DEFAULT_PRISMA_RUNTIME_MODE;
    }
}
export function savePrismaRuntimeMode(value: unknown): PrismaRuntimeMode {
    if (!isPrismaRuntimeMode(value)) {
        return readPrismaRuntimeMode();
    }

    const mode = value;

    try {
        localStorage.setItem(PRISMA_RUNTIME_MODE_STORAGE_KEY, mode);
    } catch {
        return readPrismaRuntimeMode();
    }

    profileRevision += 1;
    const profile = getPrismaRuntimeProfile();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent<PrismaRuntimeProfile>(PRISMA_RUNTIME_MODE_CHANGED_EVENT, {
            detail: profile,
        }));
    }

    return mode;
}
export function resolvePrismaRuntimeProfile(search: string): PrismaRuntimeProfile {
    if (readQueryOverride(search)) {
        return withCurrentRevision('local', 'query');
    }

    return withCurrentRevision(readPrismaRuntimeMode(), 'persisted');
}
export function getPrismaRuntimeProfile(search = getCurrentSearch()): PrismaRuntimeProfile {
    return resolvePrismaRuntimeProfile(search);
}
