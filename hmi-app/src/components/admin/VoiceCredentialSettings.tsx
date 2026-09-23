import type {
    CredentialAdministrationClient,
    CredentialAdministrationController,
} from '../../hooks/usePrismaCredentialAdministration';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    Check,
    CircleDashed,
    CircleX,
    KeyRound,
    Loader2,
    MessageCircleDashedCheck,
    MessageCircleWarning,
    RefreshCw,
    Save,
    Trash2,
    WifiOff,
    type LucideIcon,
} from 'lucide-react';

import type {
    ChannelAAdministrationStatus,
    CredentialProvider,
    GeminiVerificationState,
    TelegramPassiveHealth,
    TelegramTokenVerification,
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

// Single presentation mapping for the credential providers, used only by the
// stop-unconfirmed retry feedback message (the deletion confirmation dialog
// has its own explicit per-provider text below, and the fieldset's own
// accessible group name is set per-row, e.g. Channel A's is "Canal A").
// T11 (2026-09-23): renamed to match the rows' own current names -- Telegram
// (channel B) is now "Canal B", Channel A dropped the "Telegram (...)"
// prefix, and Gemini reads as its row's own "proveedor de voz" title.
const PROVIDER_LABELS: Record<CredentialProvider, string> = {
    gemini: 'proveedor de voz',
    telegram: 'Canal B',
    telegram_channel_a: 'Canal A',
};

// T11 (2026-09-23): explicit per-provider deletion-confirmation copy,
// replacing label interpolation so each provider's exact wording is reviewed
// and changed independently of PROVIDER_LABELS' own (differently-cased,
// differently-worded) usage elsewhere.
const DELETE_CONFIRMATION_TEXT: Record<CredentialProvider, string> = {
    telegram_channel_a: 'La credencial protegida de Canal A se eliminará del servicio local. Esta acción no puede deshacerse.',
    telegram: 'La credencial protegida de Canal B se eliminará del servicio local. Esta acción no puede deshacerse.',
    gemini: 'La credencial protegida del proveedor de voz se eliminará del servicio local. Esta acción no puede deshacerse.',
};

// T11 (2026-09-23, user decision): all three credential rows must share the
// exact same fixed input width, regardless of each row's own trailing content
// (Verificar + its icon, @username, an execution icon) -- previously each
// input was `flex-1` and grew to fill whatever space its own row's trailing
// content left, so widths differed between rows and shifted as that content
// appeared or disappeared. This is a Tailwind spacing-scale token (a
// deliberate design-system constant), not a raw pixel measurement or a
// content-dependent estimate, so it does not violate the anti-hardcode
// dimensional policy; full width is kept only below the `md` breakpoint.
const CREDENTIAL_INPUT_WIDTH_CLS = 'w-full md:w-80';

// T11 (2026-09-23): Canal B (Telegram) row description, user-approved copy.
const CHANNEL_B_DESCRIPTION = 'Consultas a distancia por Telegram: Prisma responde por mensaje, sin necesidad de mirar la interfaz.';

function emptySecretDrafts(): Record<CredentialProvider, string> {
    return { gemini: '', telegram: '', telegram_channel_a: '' };
}

// Gemini's save never applies or verifies (that stays an explicit, separate
// action); Telegram and Canal A saves apply on the backend in the same
// request (T10), so their success message must not claim otherwise.
const SAVE_SUCCESS_TEXT: Record<CredentialProvider, string> = {
    gemini: 'Credencial guardada. No se aplicaron cambios al proveedor.',
    telegram: 'Credencial guardada y aplicada.',
    telegram_channel_a: 'Credencial guardada y aplicada.',
};

// Fixed, non-secret placeholder: the real key is never sent to the browser
// (metadata-only by design), so this mask must never be derived from it.
// Rendered as the input's `placeholder`, not its `value`: a placeholder never
// merges with typed characters (the browser swaps it out on the first
// keystroke instead of splicing into it), and screen readers announce it as
// hint text on an empty field rather than as a value -- the field is
// correctly reported as blank, not as already holding 12 known characters.
// Shared by every credential row (Gemini, Telegram, Canal A).
const CREDENTIAL_KEY_MASK = '•'.repeat(12);

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
    spin?: boolean;
}

