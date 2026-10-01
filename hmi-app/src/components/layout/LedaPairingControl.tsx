import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Pyramid } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ModalBackdrop from '../ui/ModalBackdrop';
import { HmiButton } from '../ui';
import LedaOrb from '../LedaOrb';
import { useChannelAPairing, type ChannelAPairingPhase } from '../../hooks/useChannelAPairing';
import { readHmiName } from '../../services/hmiName.service';
import type { HmiNameReadResult } from '../../domain/hmiName';
import type { ChannelARuntimeUnreachableDetail } from '../../domain/channelAPairing.types';
import { readLedaOrbVisualConfig } from '../../config/ledaOrb.config';
import type { LedaOrbVisualConfig } from '../../domain/voice.types';
import { TOPBAR_ICON_BUTTON_CLS } from './topbarIconButtonStyles';
// T20b: reuse of the HMI orb overlay's own entry duration and animation classes — single
// source of truth for the exact same "invisible thinking scale -> visible" look, instead of a
// copy-pasted literal in this file.
import { LEDA_ORB_ENTRY_DURATION_MS } from '../../hooks/useLedaOrbPresentation';
import {
    LEDA_ORB_ENTERING_CLASSES,
    LEDA_ORB_TRANSITION_CLASSNAME,
    LEDA_ORB_VISIBLE_CLASSES,
} from '../LedaOrbOverlay';
import { useDoubleRafFlip } from '../../hooks/useDoubleRafFlip';

const DIALOG_LABEL = 'Vincular teléfono con Leda';
const MISSING_NAME_COPY = 'Configure el nombre de esta HMI en Configuración general → Leda antes de vincular un teléfono.';
const READ_FAILURE_COPY = 'No se pudo leer el nombre guardado.';
const READ_FAILURE_DIRECTION_COPY = 'Revise el nombre de esta HMI en Configuración general → Leda.';
const QR_IMAGE_LABEL = 'Código QR para vincular Telegram';
const TRIGGER_LABEL = 'Leda';
const CLOSE_LABEL = 'Cerrar';
// Distinct from 'unavailable' (the runtime answered "Canal A no disponible"): this is shown
// only when the Leda runtime itself could not be reached at all.
const RUNTIME_UNREACHABLE_COPY = 'Leda no se pudo iniciar.';
const RUNTIME_UNREACHABLE_HINT_COPY = 'Reinicie el lanzador para volver a intentarlo.';

// T4b: when the launcher detected the specific reason (currently only a busy port), name it
// instead of the generic copy above. The port always comes from the detected data, never a
// literal. Formal "usted" register per the current copy decision for new strings.
function runtimeUnreachableCopy(detail: ChannelARuntimeUnreachableDetail | null): string {
    if (detail?.reason === 'port_in_use') {
        return `Leda no se pudo iniciar: el puerto ${detail.port} está en uso por otro programa.`;
    }
    return RUNTIME_UNREACHABLE_COPY;
}

// High-contrast QR built from existing theme tokens, inverted for scanner legibility: the
// quiet zone and background take the near-white text token and the modules take the near-black
// background token. CSS variables are valid SVG fill values, so dynamic theming keeps working.
const QR_BG_COLOR = 'var(--color-industrial-text)';
const QR_FG_COLOR = 'var(--color-industrial-bg)';

