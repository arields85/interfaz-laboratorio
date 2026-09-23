import type {
    CredentialAdministrationClient,
    CredentialAdministrationController,
} from '../../hooks/usePrismaCredentialAdministration';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    Check,
    CircleDashed,
    CircleDashedCheck,
    CircleX,
    KeyRound,
    Loader2,
    MessageCircleWarning,
    Play,
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
        TELEGRAM_VERIFICATION_IN_PROGRESS: 'Ya hay una verificación en curso. Espere a que finalice.',
        TELEGRAM_VERIFICATION_UNAVAILABLE: 'La verificación del Canal B no está disponible.',
        PRISMA_CHANNEL_A_VERIFICATION_IN_PROGRESS: 'Ya hay una verificación en curso. Espere a que finalice.',
        PRISMA_CHANNEL_A_VERIFICATION_UNAVAILABLE: 'La verificación del Canal A no está disponible.',
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

// T14 (2026-09-23, coordinator instruction): all three credential rows must
// keep one exact shared input width (unchanged from T11's rationale below),
// now narrower than T11's own w-80 so the row still fits the new grouped
// Save/Delete/Verify buttons plus RESULT_AREA_WIDTH_CLS on one line at the
// settings dialog's normal (>= md) content width. Like T11's original value,
// this is a Tailwind spacing-scale token (a deliberate design-system
// constant, the same permitted category as `p-5`/`gap-2` under the
// anti-hardcode dimensional policy), not a raw pixel measurement or a
// content-dependent estimate; the container-width arithmetic behind this
// specific step is recorded in the T14 tracker entry
// (odd/tasks/prisma-channel-a-corrections.md), not duplicated here, so nothing
// here can go stale if that reasoning is revisited independently of the token.
const CREDENTIAL_INPUT_WIDTH_CLS = 'w-full md:w-44';

// T14: the trailing result area's minimum width, sized for the worst-case
// Telegram bot username. The Telegram Bot API caps usernames at 32
// characters (5-32, https://core.telegram.org/bots/api), displayed here as
// "@" + name = up to 33 characters. `ch` is the width of the font's "0"
// glyph, a reasonable proxy the browser computes from the real font metrics
// (not a guessed pixel value); a CSS min-width is only a floor, so the box
// still grows beyond it for a wider real rendering of those 33 characters,
// never shrinks below it for shorter content, and a maximally long username
// is never truncated. Every row uses the same class so their result areas
// stay the same width (Gemini and short connection states just leave the
// extra space empty). No `truncate`/`overflow-hidden`/`whitespace-nowrap` is
// ever applied to the text inside it: if an even narrower viewport
// disagrees, the row's own `flex-wrap` lets it wrap instead of clipping.
const RESULT_AREA_WIDTH_CLS = 'min-w-[33ch]';

// T14: how long a successful Telegram/Canal A on-demand verification result
// stays visible in the trailing result area before it reverts to the live
// connection state. A failed result (invalid_token/unreachable) never
// reverts automatically -- it stays until the next verify, a save, or a
// delete (which already resets verification on the backend). No pre-existing
// feedback/toast duration constant in the codebase is semantically
// equivalent (PRISMA_ORB_FADE_DURATION_MS and the BOOT_SHIELD_*_MS family
// are animation/boot timings, not a "leave a result on screen" duration), so
// this is a new named constant per the anti-hardcode timing policy.
const VERIFICATION_RESULT_DISPLAY_MS = 5000;

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