// Credential-presence icon shared by every row (Gemini, Telegram, Canal A):
// the label doubles as the icon's accessible name (role="img" + aria-label)
// and its HoverTooltip text -- the same icon-only + tooltip pattern T6
// established for the Save/Delete buttons. The not-configured state reads as
// a caution (MessageCircleWarning / warning token), not a hard failure.
function credentialConfiguredGlyph(configured: boolean): StatusGlyph {
    return configured
        ? { Icon: Check, label: 'Credencial configurada', tone: 'success' }
        : { Icon: MessageCircleWarning, label: 'Credencial no configurada', tone: 'warning' };
}

function geminiVerificationGlyph(state: GeminiVerificationState): StatusGlyph {
    if (state === 'verified') return { Icon: Check, label: 'Verificada', tone: 'success' };
    if (state === 'invalid_key') return { Icon: CircleX, label: 'API key inválida', tone: 'critical' };
    if (state === 'unreachable') {
        return { Icon: WifiOff, label: 'No se pudo verificar: sin conexión con Google', tone: 'warning' };
    }
    return { Icon: MessageCircleDashedCheck, label: 'Verificación: no realizada', tone: 'muted' };
}

// T13: Telegram/Canal A on-demand token verification (a non-sending getMe
// check, distinct from the execution icon's connectivity read). The verified
// tooltip carries the observed @username so a stale/never-connected row can
// still confirm which bot the token belongs to.
function telegramTokenVerificationGlyph(verification: TelegramTokenVerification): StatusGlyph {
    if (verification.state === 'verified') {
        return {
            Icon: Check,
            label: verification.username ? `Token verificado: @${verification.username}` : 'Token verificado',
            tone: 'success',
        };
    }
    if (verification.state === 'invalid_token') return { Icon: CircleX, label: 'Token inválido', tone: 'critical' };
    if (verification.state === 'unreachable') {
        return { Icon: WifiOff, label: 'No se pudo verificar: sin conexión con Telegram', tone: 'warning' };
    }
    return { Icon: MessageCircleDashedCheck, label: 'Verificación: no realizada', tone: 'muted' };
}

// Telegram/Canal A execution status, mapped from the existing status fields
// only (Telegram: running/restartRequired/lastError; Channel A:
// activation.phase/restartRequired/lastError) -- never from a derived
// "not running" guess. `pending` covers the client-side window while a
// save (which now applies/restarts inline) or a delete (which stops) is
// in flight, since neither health payload has its own "connecting" state.
// `restartRequired` is not read here: T10 makes save apply immediately, so a
// genuinely running bot reported by health is the freshly applied one; a
// stale desired/applied mismatch (legacy source, startup race) still leaves
// a real, currently-answering bot, which "Bot conectado" honestly reports --
// unlike Channel A, Telegram's health has no extra transitional phase to
// fall back to for this case.
function telegramExecutionGlyph(telegram: TelegramPassiveHealth | null, pending: boolean): StatusGlyph | null {
    if (!telegram || !telegram.configured) return null;
    if (pending) return { Icon: Loader2, label: 'Conectando…', tone: 'muted', spin: true };
    if (telegram.lastError) return { Icon: CircleX, label: 'No se pudo conectar el bot', tone: 'critical' };
    if (telegram.running) return { Icon: Check, label: 'Bot conectado', tone: 'success' };
    return { Icon: MessageCircleWarning, label: 'Bot detenido', tone: 'warning' };
}

// Channel A execution status must never infer quiescence from "not running":
// only the canonical lifecycle phase decides between "stopped" (confirmed
// quiescent) and "unconfirmed" (a transitional or broken phase whose real
// state is not known).
function channelAExecutionGlyph(channelA: ChannelAAdministrationStatus | null, pending: boolean): StatusGlyph | null {
    if (!channelA || !channelA.configured) return null;
    if (pending) return { Icon: Loader2, label: 'Conectando…', tone: 'muted', spin: true };
    if (channelA.lastError) return { Icon: CircleX, label: 'No se pudo conectar el bot', tone: 'critical' };
    const phase = channelA.activation?.phase ?? null;
    const restartRequired = channelA.activation?.restartRequired ?? false;
    if (phase === 'running' && !restartRequired) return { Icon: Check, label: 'Bot conectado', tone: 'success' };
    if (phase === null || phase === 'idle' || phase === 'stopped') {
        return { Icon: MessageCircleWarning, label: 'Bot detenido', tone: 'warning' };
    }
    if (phase === 'preparing' || phase === 'prepared' || phase === 'stopping') {
        return { Icon: Loader2, label: 'Conectando…', tone: 'muted', spin: true };
    }
    // 'failed', 'retired', or a running phase with a pending restart: the
    // real state is not confidently known either way.
    return { Icon: CircleDashed, label: 'Estado del bot no confirmado', tone: 'muted' };
}

