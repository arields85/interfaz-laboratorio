interface EppiEntryState {
    coreReturnTo: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function isEppiPathname(pathname: string): boolean {
    return pathname === '/eppi' || pathname.startsWith('/eppi/');
}

function isValidCoreTarget(value: unknown): value is string {
    return typeof value === 'string'
        && value.startsWith('/')
        && !value.startsWith('//')
        && !isEppiPathname(value.split('?')[0] ?? value);
}

export function createEppiEntryState(pathname: string, search: string): EppiEntryState {
    return { coreReturnTo: `${pathname}${search}` };
}

export function preserveEppiEntryState(state: unknown): EppiEntryState | undefined {
    if (!isRecord(state) || !isValidCoreTarget(state.coreReturnTo)) {
        return undefined;
    }

    return { coreReturnTo: state.coreReturnTo };
}

export function getCoreReturnTarget(state: unknown): string {
    return preserveEppiEntryState(state)?.coreReturnTo ?? '/';
}

export type { EppiEntryState };
