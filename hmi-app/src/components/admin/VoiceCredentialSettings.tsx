import type {
    CredentialAdministrationClient,
    CredentialAdministrationController,
} from '../../hooks/usePrismaCredentialAdministration';
import { useEffect, useRef, useState } from 'react';
import {
    CircleCheck,
    CircleDashed,
    CircleX,
    KeyRound,
    Loader2,
    Play,
    RefreshCw,
    Save,
    Trash2,
    WifiOff,
    type LucideIcon,
} from 'lucide-react';

import type {
    ChannelALifecyclePhase,
    CredentialProvider,
    GeminiVerificationState,
} from '../../domain';
import { usePrismaCredentialAdministration } from '../../hooks/usePrismaCredentialAdministration';
import { AdminAuthError } from '../../services/adminAuth.service';
import { useAuthStore } from '../../store/auth.store';
import HmiButton from '../ui/HmiButton';
import HoverTooltip from '../ui/HoverTooltip';
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
        TELEGRAM_BOT_IDENTITY_RESERVED: 'Este bot ya está en uso por el otro canal. Configure un bot distinto.',
        TELEGRAM_DISABLED: 'Telegram está deshabilitado en la configuración local.',
        TELEGRAM_PROVIDER_UNAVAILABLE: 'El proveedor de Telegram no está disponible.',
        TELEGRAM_STOP_TIMEOUT: 'No se pudo confirmar la detención de Telegram.',
        TELEGRAM_POLL_FAILED: 'Telegram informó una falla de conexión.',
        TELEGRAM_PREPARATION_FAILED: 'Telegram no pudo completar su preparación.',
        PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING: 'Falta la credencial de Telegram en el entorno local.',
        PRISMA_CHANNEL_A_CONFIGURATION_INVALID: 'La configuración local del Canal A es inválida.',
        PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE: 'La configuración local del Canal A no está disponible.',
        PRISMA_CHANNEL_A_CREDENTIAL_MISSING: 'El Canal A no tiene una credencial protegida.',
        PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE: 'La credencial del Canal A no está disponible.',
        PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE: 'El ciclo de vida del Canal A no está disponible.',
        PRISMA_CHANNEL_A_MANAGER_BUSY: 'El administrador del Canal A está ocupado. Reintente la acción.',
        PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE: 'El estado del Canal A no está disponible.',
        PRISMA_CHANNEL_A_RESTART_REQUIRED: 'El Canal A requiere un reinicio para aplicar el cambio.',
        PRISMA_CHANNEL_A_STOP_UNCONFIRMED: 'No se pudo confirmar la detención del Canal A.',
        INVALID_CREDENTIAL_REQUEST: 'La solicitud de credencial es inválida.',
        GEMINI_VERIFICATION_IN_PROGRESS: 'Ya hay una verificación en curso. Espere a que finalice.',
        GEMINI_VERIFICATION_UNAVAILABLE: 'La verificación de Gemini no está disponible.',
    }[code] ?? 'No se pudo completar la operación con el servicio local.';
}

function ProviderStatus({ configured, loading }: { configured?: boolean; loading: boolean }) {
    if (configured === undefined) return <span>{loading ? 'Consultando estado' : 'Estado no disponible'}</span>;
    return <span>{configured ? 'Configurada' : 'Sin configurar'}</span>;
}

// Single presentation mapping for the credential providers, reused by the card
// legends, the accessible input names and the deletion confirmation body.
const PROVIDER_LABELS: Record<CredentialProvider, string> = {
    gemini: 'Gemini',
    telegram: 'Telegram',
    telegram_channel_a: 'Telegram (Canal A)',
};

function emptySecretDrafts(): Record<CredentialProvider, string> {
    return { gemini: '', telegram: '', telegram_channel_a: '' };
}

