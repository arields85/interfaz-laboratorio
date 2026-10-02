// How the HMI and Leda address people: formal "usted" (default), Rioplatense "vos" or neutral "tú".
// Stored in the shared HMI configuration; services/leda-runtime/src/leda_runtime/copy_register.py
// mirrors this contract on the runtime side.

export const COPY_REGISTERS = ['usted', 'rioplatense', 'neutro'] as const;

export type CopyRegister = (typeof COPY_REGISTERS)[number];

export const DEFAULT_COPY_REGISTER: CopyRegister = 'usted';

const COPY_REGISTER_VERSION = 1;

function isCopyRegister(value: unknown): value is CopyRegister {
    return COPY_REGISTERS.some((register) => register === value);
}

/** Strict parser: anything other than exactly `{ version: 1, register }` reads as the default. */
export function parseCopyRegister(raw: string | null): CopyRegister {
    if (raw === null) return DEFAULT_COPY_REGISTER;
    try {
        const stored: unknown = JSON.parse(raw);
        if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return DEFAULT_COPY_REGISTER;
        if (Object.keys(stored).length !== 2 || !('version' in stored) || !('register' in stored)) {
            return DEFAULT_COPY_REGISTER;
        }
        if (stored.version !== COPY_REGISTER_VERSION || !isCopyRegister(stored.register)) {
            return DEFAULT_COPY_REGISTER;
        }
        return stored.register;
    } catch {
        return DEFAULT_COPY_REGISTER;
    }
}

export function serializeCopyRegister(register: CopyRegister): string {
    return JSON.stringify({ version: COPY_REGISTER_VERSION, register });
}