function StatusIcon({ Icon, label, tone, spin }: StatusGlyph) {
    return (
        <HoverTooltip label={label} position="top">
            <span role="img" aria-label={label} className={STATUS_TONE_CLS[tone]}>
                <Icon size={16} className={spin ? 'animate-spin' : undefined} aria-hidden="true" />
            </span>
        </HoverTooltip>
    );
}

// T9d: "Verificar" and "Verificando…" stack in the same CSS grid cell instead
// of swapping in place, so the button's intrinsic width is always the wider
// label's width -- no hardcoded pixel width, no runtime measurement, just the
// browser sizing the grid cell to its content (anti-hardcode dimensional
// policy). The inactive label is `invisible` (keeps its layout box, so the
// grid cell doesn't collapse) and `aria-hidden` (excluded from the button's
// accessible name, which stays exactly the active label).
function VerifyButtonLabel({ verifying }: { verifying: boolean }) {
    return (
        <span className="grid">
            <span className={`[grid-area:1/1] ${verifying ? 'invisible' : ''}`} aria-hidden={verifying}>
                Verificar
            </span>
            <span className={`[grid-area:1/1] ${verifying ? '' : 'invisible'}`} aria-hidden={!verifying}>
                Verificando…
            </span>
        </span>
    );
}

// Shared block-fieldset shell for every provider row (Gemini, Telegram,
// Canal A): a plain block fieldset (not flex) with a floated full-width
// legend + clearing div. A native <legend> is laid out through its own
// special "straddle the top border" algorithm, independent of the
// fieldset's own display/flex-direction, so a flex-column fieldset can't
// move it on its own; floating it full-width takes it out of that notch
// algorithm entirely -- it renders as an ordinary block inside the border
// instead -- and the following clearing div guarantees the row content
// below never tries to wrap beside it.
function CredentialFieldset({
    legend,
    groupLabel = legend,
    description,
    children,
}: {
    legend: string;
    groupLabel?: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <fieldset aria-label={groupLabel} className="rounded border border-white/10 p-3">
            <legend className="float-left mb-3 w-full px-0 text-industrial-text">{legend}</legend>
            <div className="clear-both" />
            <div className="flex flex-col gap-2">
                {/* T11 (2026-09-23): extra bottom margin (beyond the shared
                    gap-2) between the description and the field label below
                    it, matching the legend's own mb-3 spacing above. */}
                {description ? <p className="mb-3 text-industrial-muted">{description}</p> : null}
                {children}
            </div>
        </fieldset>
    );
}