// Channel A execution label must never infer quiescence from "not running":
// only the canonical lifecycle phase decides what the card shows.
function channelAExecutionLabel(phase: ChannelALifecyclePhase | null): string {
    if (phase === 'running') return 'Ejecución activa';
    if (phase === 'stopping') return 'Detención en curso';
    if (phase === null || phase === 'idle' || phase === 'stopped') return 'Ejecución detenida';
    return 'Estado de ejecución no confirmado';
}

// Fixed, non-secret placeholder: the real key is never sent to the browser
// (metadata-only by design), so this mask must never be derived from it.
// Rendered as the input's `placeholder`, not its `value`: a placeholder never
// merges with typed characters (the browser swaps it out on the first
// keystroke instead of splicing into it), and screen readers announce it as
// hint text on an empty field rather than as a value -- the field is
// correctly reported as blank, not as already holding 12 known characters.
const GEMINI_KEY_MASK = '•'.repeat(12);

type StatusTone = 'success' | 'critical' | 'warning' | 'muted';

const STATUS_TONE_CLS: Record<StatusTone, string> = {
    success: 'text-status-normal',
    critical: 'text-status-critical',
    warning: 'text-status-warning',
    muted: 'text-industrial-muted',
};

interface StatusGlyph {
    Icon: LucideIcon;
    label: string;
    tone: StatusTone;
}

// Gemini's credential/verification state is shown as a small icon (T9b: replaces
// the earlier status-text spans), so the label doubles as the icon's accessible
// name (role="img" + aria-label) and its HoverTooltip text -- the same
// icon-only + tooltip pattern T6 established for the Save/Delete buttons.
function geminiCredentialGlyph(configured: boolean): StatusGlyph {
    return configured
        ? { Icon: CircleCheck, label: 'Credencial configurada', tone: 'success' }
        : { Icon: CircleX, label: 'Credencial no configurada', tone: 'critical' };
}

function geminiVerificationGlyph(state: GeminiVerificationState): StatusGlyph {
    if (state === 'verified') return { Icon: CircleCheck, label: 'Verificada', tone: 'success' };
    if (state === 'invalid_key') return { Icon: CircleX, label: 'API key inválida', tone: 'critical' };
    if (state === 'unreachable') {
        return { Icon: WifiOff, label: 'No se pudo verificar: sin conexión con Google', tone: 'warning' };
    }
    return { Icon: CircleDashed, label: 'Verificación: no realizada', tone: 'muted' };
}

function StatusIcon({ Icon, label, tone }: StatusGlyph) {
    return (
        <HoverTooltip label={label} position="top">
            <span role="img" aria-label={label} className={STATUS_TONE_CLS[tone]}>
                <Icon size={16} aria-hidden="true" />
            </span>
        </HoverTooltip>
    );
}

