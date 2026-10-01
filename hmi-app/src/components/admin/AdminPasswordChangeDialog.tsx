import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';

import {
    MAX_ADMIN_PASSWORD_BYTES,
    MIN_ADMIN_PASSWORD_CHARACTERS,
    validateAdminPasswordChange,
    type AdminPasswordChangeIssue,
} from '../../domain';
import { AdminAuthError, adminAuthClient } from '../../services/adminAuth.service';
import { adminSessionController } from '../../services/adminSession.controller';
import HmiButton from '../ui/HmiButton';
import AdminDialog from './AdminDialog';
import { ADMIN_SIDEBAR_INPUT_CLS } from './adminSidebarStyles';

export interface PasswordChangeClient {
    changePassword(currentPassword: string, newPassword: string, signal?: AbortSignal): Promise<void>;
}

export interface PasswordChangeController {
    handleProtectedRequestError(error: unknown): Promise<void>;
}

interface AdminPasswordChangeDialogProps {
    open: boolean;
    onClose: () => void;
    client?: PasswordChangeClient;
    controller?: PasswordChangeController;
}

type Feedback = { kind: 'success' | 'error'; text: string } | null;

const NEW_TOO_SHORT_TEXT = `La nueva contraseña debe tener al menos ${MIN_ADMIN_PASSWORD_CHARACTERS} caracteres.`;
const NEW_UNCHANGED_TEXT = 'La nueva contraseña debe ser distinta de la actual.';

const ISSUE_TEXT: Record<AdminPasswordChangeIssue, string> = {
    CURRENT_REQUIRED: 'Ingrese su contraseña actual.',
    NEW_TOO_SHORT: NEW_TOO_SHORT_TEXT,
    NEW_TOO_LARGE: `La nueva contraseña no puede superar ${MAX_ADMIN_PASSWORD_BYTES} bytes.`,
    NEW_UNCHANGED: NEW_UNCHANGED_TEXT,
    CONFIRMATION_MISMATCH: 'La confirmación no coincide con la nueva contraseña.',
};

const ERROR_TEXT: Record<string, string> = {
    INVALID_CURRENT_PASSWORD: 'La contraseña actual es incorrecta.',
    PASSWORD_POLICY_REJECTED: NEW_TOO_SHORT_TEXT,
    PASSWORD_UNCHANGED: NEW_UNCHANGED_TEXT,
    LOGIN_RATE_LIMITED: 'Demasiados intentos. Intente nuevamente más tarde.',
    AUTH_STORAGE_UNAVAILABLE: 'El servicio de autenticación no está disponible.',
    AUTHENTICATION_REQUIRED: 'La sesión de administrador ya no está disponible.',
    CSRF_VALIDATION_FAILED: 'La sesión cambió. Vuelva a intentar la acción de forma explícita.',
};
const FALLBACK_ERROR_TEXT = 'No se pudo cambiar la contraseña.';

const SUCCESS_TEXT = 'Contraseña actualizada. Las demás sesiones de administrador se cerraron.';
const FIELD_LABEL_CLS = 'text-industrial-muted';

// A wrong current password answers 401 like a lost session does, so only the session-level
// failures are handed to the controller; INVALID_CURRENT_PASSWORD is a form error.
function isSessionFailure(error: AdminAuthError): boolean {
    return error.code !== 'INVALID_CURRENT_PASSWORD' && (error.status === 401 || error.status === 403);
}

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

// Passwords live only in this component's state: they are never persisted, logged or kept
// after a success, and an unmount aborts a request still in flight.
export default function AdminPasswordChangeDialog({
    open,
    onClose,
    client = adminAuthClient,
    controller = adminSessionController,
}: AdminPasswordChangeDialogProps) {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [pending, setPending] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const requestRef = useRef<AbortController | null>(null);

    useEffect(() => () => requestRef.current?.abort(), []);

    const canSubmit = !pending && current !== '' && next !== '' && confirmation !== '';

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        const issue = validateAdminPasswordChange({ current, next, confirmation });
        if (issue) {
            setFeedback({ kind: 'error', text: ISSUE_TEXT[issue] });
            return;
        }
        const request = new AbortController();
        requestRef.current = request;
        setPending(true);
        setFeedback(null);
        try {
            await client.changePassword(current, next, request.signal);
            setCurrent('');
            setNext('');
            setConfirmation('');
            setFeedback({ kind: 'success', text: SUCCESS_TEXT });
        } catch (error) {
            if (isAbort(error)) return;
            const code = error instanceof AdminAuthError ? error.code : '';
            setFeedback({ kind: 'error', text: ERROR_TEXT[code] ?? FALLBACK_ERROR_TEXT });
            if (code === 'INVALID_CURRENT_PASSWORD') setCurrent('');
            if (error instanceof AdminAuthError && isSessionFailure(error)) {
                await controller.handleProtectedRequestError(error);
            }
        } finally {
            if (requestRef.current === request) requestRef.current = null;
            setPending(false);
        }
    };

    const field = (id: string, label: string, value: string, autoComplete: string, onChange: (value: string) => void) => (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className={FIELD_LABEL_CLS}>{label}</label>
            <input
                id={id}
                type="password"
                autoComplete={autoComplete}
                spellCheck={false}
                value={value}
                disabled={pending}
                onChange={(event) => onChange(event.target.value)}
                className={ADMIN_SIDEBAR_INPUT_CLS}
            />
        </div>
    );

    return (
        <AdminDialog
            open={open}
            title="Cambiar contraseña"
            onClose={onClose}
            actions={(
                <>
                    <HmiButton onClick={onClose}>Cancelar</HmiButton>
                    <HmiButton variant="primary" type="submit" form="admin-password-change-form" disabled={!canSubmit}>
                        <KeyRound size={14} aria-hidden="true" />
                        Cambiar contraseña
                    </HmiButton>
                </>
            )}
        >
            <form id="admin-password-change-form" className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
                {field('admin-password-current', 'Contraseña actual', current, 'current-password', setCurrent)}
                {field('admin-password-new', 'Nueva contraseña', next, 'new-password', setNext)}
                {field('admin-password-confirmation', 'Confirmar nueva contraseña', confirmation, 'new-password', setConfirmation)}
                <p className={FIELD_LABEL_CLS}>
                    Mínimo {MIN_ADMIN_PASSWORD_CHARACTERS} caracteres. Al cambiarla se cerrarán las demás sesiones de administrador.
                </p>
                {feedback ? (
                    <p
                        role={feedback.kind === 'success' ? 'status' : 'alert'}
                        className={feedback.kind === 'success' ? 'text-status-normal' : 'text-status-critical'}
                    >
                        {feedback.text}
                    </p>
                ) : null}
            </form>
        </AdminDialog>
    );
}
