import type {
    CredentialAdministrationClient,
    CredentialAdministrationController,
} from '../../hooks/usePrismaCredentialAdministration';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, Play, RefreshCw, Save, Trash2 } from 'lucide-react';

import type { CredentialProvider } from '../../domain';
import { usePrismaCredentialAdministration } from '../../hooks/usePrismaCredentialAdministration';
import { AdminAuthError } from '../../services/adminAuth.service';
import { useAuthStore } from '../../store/auth.store';
import HmiButton from '../ui/HmiButton';
import AdminDialog from './AdminDialog';
import { ADMIN_SIDEBAR_INPUT_CLS, ADMIN_SIDEBAR_SECTION_HEADER_CLS } from './adminSidebarStyles';

interface VoiceCredentialSettingsProps {
    active: boolean;
    client?: CredentialAdministrationClient;
    controller?: CredentialAdministrationController;
}

type Feedback = { kind: 'success' | 'warning' | 'error'; text: string } | null;

function errorText(error: unknown): string {
    const code = error instanceof AdminAuthError ? error.code : error instanceof Error ? error.message : '';
    return {
        CREDENTIAL_STORAGE_UNAVAILABLE: 'El almacén protegido no está disponible. Revise el aprovisionamiento local.',
        AUTH_STORAGE_UNAVAILABLE: 'El servicio de autenticación no está disponible.',
        ADMIN_CREDENTIAL_BLANK: 'Ingrese una credencial no vacía.',
        ADMIN_CREDENTIAL_TOO_LARGE: 'La credencial supera el máximo permitido de 4096 bytes.',
        AUTHENTICATION_REQUIRED: 'La sesión de administrador ya no está disponible.',
        CSRF_VALIDATION_FAILED: 'La sesión cambió. Vuelva a intentar la acción de forma explícita.',
        TELEGRAM_CREDENTIAL_MISSING: 'Telegram no tiene una credencial protegida para aplicar.',
        TELEGRAM_DISABLED: 'Telegram está deshabilitado en la configuración local.',
        TELEGRAM_PROVIDER_UNAVAILABLE: 'El proveedor de Telegram no está disponible.',
        TELEGRAM_STOP_TIMEOUT: 'No se pudo confirmar la detención de Telegram.',
        TELEGRAM_POLL_FAILED: 'Telegram informó una falla de conexión.',
        TELEGRAM_PREPARATION_FAILED: 'Telegram no pudo completar su preparación.',
        PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING: 'Falta la credencial de Telegram en el entorno local.',
    }[code] ?? 'No se pudo completar la operación con el servicio local.';
}

function ProviderStatus({ configured, loading }: { configured?: boolean; loading: boolean }) {
    if (configured === undefined) return <span>{loading ? 'Consultando estado' : 'Estado no disponible'}</span>;
    return <span>{configured ? 'Configurada' : 'Sin configurar'}</span>;
}

