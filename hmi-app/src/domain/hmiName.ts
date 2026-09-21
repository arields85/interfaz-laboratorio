// Display-label bound shared with the phone confirmation contract.
export const MAX_HMI_NAME_CHARACTERS = 160;

export type HmiNameReadResult =
    | { ok: true; name: string | null }
    | { ok: false; name: null; error: 'invalid' | 'unavailable' };

export type HmiNameSaveResult =
    | { ok: true; name: string | null }
    | { ok: false; error: 'invalid' | 'unavailable' };

export function normalizeHmiName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || [...trimmed].length > MAX_HMI_NAME_CHARACTERS) return null;
    // Only ordinary spaces may separate printable label characters.
    if (/[^\S ]|\p{C}|\p{Z}/u.test(trimmed.replace(/ /g, ''))) return null;
    return trimmed.replace(/ +/g, ' ');
}