// Runtime error detail, shown below a Telegram/Canal A row's credential row
// when the manager has a specific sanitized code for it. Distinct from the
// execution icon's short generic tooltip (never raw provider text): this
// paragraph carries the more specific safe guidance text.
function RuntimeErrorNotice({ code }: { code: string | null }) {
    if (!code) return null;
    return <p className="text-status-warning">{errorText(new AdminAuthError(code, null))}</p>;
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
                setFeedback({ kind: 'success', text: SAVE_SUCCESS_TEXT[provider] });
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

    // T13: same non-sending verify action for Telegram and Canal A, dispatched
    // to whichever provider's own endpoint the row belongs to.
    const verifyTelegramFamily = async (provider: 'telegram' | 'telegram_channel_a') => {
        const panelGeneration = panelGenerationRef.current;
        setFeedback(null);
        try {
            await (provider === 'telegram_channel_a' ? administration.verifyChannelA() : administration.verifyTelegram());
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

    // Gemini keeps its own single-row layout (T9b/T9c/T9d, approved and
    // unchanged by T10): title and "API Key" label above one row holding the
    // input, a credential-status icon, Save, Delete, and -- right-aligned --
    // Verificar with its own result icon.
    const renderGeminiProvider = () => {
        const value = secretDrafts.gemini;
        const gemini = credentials?.gemini;
        const geminiConfigured = gemini?.configured;
        const verifying = administration.pendingAction === 'verify-gemini';
        const credentialGlyph = geminiConfigured === undefined ? null : credentialConfiguredGlyph(geminiConfigured);
        const showsMask = value === '' && geminiConfigured === true;

        return (
            <CredentialFieldset legend="Proveedor de voz">
                <label htmlFor="gemini-api-key-input" className="text-industrial-muted">API Key de Gemini</label>
                <div data-testid="gemini-credential-row" className="flex flex-wrap items-center gap-2">
                    <input
                        id="gemini-api-key-input"
                        // Not type="password": Chrome ignores autocomplete="off" on a
                        // password input and offers to generate/save one regardless
                        // (autocomplete="new-password" makes it worse, actively inviting
                        // generation). A plain text input masked with CSS
                        // (-webkit-text-security, .hmi-masked-text) sidesteps Chrome's
                        // password-manager heuristics entirely; the data-* attributes
                        // below opt out third-party managers (1Password, LastPass) too.
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-form-type="other"
                        value={value}
                        placeholder={showsMask ? CREDENTIAL_KEY_MASK : undefined}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            secretRevisionRef.current.gemini += 1;
                            setProviderDraft('gemini', nextValue);
                        }}
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} hmi-masked-text ${CREDENTIAL_INPUT_WIDTH_CLS}`}
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
                            variant="secondary"
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
                            {gemini.configured ? (
                                <HmiButton
                                    size="sm"
                                    variant="secondary"
                                    disabled={disabled}
                                    onClick={() => void verifyGemini()}
                                >
                                    <VerifyButtonLabel verifying={verifying} />
                                </HmiButton>
                            ) : (
                                <HoverTooltip label="Configure una API key para verificarla." position="top">
                                    <HmiButton size="sm" variant="secondary" disabled>
                                        <VerifyButtonLabel verifying={false} />
                                    </HmiButton>
                                </HoverTooltip>
                            )}
                            {verifying ? (
                                <StatusIcon Icon={Loader2} label="Verificando…" tone="muted" spin />
                            ) : (
                                <StatusIcon {...geminiVerificationGlyph(gemini.verification.state)} />
                            )}
                        </div>
                    ) : null}
                </div>
            </CredentialFieldset>
        );
    };

    // Telegram (channel B) and Canal A share the exact Gemini-approved row
    // design (T10): masked input, credential icon, Save, Delete (secondary,
    // never the red danger variant) and, right-aligned: the connected bot's
    // @username when known, one execution status icon (live connectivity),
    // then Verificar and its own verification icon (T13: an on-demand,
    // non-sending re-check of the stored token itself) -- in that order, so
    // "what's happening now" reads before "check the token on demand",
    // matching Gemini's own Verificar-then-icon tail.
    const renderTelegramFamilyProvider = (provider: 'telegram' | 'telegram_channel_a') => {
        const isChannelA = provider === 'telegram_channel_a';
        const value = secretDrafts[provider];
        const inputId = `${provider}-credential-input`;
        const providerConfigured = credentials?.[provider].configured;
        const channelA = isChannelA ? administration.channelA : null;
        // A channel A status failure disables only that channel's controls;
        // Gemini and Telegram keep working from their own metadata.
        const channelAUnavailable = isChannelA && Boolean(administration.channelAError);
        const providerDisabled = disabled || channelAUnavailable;
        const showsMask = value === '' && providerConfigured === true;
        const credentialGlyph = providerConfigured === undefined ? null : credentialConfiguredGlyph(providerConfigured);
        const pending = administration.pendingAction === `save-${provider}` || administration.pendingAction === `delete-${provider}`;
        const executionGlyph = isChannelA
            ? channelAExecutionGlyph(channelA, pending)
            : telegramExecutionGlyph(telegram ?? null, pending);
        const botUsername = isChannelA ? channelA?.botUsername ?? null : telegram?.botUsername ?? null;
        const runtimeErrorCode = isChannelA
            ? channelA?.lastError ?? null
            : (telegram?.lastError ?? telegram?.configurationError ?? null);
        // T13: on-demand token verification, independent of the execution
        // icon above (that reads live connectivity; this re-checks the
        // stored token itself). Same pending-action/disabled/tooltip pattern
        // as Gemini's Verificar.
        const verifyAction = isChannelA ? 'verify-channel-a' : 'verify-telegram';
        const verifying = administration.pendingAction === verifyAction;
        const verification = credentials?.[provider].verification ?? null;

        return (
            <CredentialFieldset
                legend={isChannelA ? 'Canal A' : 'Canal B'}
                description={isChannelA
                    ? 'Canal privado de Telegram: se vincula con un QR y Prisma responde consultas sobre la interfaz.'
                    : CHANNEL_B_DESCRIPTION}
            >
                <label htmlFor={inputId} className="text-industrial-muted">Telegram bot API Token</label>
                <div data-testid={`${provider}-credential-row`} className="flex flex-wrap items-center gap-2">
                    <input
                        id={inputId}
                        // Same Chrome password-manager workaround as Gemini's field
                        // (see its comment): a plain text input masked with CSS
                        // instead of type="password".
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-form-type="other"
                        value={value}
                        placeholder={showsMask ? CREDENTIAL_KEY_MASK : undefined}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            secretRevisionRef.current[provider] += 1;
                            setProviderDraft(provider, nextValue);
                        }}
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} hmi-masked-text ${CREDENTIAL_INPUT_WIDTH_CLS}`}
                        disabled={providerDisabled}
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
                            disabled={providerDisabled || !value}
                            onClick={() => void save(provider)}
                        >
                            <Save size={14} aria-hidden="true" />
                        </HmiButton>
                    </HoverTooltip>
                    <HoverTooltip label="Eliminar credencial" position="top">
                        <HmiButton
                            size="sm"
                            variant="secondary"
                            aria-label="Eliminar credencial"
                            title="Eliminar credencial"
                            disabled={providerDisabled}
                            onClick={() => updateDeleteProvider(provider)}
                        >
                            <Trash2 size={14} aria-hidden="true" />
                        </HmiButton>
                    </HoverTooltip>
                    <div className="ml-auto flex items-center gap-2">
                        {botUsername ? <span className="text-industrial-muted">@{botUsername}</span> : null}
                        {executionGlyph ? <StatusIcon {...executionGlyph} /> : null}
                        {providerConfigured ? (
                            <HmiButton
                                size="sm"
                                variant="secondary"
                                disabled={providerDisabled}
                                onClick={() => void verifyTelegramFamily(provider)}
                            >
                                <VerifyButtonLabel verifying={verifying} />
                            </HmiButton>
                        ) : (
                            <HoverTooltip label="Configure un token para verificarlo." position="top">
                                <HmiButton size="sm" variant="secondary" disabled>
                                    <VerifyButtonLabel verifying={false} />
                                </HmiButton>
                            </HoverTooltip>
                        )}
                        {verifying ? (
                            <StatusIcon Icon={Loader2} label="Verificando…" tone="muted" spin />
                        ) : verification ? (
                            <StatusIcon {...telegramTokenVerificationGlyph(verification)} />
                        ) : null}
                    </div>
                </div>
                <RuntimeErrorNotice code={runtimeErrorCode} />
                {isChannelA && administration.channelAError ? (
                    <>
                        {channelA ? (
                            <p className="text-status-warning">Último estado conocido; la actualización falló.</p>
                        ) : null}
                        <p className="text-status-warning">{errorText(administration.channelAError)}</p>
                    </>
                ) : null}
            </CredentialFieldset>
        );
    };

    return (
        <section className="rounded-lg border border-white/10 bg-black/10 p-4">
            <h3 className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                <KeyRound size={14} aria-hidden="true" />
                Credenciales de proveedores
            </h3>
            {administration.isLoading ? <p className="text-industrial-muted">Cargando metadatos protegidos...</p> : null}
            {administration.error ? <p role="alert" className="mb-3 text-status-critical">{errorText(administration.error)}</p> : null}
            {stale ? <p className="mb-3 text-status-warning">Último estado conocido; la actualización falló.</p> : null}
            {/* No manual refresh control: administration.refresh() still runs
                automatically after every save/delete/verify (inside the hook),
                which is what keeps this metadata current. */}
            {/* T11 (2026-09-23, user decision): Canal A above Canal B. */}
            <div className="mt-3 flex flex-col gap-3">
                {renderGeminiProvider()}
                {renderTelegramFamilyProvider('telegram_channel_a')}
                {renderTelegramFamilyProvider('telegram')}
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
                    ? DELETE_CONFIRMATION_TEXT[deleteProvider]
                    : 'La credencial protegida se eliminará del servicio local. Esta acción no puede deshacerse.'}</p>
            </AdminDialog>
        </section>
    );
}