// T20: the QR, the awaiting-confirmation orb and the linked orb all occupy the SAME fixed
// square slot so the modal never shifts layout across those three states. Derived from the
// QR's own rendered size (the qrcode.react `size` prop below) plus its padding, instead of an
// independent constant.
const QR_SIZE_PX = 256;
// T20b: this constant is now the SINGLE source for the slot's padding — applied as an inline
// style (below) instead of a `p-3` Tailwind class, so it cannot drift out of sync with the size
// math the way a hand-kept-in-sync `p-3`/12px pair could (same "JS constant -> inline style"
// convention LedaOrbOverlay.tsx already uses for its own duration, since Tailwind's static
// class scanner cannot read a JS value).
const QR_SLOT_PADDING_PX = 12;
const PAIRING_VISUAL_SLOT_SIZE_PX = QR_SIZE_PX + QR_SLOT_PADDING_PX * 2;
// Applied to BOTH the panel (so its own width calc below can reference the same variable, and so
// it cascades down to the slot for real browser layout) and the slot itself (redundant in a real
// browser thanks to inheritance, but jsdom's tests read this exact inline attribute directly via
// `style.getPropertyValue`, not computed/inherited style — see LedaPairingControl.test.tsx's
// 'keeps the identical fixed visual-slot size...' test). Both reads still resolve to this one
// object/constant, so there is still exactly one source of truth for the slot size.
const PAIRING_VISUAL_SLOT_STYLE = {
    '--pairing-visual-slot-size': `${PAIRING_VISUAL_SLOT_SIZE_PX}px`,
} as CSSProperties;
const PAIRING_VISUAL_SLOT_PADDING_STYLE: CSSProperties = {
    padding: `${QR_SLOT_PADDING_PX}px`,
};
const PAIRING_VISUAL_SLOT_FULL_STYLE: CSSProperties = {
    ...PAIRING_VISUAL_SLOT_STYLE,
    ...PAIRING_VISUAL_SLOT_PADDING_STYLE,
};
// T20b: `mx-auto` self-centers the slot regardless of the panel's own cross-axis alignment (the
// panel's flex column never set `items-center`, so a fixed-width child defaults to the start of
// the cross axis instead of centering itself) — see PANEL_WIDTH_CLS below for the matching width
// fix.
const PAIRING_VISUAL_SLOT_CLS = 'mx-auto flex size-[var(--pairing-visual-slot-size)] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-industrial-surface';

// T20b regression fix (user screenshot, 2026-09-24): the previous `w-72` (288px) panel minus its
// `p-4` (32px) padding left only a 256px content box — 24px narrower than the 280px fixed visual
// slot above, so the slot (and whatever filled it) bled past the panel's right edge. Rather than
// pick another fixed width by hand (which would silently reopen the same overflow if QR_SIZE_PX
// ever changes), the width is DERIVED from the same `--pairing-visual-slot-size` variable via a
// static (not JS-interpolated — Tailwind's scanner needs literal text) `calc()`: the slot size
// plus the panel's own `p-4` horizontal padding, expressed via Tailwind v4's actual `--spacing`
// theme token (`p-4` compiles to `padding: calc(var(--spacing) * 4)`, confirmed against the
// compiled CSS — `--spacing: 0.25rem` in index.css's `@theme`; both sides = `var(--spacing) * 8`)
// instead of a hardcoded `2rem`, so a change to the design system's base spacing scale is picked
// up automatically. The `+2px` covers the panel's own `border` utility (1px/side under
// `box-sizing: border-box`, Tailwind preflight) — omitting it left a real ~1-2px overflow,
// verified with a headless-Chrome geometry probe (`getBoundingClientRect`) before this term was
// added. An exact fit; PAIRING_VISUAL_SLOT_CLS's `mx-auto` centers the slot inside it.
const PANEL_WIDTH_CLS = 'w-[calc(var(--pairing-visual-slot-size)+var(--spacing)*8+2px)]';

// T20: how long the "Teléfono vinculado" state stays visible before the modal auto-closes.
const PAIRING_LINKED_AUTO_CLOSE_MS = 3000;
// T20b: fade duration for the modal+backdrop opacity transition — applied as an inline
// `transitionDuration` style (below) instead of a Tailwind `duration-300` class, so the actual
// close timer (`setTimeout(close, PAIRING_FADE_DURATION_MS)`) and the rendered CSS transition
// duration can never drift out of sync (same "JS constant -> inline style" convention
// LedaOrbOverlay.tsx uses for its own durations). `motion-reduce:transition-none` clears the
// transition itself under prefers-reduced-motion, so the opacity jumps instantly there — the
// close still happens after this same delay, it is just invisible instead of animated.
const PAIRING_FADE_DURATION_MS = 300;
const PAIRING_FADE_TRANSITION_CLS = 'transition-opacity ease-out motion-reduce:transition-none motion-reduce:duration-0';
const PAIRING_FADE_STYLE: CSSProperties = { transitionDuration: `${PAIRING_FADE_DURATION_MS}ms` };

// T20b: the orb's own entry animation inside the modal, mirroring LedaOrbOverlay.tsx's
// LedaOrbOverlayVisible (T17/T17b) — invisible at the thinking scale, then interpolating
// opacity and size in. Reuses the imported LEDA_ORB_ENTERING_CLASSES/LEDA_ORB_VISIBLE_CLASSES/
// LEDA_ORB_TRANSITION_CLASSNAME (single source of truth, no copy-pasted literals) plus the
// motion-reduce suffix LedaOrbOverlay.tsx appends inline at its own call site.
const PAIRING_ORB_TRANSITION_CLS = `${LEDA_ORB_TRANSITION_CLASSNAME} ease-out motion-reduce:transition-none motion-reduce:duration-0`;