export default function VoiceCredentialSettings({ active, client, controller }: VoiceCredentialSettingsProps) {
    const authenticated = useAuthStore((state) => state.session.isAuthenticated);
    const administration = usePrismaCredentialAdministration({ client, controller, active });
    const [geminiSecret, setGeminiSecret] = useState('');
    const [telegramSecret, setTelegramSecret] = useState('');
    const [deleteProvider, setDeleteProvider] = useState<CredentialProvider | null>(null);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const panelGenerationRef = useRef(0);
    const secretRevisionRef = useRef<Record<CredentialProvider, number>>({ gemini: 0, telegram: 0, telegram_channel_a: 0 });
    const dialogRevisionRef = useRef(0);
    const unavailable = Boolean(administration.error);
    const disabled = !authenticated || !administration.data || unavailable || administration.pendingAction !== null;
    const refreshDisabled = !authenticated || administration.pendingAction !== null;
    const retryDisabled = !authenticated || administration.pendingAction !== null;
    const credentials = administration.data?.credentials;
    const telegram = administration.data?.telegram;
    const stale = unavailable && administration.data !== null;

    useEffect(() => {
        if (active && authenticated) return;
        panelGenerationRef.current += 1;
        secretRevisionRef.current.gemini += 1;
        secretRevisionRef.current.telegram += 1;
        dialogRevisionRef.current += 1;
        setGeminiSecret('');
        setTelegramSecret('');
        setDeleteProvider(null);
        setFeedback(null);
    }, [active, authenticated]);

    const save = async (provider: CredentialProvider) => {
        const secret = provider === 'gemini' ? geminiSecret : telegramSecret;
        const panelGeneration = panelGenerationRef.current;
        const secretRevision = secretRevisionRef.current[provider];
        setFeedback(null);
        try {
            await administration.saveCredential(provider, secret);
            if (panelGenerationRef.current === panelGeneration) {
                setFeedback({ kind: 'success', text: 'Credencial guardada. No se aplicaron cambios al proveedor.' });
            }
        } catch (error) {
            if (panelGenerationRef.current === panelGeneration
                && !(error instanceof DOMException && error.name === 'AbortError')) {
                setFeedback({ kind: 'error', text: errorText(error) });
            }
        } finally {
            if (panelGenerationRef.current === panelGeneration
                && secretRevisionRef.current[provider] === secretRevision) {
                if (provider === 'gemini') setGeminiSecret('');
                else setTelegramSecret('');
            }
        }
    };

    const remove = async (provider: CredentialProvider) => {
        const panelGeneration = panelGenerationRef.current;
        const dialogRevision = dialogRevisionRef.current;
        const secretRevision = secretRevisionRef.current[provider];
        setFeedback(null);
        try {
            const outcome = await administration.deleteCredential(provider);
            if (panelGenerationRef.current === panelGeneration) {
                setFeedback(outcome.stopUnconfirmed
                    ? { kind: 'warning', text: 'La credencial fue eliminada, pero la detención no pudo confirmarse.' }
                    : { kind: 'success', text: 'Credencial eliminada.' });
            }
        } catch (error) {
            if (panelGenerationRef.current === panelGeneration
                && !(error instanceof DOMException && error.name === 'AbortError')) {
                setFeedback({ kind: 'error', text: errorText(error) });
            }
        } finally {
            if (panelGenerationRef.current === panelGeneration && dialogRevisionRef.current === dialogRevision) {
                dialogRevisionRef.current += 1;
                setDeleteProvider(null);
            }
            if (panelGenerationRef.current === panelGeneration
                && secretRevisionRef.current[provider] === secretRevision) {
                if (provider === 'gemini') setGeminiSecret('');
                else setTelegramSecret('');
            }
        }
    };

    const applyTelegram = async () => {
        const panelGeneration = panelGenerationRef.current;
        setFeedback(null);
        try {
            await administration.applyTelegram();
            if (panelGenerationRef.current === panelGeneration) {
                setFeedback({ kind: 'success', text: 'Cambio de Telegram aplicado y estado actualizado.' });
            }
        } catch (error) {
            if (panelGenerationRef.current === panelGeneration
                && !(error instanceof DOMException && error.name === 'AbortError')) {
                setFeedback({ kind: 'error', text: errorText(error) });
            }
        }
    };

    const retryTelegramStop = async () => {
        const panelGeneration = panelGenerationRef.current;
        setFeedback(null);
        try {
            const outcome = await administration.deleteCredential('telegram');
            if (panelGenerationRef.current === panelGeneration) {
                setFeedback(outcome.stopUnconfirmed
                    ? { kind: 'warning', text: 'La credencial ya no existe, pero la detención todavía no pudo confirmarse.' }
                    : { kind: 'success', text: 'La detención de Telegram quedó confirmada.' });
            }
        } catch (error) {
            if (panelGenerationRef.current === panelGeneration
                && !(error instanceof DOMException && error.name === 'AbortError')) {
                setFeedback({ kind: 'error', text: errorText(error) });
            }
        }
    };

    const updateDeleteProvider = (provider: CredentialProvider | null) => {
        dialogRevisionRef.current += 1;
        setDeleteProvider(provider);
    };

    const renderProvider = (provider: CredentialProvider, label: string, value: string, setValue: (value: string) => void) => (
        <fieldset aria-label={label} className="space-y-3 rounded border border-white/10 p-3">
            <legend className="px-1 text-industrial-text">{label}</legend>
            <div className="flex items-center justify-between gap-3 text-industrial-muted">
                <span>Credencial</span>
                <ProviderStatus configured={credentials?.[provider].configured} loading={administration.isLoading} />
            </div>
            {provider === 'gemini' && credentials ? <p className="text-industrial-muted">Verificación: no realizada</p> : null}
            <label className="flex flex-col gap-1 text-industrial-muted">
                Credencial {label}
                <input
                    type="password"
                    autoComplete="new-password"
                    value={value}
                    onChange={(event) => {
                        secretRevisionRef.current[provider] += 1;
                        setValue(event.target.value);
                    }}
                    className={ADMIN_SIDEBAR_INPUT_CLS}
                    disabled={disabled}
                />
            </label>
            <div className="flex flex-wrap gap-2">
                <HmiButton size="sm" variant="primary" disabled={disabled || !value} onClick={() => void save(provider)}>
                    <Save size={14} aria-hidden="true" />
                    Guardar credencial
                </HmiButton>
                <HmiButton size="sm" variant="danger" disabled={disabled} onClick={() => updateDeleteProvider(provider)}>
                    <Trash2 size={14} aria-hidden="true" />
                    Eliminar credencial
                </HmiButton>
            </div>
            {provider === 'telegram' && telegram ? (
                <>
                    <div className="grid grid-cols-2 gap-2 rounded border border-white/10 p-3 text-industrial-muted">
                        <span>{telegram?.restartRequired ? 'Cambio pendiente de aplicar' : 'Sin cambios pendientes'}</span>
                        <span>{telegram?.running ? 'Ejecución activa' : 'Ejecución detenida'}</span>
                        <span>{telegram?.verified ? 'Última aplicación verificada' : 'Última aplicación sin verificar'}</span>
                        <span>{telegram?.enabled ? 'Habilitada' : 'Deshabilitada'}</span>
                        <span>
                            Origen: {credentials?.telegram.configured ? 'almacén protegido' : telegram?.configured ? 'entorno local' : 'sin credencial'}
                        </span>
                        <span>
                            Generación: {telegram?.desiredGeneration ?? '—'} / {telegram?.appliedGeneration ?? '—'}
                        </span>
                    </div>
                    {telegram?.configurationError || telegram?.lastError ? (
                        <p className="text-status-warning">
                            {errorText(new AdminAuthError(telegram.lastError ?? telegram.configurationError ?? '', null))}
                        </p>
                    ) : null}
                    <HmiButton
                        size="sm"
                        variant="primary"
                        disabled={disabled || !credentials?.telegram.configured}
                        onClick={() => void applyTelegram()}
                    >
                        <Play size={14} aria-hidden="true" />
                        Aplicar cambio
                    </HmiButton>
                </>
            ) : null}
        </fieldset>
    );

    return (
        <section className="rounded-lg border border-white/10 bg-black/10 p-4">
            <h3 className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                <KeyRound size={14} aria-hidden="true" />
                Credenciales de proveedores
            </h3>
            <p className="mb-3 text-industrial-muted">
                Guardar una credencial no la aplica, no reinicia proveedores y no verifica conectividad.
            </p>
            {administration.isLoading ? <p className="text-industrial-muted">Cargando metadatos protegidos...</p> : null}
            {administration.error ? <p role="alert" className="mb-3 text-status-critical">{errorText(administration.error)}</p> : null}
            {stale ? <p className="mb-3 text-status-warning">Último estado conocido; la actualización falló.</p> : null}
            <HmiButton size="sm" disabled={refreshDisabled} onClick={() => void administration.refresh()}>
                <RefreshCw size={14} aria-hidden="true" />
                Actualizar estado
            </HmiButton>
            <div className="grid gap-3 md:grid-cols-2">
                {renderProvider('gemini', 'Gemini', geminiSecret, setGeminiSecret)}
                {renderProvider('telegram', 'Telegram', telegramSecret, setTelegramSecret)}
            </div>
            {feedback ? (
                <div
                    role={feedback.kind === 'success' ? 'status' : 'alert'}
                    className={`mt-3 ${feedback.kind === 'error' ? 'text-status-critical' : feedback.kind === 'warning' ? 'text-status-warning' : 'text-status-normal'}`}
                >
                    {feedback.text}
                    {feedback.kind === 'warning' ? (
                        <HmiButton className="ml-3" size="sm" disabled={retryDisabled} onClick={() => void retryTelegramStop()}>
                            <RefreshCw size={14} aria-hidden="true" />
                            Reintentar detención
                        </HmiButton>
                    ) : null}
                </div>
            ) : null}
            <AdminDialog
                open={deleteProvider !== null}
                title="Eliminar credencial"
                onClose={() => updateDeleteProvider(null)}
                actions={(
                    <>
                        <HmiButton onClick={() => updateDeleteProvider(null)}>Cancelar</HmiButton>
                        <HmiButton variant="danger" disabled={disabled} onClick={() => deleteProvider && void remove(deleteProvider)}>
                            <Trash2 size={14} aria-hidden="true" />
                            Confirmar eliminación
                        </HmiButton>
                    </>
                )}
            >
                <p>La credencial protegida se eliminará del servicio local. Esta acción no puede deshacerse.</p>
            </AdminDialog>
        </section>
    );
}
