// Administrator password policy as the HMI enforces it before asking the server. The runtime
// (services/leda-runtime/src/leda_runtime/admin_auth.py) stays authoritative; these bounds are
// pinned to its constants by adminPasswordPolicy.types.test.ts.

// Minimum length of a password being set, in characters (Unicode code points, as the runtime counts).
export const MIN_ADMIN_PASSWORD_CHARACTERS = 10;
// Ceiling of any password, in UTF-8 bytes.
export const MAX_ADMIN_PASSWORD_BYTES = 1024;

export type AdminPasswordChangeIssue =
    | 'CURRENT_REQUIRED'
    | 'NEW_TOO_SHORT'
    | 'NEW_TOO_LARGE'
    | 'NEW_UNCHANGED'
    | 'CONFIRMATION_MISMATCH';

export interface AdminPasswordChangeInput {
    current: string;
    next: string;
    confirmation: string;
}

// First problem found, or null when the change may be sent. The policy comes before the
// confirmation so the person fixes the password itself first.
export function validateAdminPasswordChange({
    current,
    next,
    confirmation,
}: AdminPasswordChangeInput): AdminPasswordChangeIssue | null {
    if (!current) return 'CURRENT_REQUIRED';
    if ([...next].length < MIN_ADMIN_PASSWORD_CHARACTERS) return 'NEW_TOO_SHORT';
    if (new TextEncoder().encode(next).byteLength > MAX_ADMIN_PASSWORD_BYTES) return 'NEW_TOO_LARGE';
    if (next === current) return 'NEW_UNCHANGED';
    if (next !== confirmation) return 'CONFIRMATION_MISMATCH';
    return null;
}