// T20b: mounts fresh only when the orb branch below first renders (QR/blocked -> pending/linked),
// same lifecycle reasoning as T17b's LedaOrbOverlayVisible — one frame paints the invisible
// "entering" look, then a double `requestAnimationFrame` (via the shared `useDoubleRafFlip` hook)
// flips to the visible look on the next paint, giving the CSS transition a real "from" state
// instead of popping in. Passing a constant `true` reproduces a mount-only flip (this component
// only ever mounts at the moment its own entry animation should start).
function PairingOrbVisual({ config }: { config: LedaOrbVisualConfig }) {
    const entered = useDoubleRafFlip(true);

    return (
        <div
            className={`size-full ${PAIRING_ORB_TRANSITION_CLS} ${entered ? LEDA_ORB_VISIBLE_CLASSES : LEDA_ORB_ENTERING_CLASSES}`}
            style={{ transitionDuration: `${LEDA_ORB_ENTRY_DURATION_MS}ms` }}
        >
            <LedaOrb config={config} className="size-full" />
        </div>
    );
}

function pairingStatusCopy(phase: ChannelAPairingPhase, unreachableDetail: ChannelARuntimeUnreachableDetail | null): string {
    switch (phase) {
        case 'pending':
            return 'Confirme el destino en Telegram.';
        case 'linked':
            return 'Teléfono vinculado';
        case 'unavailable':
            return 'Canal A no disponible';
        case 'loading':
            return 'Consultando el estado del emparejamiento...';
        case 'error':
            return 'No se pudo obtener el estado del emparejamiento.';
        case 'unreachable':
            return runtimeUnreachableCopy(unreachableDetail);
        case 'free':
            return 'Generando código QR...';
        case 'closed':
            return '';
    }
}

