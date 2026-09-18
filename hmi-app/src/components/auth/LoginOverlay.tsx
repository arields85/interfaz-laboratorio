import { useState, type FormEvent, type RefObject } from 'react';
import AnchoredOverlay from '../ui/AnchoredOverlay';
import { HmiButton } from '../ui';
import { useAuthStore } from '../../store/auth.store';
import { adminSessionController } from '../../services/adminSession.controller';

interface LoginOverlayProps {
    triggerRef: RefObject<HTMLElement | null>;
    isOpen: boolean;
    onClose: () => void;
}

const EMPTY_FORM_STATE = {
    username: '',
    password: '',
    error: '',
};

export default function LoginOverlay({ triggerRef, isOpen, onClose }: LoginOverlayProps) {
    const session = useAuthStore((state) => state.session);
    const sessionError = useAuthStore((state) => state.error);
    const [username, setUsername] = useState(EMPTY_FORM_STATE.username);
    const [password, setPassword] = useState(EMPTY_FORM_STATE.password);
    const [error, setError] = useState(EMPTY_FORM_STATE.error);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleClose = () => {
        setUsername(EMPTY_FORM_STATE.username);
        setPassword(EMPTY_FORM_STATE.password);
        setError(EMPTY_FORM_STATE.error);
        setIsSubmitting(false);
        onClose();
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!username.trim() || password.length === 0) {
            setError('Ingresá usuario y contraseña.');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const result = await adminSessionController.login(username, password);

        setIsSubmitting(false);

        if (!result.ok) {
            setError(result.error);
            return;
        }

        handleClose();
    };

    const user = session.user;

    return (
        <AnchoredOverlay
            triggerRef={triggerRef}
            isOpen={isOpen}
            onClose={handleClose}
            align="end"
            estimatedHeight={280}
            minWidth={280}
        >
            <div className="rounded-2xl border border-industrial-border bg-industrial-surface/95 p-4 shadow-2xl backdrop-blur-xl">
                {session.isAuthenticated && user ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <span className="uppercase text-industrial-muted">
                                Sesión activa
                            </span>
                            <strong className="text-industrial-text">{user.displayName}</strong>
                            <span className="text-industrial-muted">{user.role.name}</span>
                        </div>

                        <HmiButton
                            variant="primary"
                            fullWidth
                            onClick={() => {
                                void adminSessionController.exit();
                                handleClose();
                            }}
                        >
                            Cerrar sesion
                        </HmiButton>
                    </div>
                ) : (
                    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
                        <div className="flex flex-col gap-1">
                            <label className="text-industrial-muted" htmlFor="login-username">
                                Usuario
                            </label>
                            <input
                                id="login-username"
                                type="text"
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                className="rounded border border-industrial-border bg-industrial-hover px-2 py-1 text-industrial-text outline-none transition-colors placeholder:text-industrial-muted focus:border-admin-accent"
                                placeholder="Ingresá tu usuario"
                                autoComplete="username"
                                disabled={isSubmitting}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-industrial-muted" htmlFor="login-password">
                                Contraseña
                            </label>
                            <input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className="rounded border border-industrial-border bg-industrial-hover px-2 py-1 text-industrial-text outline-none transition-colors placeholder:text-industrial-muted focus:border-admin-accent"
                                placeholder="Ingresá tu contraseña"
                                autoComplete="current-password"
                                disabled={isSubmitting}
                            />
                        </div>

                        {error || sessionError ? (
                            <p className="text-status-critical" role="alert">
                                {error || sessionError}
                            </p>
                        ) : null}

                        <HmiButton
                            type="submit"
                            variant="primary"
                            fullWidth
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Ingresando...' : 'Ingresar'}
                        </HmiButton>
                    </form>
                )}
            </div>
        </AnchoredOverlay>
    );
}