export default function VoiceCredentialSettings({ active, client, controller }: VoiceCredentialSettingsProps) {
    const authenticated = useAuthStore((state) => state.session.isAuthenticated);
    const administration = usePrismaCredentialAdministration({ client, controller, active });
    const [secretDrafts, setSecretDrafts] = useState<Record<CredentialProvider, string>>(emptySecretDrafts);
    const [deleteProvider, setDeleteProvider] = useState<CredentialProvider | null>(null);
    const [feedback, setFeedback] = useState<Feedback>(null);
    // Provider whose stop-unconfirmed deletion an explicit retry targets; it
    // keeps the approved retry anchored to its originating channel only.
    const [stopRetryProvider, setStopRetryProvider] = useState<CredentialProvider | null>(null);
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
        secretRevisionRef.current.telegram_channel_a += 1;
        dialogRevisionRef.current += 1;
        setSecretDrafts(emptySecretDrafts());
        setDeleteProvider(null);
        setFeedback(null);
        setStopRetryProvider(null);
    }, [active, authenticated]);

    // Clearing one provider draft must never resurrect another provider's stale
    // value, so every reset goes through a functional update.
    const setProviderDraft = (provider: CredentialProvider, value: string) => {
        setSecretDrafts((previous) => ({ ...previous, [provider]: value }));
    };

    const clearProviderDraftIfUnchanged = (
        provider: CredentialProvider,
        secretRevision: number,
        panelGeneration: number,
    ) => {
        if (panelGenerationRef.current !== panelGeneration) return;
        if (secretRevisionRef.current[provider] !== secretRevision) return;
        setSecretDrafts((previous) => (previous[provider] === '' ? previous : { ...previous, [provider]: '' }));
    };

    const save = async (provider: CredentialProvider) => {
        const secret = secretDrafts[provider];
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
            clearProviderDraftIfUnchanged(provider, secretRevision, panelGeneration);
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
                setStopRetryProvider(outcome.stopUnconfirmed ? provider : null);
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
            clearProviderDraftIfUnchanged(provider, secretRevision, panelGeneration);
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

    const applyChannelA = async () => {
        const panelGeneration = panelGenerationRef.current;
        setFeedback(null);
        try {
            await administration.applyChannelA();
            if (panelGenerationRef.current === panelGeneration) {
                setFeedback({ kind: 'success', text: 'Cambio del Canal A aplicado y estado actualizado.' });
            }
        } catch (error) {
            if (panelGenerationRef.current === panelGeneration
                && !(error instanceof DOMException && error.name === 'AbortError')) {
                setFeedback({ kind: 'error', text: errorText(error) });
            }
        }
    };

    const verifyGemini = async () => {
        const panelGeneration = panelGenerationRef.current;
        setFeedback(null);
        try {
            await administration.verifyGemini();
        } catch (error) {
            if (panelGenerationRef.current === panelGeneration
                && !(error instanceof DOMException && error.name === 'AbortError')) {
                setFeedback({ kind: 'error', text: errorText(error) });
            }
        }
    };

    // One generalized retry for the approved stop-unconfirmed warning: it
    // targets exactly the provider that produced the warning, never the other
    // channel, and needs no configured credential (it was already deleted).
    const retryStop = async (provider: CredentialProvider) => {
        const panelGeneration = panelGenerationRef.current;
        setFeedback(null);
        try {
            const outcome = await administration.deleteCredential(provider);
            if (panelGenerationRef.current === panelGeneration) {
                setStopRetryProvider(outcome.stopUnconfirmed ? provider : null);
                setFeedback(outcome.stopUnconfirmed
                    ? { kind: 'warning', text: 'La credencial ya no existe, pero la detención todavía no pudo confirmarse.' }
                    : { kind: 'success', text: `La detención de ${PROVIDER_LABELS[provider]} quedó confirmada.` });
            }
        } catch (error) {
            if (panelGenerationRef.current === panelGeneration
                && !(error instanceof DOMException && error.name === 'AbortError')) {
                setStopRetryProvider(null);
                setFeedback({ kind: 'error', text: errorText(error) });
            }
        }
    };

    const updateDeleteProvider = (provider: CredentialProvider | null) => {
        dialogRevisionRef.current += 1;
        setDeleteProvider(provider);
    };

    // Gemini gets its own single-row layout (T9b): title and "API Key" label
    // above one row holding the input, a credential-status icon, Save,
    // Delete, and -- right-aligned -- Verificar with its own result icon.
    // Distinct from the shared Telegram/Channel A three-column row below.
    const renderGeminiProvider = () => {
        const value = secretDrafts.gemini;
        const gemini = credentials?.gemini;
        const geminiConfigured = gemini?.configured;
        const verifying = administration.pendingAction === 'verify-gemini';
        const credentialGlyph = geminiConfigured === undefined ? null : geminiCredentialGlyph(geminiConfigured);
        const showsMask = value === '' && geminiConfigured === true;

        return (
            <fieldset
                aria-label="Proveedor de voz: Gemini"
                className="flex flex-col gap-2 rounded border border-white/10 p-3"
            >
                <legend className="px-0 text-industrial-text">Proveedor de voz: Gemini</legend>
                <label htmlFor="gemini-api-key-input" className="text-industrial-muted">API Key</label>
                <div data-testid="gemini-credential-row" className="flex flex-wrap items-center gap-2">
                    <input
                        id="gemini-api-key-input"
                        type="password"
                        autoComplete="new-password"
                        value={value}
                        placeholder={showsMask ? GEMINI_KEY_MASK : undefined}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            secretRevisionRef.current.gemini += 1;
                            setProviderDraft('gemini', nextValue);
                        }}
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} min-w-40 flex-1`}
                        disabled={disabled}
                    />
                    {credentialGlyph ? <StatusIcon {...credentialGlyph} /> : (
                        <span className="text-industrial-muted">
                            {administration.isLoading ? 'Consultando estado' : 'Estado no disponible'}
                        </span>
                    )}
                    <HoverTooltip label="Guardar credencial" position="top">
                        <HmiButton
                            size="sm"
                            variant="primary"
                            aria-label="Guardar credencial"
                            title="Guardar credencial"
                            disabled={disabled || !value}
                            onClick={() => void save('gemini')}
                        >
                            <Save size={14} aria-hidden="true" />
                        </HmiButton>
                    </HoverTooltip>
                    <HoverTooltip label="Eliminar credencial" position="top">
                        <HmiButton
                            size="sm"
                            variant="danger"
                            aria-label="Eliminar credencial"
                            title="Eliminar credencial"
                            disabled={disabled}
                            onClick={() => updateDeleteProvider('gemini')}
                        >
                            <Trash2 size={14} aria-hidden="true" />
                        </HmiButton>
                    </HoverTooltip>
                    {gemini ? (
                        <div className="ml-auto flex items-center gap-2">
                            <HmiButton
                                size="sm"
                                variant="secondary"
                                disabled={disabled || !gemini.configured}
                                onClick={() => void verifyGemini()}
                            >
                                {verifying ? 'Verificando…' : 'Verificar'}
                            </HmiButton>
                            {verifying ? (
                                <HoverTooltip label="Verificando…" position="top">
                                    <span role="img" aria-label="Verificando…" className="text-industrial-muted">
                                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                    </span>
                                </HoverTooltip>
                            ) : (
                                <StatusIcon {...geminiVerificationGlyph(gemini.verification.state)} />
                            )}
                        </div>
                    ) : null}
                </div>
            </fieldset>
        );
    };

    const renderProvider = (provider: CredentialProvider) => {
        if (provider === 'gemini') return renderGeminiProvider();
        const label = PROVIDER_LABELS[provider];
        const value = secretDrafts[provider];
        const isChannelA = provider === 'telegram_channel_a';
        const channelA = isChannelA ? administration.channelA : null;
        // A channel A status failure disables only that channel's controls;
        // Gemini and Telegram keep working from their own metadata.
        const channelAUnavailable = isChannelA && Boolean(administration.channelAError);
        const providerDisabled = disabled || channelAUnavailable;
        // Full-width horizontal row per provider: identity/state on the left, the credential
        // input with icon-only actions in the middle, and the apply status/action (Telegram and
        // Channel A only) on the right — wrapping to a stacked column below the md breakpoint.
        return (
            <fieldset
                aria-label={label}
                className="flex flex-col gap-3 rounded border border-white/10 p-3 md:flex-row md:items-start md:gap-4"
            >
                <div className="flex min-w-0 flex-col gap-2 md:w-56 md:shrink-0">
                    <legend className="px-0 text-industrial-text">{label}</legend>
                    <div className="flex items-center gap-2 text-industrial-muted">
                        <span>Credencial</span>
                        <ProviderStatus configured={credentials?.[provider].configured} loading={administration.isLoading} />
                    </div>
                    {provider === 'telegram_channel_a' ? (
                        <p className="text-industrial-muted">Bot dedicado para consultas remotas de la HMI. Guardar la credencial no inicia ni verifica el bot.</p>
                    ) : null}
                </div>

                <div className="flex flex-1 items-end gap-2 md:min-w-0">
                    <label className="flex flex-1 flex-col gap-1 text-industrial-muted">
                        Credencial {label}
                        <input
                            type="password"
                            autoComplete="new-password"
                            value={value}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                secretRevisionRef.current[provider] += 1;
                                setProviderDraft(provider, nextValue);
                            }}
                            className={ADMIN_SIDEBAR_INPUT_CLS}
                            disabled={providerDisabled}
                        />
                    </label>
                    <div className="flex shrink-0 gap-2">
                        <HoverTooltip label="Guardar credencial" position="top">
                            <HmiButton
                                size="sm"
                                variant="primary"
                                aria-label="Guardar credencial"
                                title="Guardar credencial"
                                disabled={providerDisabled || !value}
                                onClick={() => void save(provider)}
                            >
                                <Save size={14} aria-hidden="true" />
                            </HmiButton>
                        </HoverTooltip>
                        <HoverTooltip label="Eliminar credencial" position="top">
                            <HmiButton
                                size="sm"
                                variant="danger"
                                aria-label="Eliminar credencial"
                                title="Eliminar credencial"
                                disabled={providerDisabled}
                                onClick={() => updateDeleteProvider(provider)}
                            >
                                <Trash2 size={14} aria-hidden="true" />
                            </HmiButton>
                        </HoverTooltip>
                    </div>
                </div>

                {provider === 'telegram' || isChannelA ? (
                    <div className="flex flex-col gap-2 md:w-64 md:shrink-0">
                        {provider === 'telegram' && telegram ? (
                            <>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-white/10 p-3 text-industrial-muted">
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
                        {isChannelA && channelA ? (
                            <>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-white/10 p-3 text-industrial-muted">
                                    <span>
                                        {channelA.appliedGeneration !== null
                                            && channelA.appliedGeneration === channelA.desiredGeneration
                                            ? 'Sin cambios pendientes'
                                            : 'Cambio pendiente de aplicar'}
                                    </span>
                                    <span>{channelAExecutionLabel(channelA.activation?.phase ?? null)}</span>
                                </div>
                                {channelA.lastError ? (
                                    <p className="text-status-warning">
                                        {errorText(new AdminAuthError(channelA.lastError, null))}
                                    </p>
                                ) : null}
                                {administration.channelAError ? (
                                    <p className="text-status-warning">Último estado conocido; la actualización falló.</p>
                                ) : null}
                            </>
                        ) : null}
                        {isChannelA && administration.channelAError ? (
                            <p className="text-status-warning">{errorText(administration.channelAError)}</p>
                        ) : null}
                        {isChannelA ? (
                            <HmiButton
                                size="sm"
                                variant="primary"
                                disabled={providerDisabled || !credentials?.telegram_channel_a.configured || !channelA}
                                onClick={() => void applyChannelA()}
                            >
                                <Play size={14} aria-hidden="true" />
                                Aplicar cambio
                            </HmiButton>
                        ) : null}
                    </div>
                ) : null}
            </fieldset>
        );
    };

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
            <div className="flex flex-col gap-3">
                {renderProvider('gemini')}
                {renderProvider('telegram')}
                {renderProvider('telegram_channel_a')}
            </div>
            {feedback ? (
                <div
                    role={feedback.kind === 'success' ? 'status' : 'alert'}
                    className={`mt-3 ${feedback.kind === 'error' ? 'text-status-critical' : feedback.kind === 'warning' ? 'text-status-warning' : 'text-status-normal'}`}
                >
                    {feedback.text}
                    {feedback.kind === 'warning' && stopRetryProvider !== null ? (
                        <HmiButton
                            className="ml-3"
                            size="sm"
                            disabled={retryDisabled}
                            onClick={() => { if (stopRetryProvider) void retryStop(stopRetryProvider); }}
                        >
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
                <p>{deleteProvider
                    ? `La credencial protegida de ${PROVIDER_LABELS[deleteProvider]} se eliminará del servicio local. Esta acción no puede deshacerse.`
                    : 'La credencial protegida se eliminará del servicio local. Esta acción no puede deshacerse.'}</p>
            </AdminDialog>
        </section>
    );
}