// T14: a result glyph extends a plain status glyph with an optional visible
// text part -- the shared shape behind the single trailing result area
// (connection state, on-demand verification result, or the "in flight"
// state), rendered by ResultDisplay below.
interface ResultGlyph extends StatusGlyph {
    text: string | null;
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

// T14: Gemini has no live connection state to return to, so its result area
// always reflects the last verification outcome directly (no revert timer).
function geminiVerificationResult(state: GeminiVerificationState): ResultGlyph {
    if (state === 'verified') return { text: 'Verificado', Icon: Check, label: 'Verificado', tone: 'success' };
    if (state === 'invalid_key') return { text: 'API key inválida', Icon: CircleX, label: 'API key inválida', tone: 'critical' };
    if (state === 'unreachable') {
        return { text: 'Sin conexión con Google', Icon: WifiOff, label: 'Sin conexión con Google', tone: 'warning' };
    }
    return { text: null, Icon: CircleDashedCheck, label: 'Verificación: no realizada', tone: 'muted' };
}

// T14: Telegram/Canal A on-demand token verification result (a non-sending
// getMe check, distinct from the live connection state below). Shown only
// while the row's own `verificationResultVisible` flag is set -- see the
// component body for the show/revert lifecycle.
function telegramTokenVerificationResult(verification: TelegramTokenVerification): ResultGlyph {
    if (verification.state === 'verified') {
        return {
            text: verification.username ? `@${verification.username}` : null,
            Icon: Check,
            label: verification.username ? `Token verificado: @${verification.username}` : 'Token verificado',
            tone: 'success',
        };
    }
    if (verification.state === 'invalid_token') {
        return { text: 'Token inválido', Icon: CircleX, label: 'Token inválido', tone: 'critical' };
    }
    if (verification.state === 'unreachable') {
        return { text: 'Sin conexión con Telegram', Icon: WifiOff, label: 'Sin conexión con Telegram', tone: 'warning' };
    }
    return { text: null, Icon: CircleDashedCheck, label: 'Verificación: no realizada', tone: 'muted' };
}

// Telegram's live connection state, mapped from the existing status fields
// only (running/lastError) -- never from a derived "not running" guess.
// `pending` covers the client-side window while a save (which now
// applies/restarts inline) or a delete (which stops) is in flight, since the
// health payload has no own "connecting" state.
function telegramConnectionResult(telegram: TelegramPassiveHealth | null, pending: boolean): ResultGlyph | null {
    if (!telegram || !telegram.configured) return null;
    if (pending) return { text: 'Conectando…', Icon: Loader2, label: 'Conectando…', tone: 'muted', spin: true };
    if (telegram.lastError) return { text: 'No se pudo conectar el bot', Icon: CircleX, label: 'No se pudo conectar el bot', tone: 'critical' };
    if (telegram.running) {
        return { text: telegram.botUsername ? `@${telegram.botUsername}` : null, Icon: Check, label: 'Bot conectado', tone: 'success' };
    }
    return { text: 'Bot detenido', Icon: MessageCircleWarning, label: 'Bot detenido', tone: 'warning' };
}

// Channel A's live connection state must never infer quiescence from "not
// running": only the canonical lifecycle phase decides between "stopped"
// (confirmed quiescent) and "unconfirmed" (a transitional or broken phase
// whose real state is not known).
function channelAConnectionResult(channelA: ChannelAAdministrationStatus | null, pending: boolean): ResultGlyph | null {
    if (!channelA || !channelA.configured) return null;
    if (pending) return { text: 'Conectando…', Icon: Loader2, label: 'Conectando…', tone: 'muted', spin: true };
    if (channelA.lastError) return { text: 'No se pudo conectar el bot', Icon: CircleX, label: 'No se pudo conectar el bot', tone: 'critical' };
    const phase = channelA.activation?.phase ?? null;
    const restartRequired = channelA.activation?.restartRequired ?? false;
    if (phase === 'running' && !restartRequired) {
        return { text: channelA.botUsername ? `@${channelA.botUsername}` : null, Icon: Check, label: 'Bot conectado', tone: 'success' };
    }
    if (phase === null || phase === 'idle' || phase === 'stopped') {
        return { text: 'Bot detenido', Icon: MessageCircleWarning, label: 'Bot detenido', tone: 'warning' };
    }
    if (phase === 'preparing' || phase === 'prepared' || phase === 'stopping') {
        return { text: 'Conectando…', Icon: Loader2, label: 'Conectando…', tone: 'muted', spin: true };
    }
    // 'failed', 'retired', or a running phase with a pending restart: the
    // real state is not confidently known either way.
    return { text: 'Estado no confirmado', Icon: CircleDashed, label: 'Estado no confirmado', tone: 'muted' };
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

// T14: the single trailing result area for every row (replaces T9b-T13's
// separate verification icon and, for Telegram/Canal A, the separate
// @username + execution icon slots). When `text` is present it renders as
// visible text next to the icon; when absent, the icon alone carries the
// HoverTooltip (the pre-existing icon-only pattern). An identity string
// (an "@username", never a status claim) stays neutral/muted regardless of
// the icon's tone; every other text matches its icon's severity tone.
// RESULT_AREA_WIDTH_CLS keeps every row's result area the same width so the
// three rows line up, and reserves enough room for the longest possible
// Telegram username without truncating (see its own comment above).
function ResultDisplay({ text, Icon, label, tone, spin, testId }: ResultGlyph & { testId: string }) {
    const containerCls = `ml-auto flex items-center gap-1 ${RESULT_AREA_WIDTH_CLS}`;
    if (!text) {
        return (
            <div data-testid={testId} className={containerCls}>
                <StatusIcon Icon={Icon} label={label} tone={tone} spin={spin} />
            </div>
        );
    }
    const isIdentityText = text.startsWith('@');
    return (
        <div data-testid={testId} className={containerCls}>
            <span className={isIdentityText ? 'text-industrial-muted' : STATUS_TONE_CLS[tone]}>{text}</span>
            <span role="img" aria-label={label} className={STATUS_TONE_CLS[tone]}>
                <Icon size={16} className={spin ? 'animate-spin' : undefined} aria-hidden="true" />
            </span>
        </div>
    );
}

// T14: icon-only Verificar button, grouped with Save/Delete (same
// variant/size/styling), immediately to their right. Accessible name is
// "Verificar" (or "Verificando…" while a verification is in flight) via
// aria-label, with a matching HoverTooltip; when no credential is
// configured yet, the button is disabled and its tooltip explains why
// instead.
function VerifyIconButton({
    configured,
    verifying,
    disabled,
    disabledTooltip,
    onVerify,
}: {
    configured: boolean;
    verifying: boolean;
    disabled: boolean;
    disabledTooltip: string;
    onVerify: () => void;
}) {
    if (!configured) {
        return (
            <HoverTooltip label={disabledTooltip} position="top">
                <HmiButton size="sm" variant="secondary" aria-label="Verificar" title="Verificar" disabled>
                    <Play size={14} aria-hidden="true" />
                </HmiButton>
            </HoverTooltip>
        );
    }
    const label = verifying ? 'Verificando…' : 'Verificar';
    return (
        <HoverTooltip label={label} position="top">
            <HmiButton
                size="sm"
                variant="secondary"
                aria-label={label}
                title={label}
                disabled={disabled}
                onClick={onVerify}
            >
                {verifying ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            </HmiButton>
        </HoverTooltip>
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
    // T14: whether each Telegram-family row's result area is currently
    // showing an on-demand verification result instead of the live
    // connection state. Gemini has no live state to fall back to, so it
    // needs no equivalent flag.
    const [verificationResultVisible, setVerificationResultVisible] = useState<Record<'telegram' | 'telegram_channel_a', boolean>>({
        telegram: false,
        telegram_channel_a: false,
    });
    const verificationRevertTimersRef = useRef<Record<'telegram' | 'telegram_channel_a', ReturnType<typeof setTimeout> | null>>({
        telegram: null,
        telegram_channel_a: null,
    });
    const panelGenerationRef = useRef(0);
    const secretRevisionRef = useRef<Record<CredentialProvider, number>>({ gemini: 0, telegram: 0, telegram_channel_a: 0 });
    const dialogRevisionRef = useRef(0);
    const unavailable = Boolean(administration.error);
    const disabled = !authenticated || !administration.data || unavailable || administration.pendingAction !== null;
    const retryDisabled = !authenticated || administration.pendingAction !== null;
    const credentials = administration.data?.credentials;
    const telegram = administration.data?.telegram;
    const stale = unavailable && administration.data !== null;

    const clearVerificationRevertTimer = (provider: 'telegram' | 'telegram_channel_a') => {
        const timer = verificationRevertTimersRef.current[provider];
        if (timer !== null) {
            clearTimeout(timer);
            verificationRevertTimersRef.current[provider] = null;
        }
    };

    // T14: clear any pending revert timer on unmount, so a stale timeout
    // never fires a setState against an unmounted component.
    useEffect(() => () => {
        clearVerificationRevertTimer('telegram');
        clearVerificationRevertTimer('telegram_channel_a');
    }, []);

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

    // T14: a save or a delete resets verification on the backend (T13), so
    // the row's result area must drop back to the live connection state
    // immediately instead of waiting for the refreshed metadata to carry a
    // not_checked state through the still-visible verification result.
    const resetVerificationResultIfTelegramFamily = (provider: CredentialProvider) => {
        if (provider === 'gemini') return;
        clearVerificationRevertTimer(provider);
        setVerificationResultVisible((previous) => ({ ...previous, [provider]: false }));
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
                resetVerificationResultIfTelegramFamily(provider);
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
                resetVerificationResultIfTelegramFamily(provider);
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

    // T13/T14: same non-sending verify action for Telegram and Canal A,
    // dispatched to whichever provider's own endpoint the row belongs to. A
    // successful call (verified/invalid_token/unreachable are all "success"
    // responses, never thrown) switches the row's result area to the
    // verification result; a verified result schedules the revert back to
    // the live connection state after VERIFICATION_RESULT_DISPLAY_MS, while
    // invalid_token/unreachable persist until the next verify, save, or
    // delete. Re-verifying always clears a still-pending revert timer first.
    const verifyTelegramFamily = async (provider: 'telegram' | 'telegram_channel_a') => {
        const panelGeneration = panelGenerationRef.current;
        setFeedback(null);
        clearVerificationRevertTimer(provider);
        try {
            const result = await (provider === 'telegram_channel_a' ? administration.verifyChannelA() : administration.verifyTelegram());
            if (panelGenerationRef.current !== panelGeneration) return;
            setVerificationResultVisible((previous) => ({ ...previous, [provider]: true }));
            if (result.verification.state === 'verified') {
                verificationRevertTimersRef.current[provider] = setTimeout(() => {
                    verificationRevertTimersRef.current[provider] = null;
                    if (panelGenerationRef.current !== panelGeneration) return;
                    setVerificationResultVisible((previous) => ({ ...previous, [provider]: false }));
                }, VERIFICATION_RESULT_DISPLAY_MS);
            }
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
    // input, a credential-status icon, Save, Delete, Verificar (T14:
    // icon-only, grouped with Save/Delete) and -- right-aligned -- the
    // single result area (T14: replaces the separate verification icon).
    const renderGeminiProvider = () => {
        const value = secretDrafts.gemini;
        const gemini = credentials?.gemini;
        const geminiConfigured = gemini?.configured;
        const verifying = administration.pendingAction === 'verify-gemini';
        const credentialGlyph = geminiConfigured === undefined ? null : credentialConfiguredGlyph(geminiConfigured);
        const showsMask = value === '' && geminiConfigured === true;
        const resultGlyph: ResultGlyph | null = gemini
            ? (verifying
                ? { text: 'Verificando…', Icon: Loader2, label: 'Verificando…', tone: 'muted', spin: true }
                : geminiVerificationResult(gemini.verification.state))
            : null;

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
                        <VerifyIconButton
                            configured={gemini.configured}
                            verifying={verifying}
                            disabled={disabled}
                            disabledTooltip="Configure una API key para verificarla."
                            onVerify={() => void verifyGemini()}
                        />
                    ) : null}
                    {resultGlyph ? <ResultDisplay {...resultGlyph} testId="gemini-verification-result" /> : null}
                </div>
            </CredentialFieldset>
        );
    };

    // Telegram (channel B) and Canal A share the exact Gemini-approved row
    // design (T10/T14): masked input, credential icon, Save, Delete,
    // Verificar (icon-only, grouped) and -- right-aligned -- one combined
    // result area that shows the live connection state by default and the
    // on-demand token verification result after Verificar is clicked (T14).
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
        const runtimeErrorCode = isChannelA
            ? channelA?.lastError ?? null
            : (telegram?.lastError ?? telegram?.configurationError ?? null);
        // T13/T14: on-demand token verification, independent of the live
        // connection state (that reads live connectivity; this re-checks the
        // stored token itself). Same pending-action/disabled/tooltip pattern
        // as Gemini's Verificar.
        const verifyAction = isChannelA ? 'verify-channel-a' : 'verify-telegram';
        const verifying = administration.pendingAction === verifyAction;
        const verification = credentials?.[provider].verification ?? null;
        const showingVerificationResult = verificationResultVisible[provider] && verification !== null;
        const resultGlyph: ResultGlyph | null = verifying
            ? { text: 'Verificando…', Icon: Loader2, label: 'Verificando…', tone: 'muted', spin: true }
            : showingVerificationResult
                ? telegramTokenVerificationResult(verification)
                : (isChannelA ? channelAConnectionResult(channelA, pending) : telegramConnectionResult(telegram ?? null, pending));

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
                    <VerifyIconButton
                        configured={Boolean(providerConfigured)}
                        verifying={verifying}
                        disabled={providerDisabled}
                        disabledTooltip="Configure un token para verificarlo."
                        onVerify={() => void verifyTelegramFamily(provider)}
                    />
                    {resultGlyph ? <ResultDisplay {...resultGlyph} testId={`${provider}-verification-result`} /> : null}
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