// The control owns the trigger button, its open state and the shared ModalBackdrop primitive
// itself — never via props — with local state only. The pairing hook drives the ephemeral
// panel content. Nothing here writes to the plant or persists state: this is read-only pairing
// observation with manual open/close.
export default function LedaPairingControl() {
    const [open, setOpen] = useState(false);
    // Result of the latest name read, refreshed on every panel open (never cached across
    // openings and never re-read while closed). `null` means the panel was never opened yet.
    const [nameRead, setNameRead] = useState<HmiNameReadResult | null>(null);
    // T20: the orb's visual settings, read alongside the name on every open (same lifecycle),
    // so a later admin edit of the orb appearance is reflected on the next pairing open.
    const [visualConfig, setVisualConfig] = useState<LedaOrbVisualConfig | null>(null);
    // T20: true only while the linked-state auto-close fade is playing; drives the opacity
    // classes on both the backdrop and the panel so they fade out together.
    const [closing, setClosing] = useState(false);

    // The pairing hook only observes while the panel is open AND a valid configured name was
    // read; a stale or mocked hook result can never leak a QR past this gate.
    const nameGateOk = nameRead !== null && nameRead.ok && nameRead.name !== null;
    const hookOpen = open && nameGateOk;
    const { phase, qr, remainingSeconds, unreachableDetail } = useChannelAPairing(hookOpen);

    const close = useCallback(() => {
        setOpen(false);
        setClosing(false);
    }, []);
    const showQr = hookOpen && phase === 'free' && qr !== null && remainingSeconds > 0;
    const showPendingOrb = hookOpen && phase === 'pending';
    const showLinkedOrb = hookOpen && phase === 'linked';

    // Read the saved name and the orb visual config in the trigger handler before opening
    // state, so each opening shows the current configuration without a setState-in-effect read
    // cycle.
    const togglePanel = () => {
        if (open) {
            close();
            return;
        }
        setNameRead(readHmiName());
        setVisualConfig(readLedaOrbVisualConfig());
        setClosing(false);
        setOpen(true);
    };

    // T20b: mirrors the auto-close fade-out on the way in — false for the one frame right after
    // opening (mirroring the mount look, no prior DOM state to interpolate from), then flipped to
    // true by the shared double-rAF hook so the backdrop+panel opacity transition actually
    // interpolates instead of popping in at full opacity.
    const entered = useDoubleRafFlip(open);

    // T20: once linked, wait the named auto-close delay, then start the fade.
    useEffect(() => {
        if (!showLinkedOrb) return;
        const autoCloseTimer = setTimeout(() => {
            setClosing(true);
        }, PAIRING_LINKED_AUTO_CLOSE_MS);
        return () => {
            clearTimeout(autoCloseTimer);
        };
    }, [showLinkedOrb]);

    // T20: once the fade starts, wait its own duration, then actually close/unmount.
    useEffect(() => {
        if (!closing) return;
        const fadeTimer = setTimeout(() => {
            close();
        }, PAIRING_FADE_DURATION_MS);
        return () => {
            clearTimeout(fadeTimer);
        };
    }, [closing, close]);

    const fadeOpacityCls = closing || !entered ? 'opacity-0' : 'opacity-100';

    return (
        <>
            <button
                type="button"
                title={TRIGGER_LABEL}
                aria-label={TRIGGER_LABEL}
                aria-haspopup="dialog"
                aria-expanded={open}
                className={TOPBAR_ICON_BUTTON_CLS}
                onClick={togglePanel}
            >
                <Pyramid size={20} />
            </button>
            <ModalBackdrop
                open={open}
                onClose={close}
                className={`${PAIRING_FADE_TRANSITION_CLS} ${fadeOpacityCls}`}
                style={PAIRING_FADE_STYLE}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={DIALOG_LABEL}
                    style={{ ...PAIRING_VISUAL_SLOT_STYLE, ...PAIRING_FADE_STYLE }}
                    className={`${PANEL_WIDTH_CLS} rounded-2xl border border-industrial-border bg-industrial-surface/95 p-4 shadow-2xl backdrop-blur-xl ${PAIRING_FADE_TRANSITION_CLS} ${fadeOpacityCls}`}
                >
                    <div className="flex flex-col gap-3">
                        {!hookOpen ? (
                            // Blocked states: the name service is the authority. A missing name is
                            // actionable copy; a failed/invalid read is reported truthfully as a
                            // read failure with the settings direction in its own paragraph.
                            nameRead !== null && !nameRead.ok ? (
                                <>
                                    <p className="text-industrial-muted">
                                        {READ_FAILURE_COPY}
                                    </p>
                                    <p className="text-industrial-muted">
                                        {READ_FAILURE_DIRECTION_COPY}
                                    </p>
                                </>
                            ) : (
                                <p className="text-industrial-muted">
                                    {MISSING_NAME_COPY}
                                </p>
                            )
                        ) : showQr && qr !== null ? (
                            <>
                                <div
                                    data-testid="pairing-visual-slot"
                                    style={PAIRING_VISUAL_SLOT_FULL_STYLE}
                                    className={PAIRING_VISUAL_SLOT_CLS}
                                >
                                    <QRCodeSVG
                                        value={qr.deepLink}
                                        size={QR_SIZE_PX}
                                        level="M"
                                        marginSize={4}
                                        bgColor={QR_BG_COLOR}
                                        fgColor={QR_FG_COLOR}
                                        title={QR_IMAGE_LABEL}
                                        role="img"
                                        aria-label={QR_IMAGE_LABEL}
                                        className="h-auto w-full"
                                    />
                                </div>
                                <p className="text-center text-industrial-muted">
                                    Escanee el código QR con el teléfono y confirme el destino en
                                    Telegram.
                                </p>
                            </>
                        ) : (showPendingOrb || showLinkedOrb) && visualConfig !== null ? (
                            <>
                                <div
                                    data-testid="pairing-visual-slot"
                                    style={PAIRING_VISUAL_SLOT_FULL_STYLE}
                                    className={PAIRING_VISUAL_SLOT_CLS}
                                >
                                    <PairingOrbVisual config={visualConfig} />
                                </div>
                                <p className={`text-center ${showLinkedOrb ? 'text-status-normal' : 'text-status-warning'}`}>
                                    {pairingStatusCopy(phase, unreachableDetail)}
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-industrial-muted">
                                    {pairingStatusCopy(phase, unreachableDetail)}
                                </p>
                                {phase === 'unreachable' ? (
                                    <p className="text-industrial-muted">
                                        {RUNTIME_UNREACHABLE_HINT_COPY}
                                    </p>
                                ) : null}
                            </>
                        )}
                        <HmiButton
                            variant="primary"
                            fullWidth
                            onClick={close}
                        >
                            {CLOSE_LABEL}
                        </HmiButton>
                    </div>
                </div>
            </ModalBackdrop>
        </>
    );
}
