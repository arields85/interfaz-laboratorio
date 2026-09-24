import { useEffect, useState, type CSSProperties } from 'react';
import { Pyramid } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ModalBackdrop from '../ui/ModalBackdrop';
import { HmiButton } from '../ui';
import PrismaOrb from '../PrismaOrb';
import { useChannelAPairing, type ChannelAPairingPhase } from '../../hooks/useChannelAPairing';
import { readHmiName } from '../../services/hmiName.service';
import type { HmiNameReadResult } from '../../domain/hmiName';
import type { ChannelARuntimeUnreachableDetail } from '../../domain/channelAPairing.types';
import { readPrismaOrbVisualConfig } from '../../config/prismaOrb.config';
import type { PrismaOrbVisualConfig } from '../../domain/voice.types';
import { TOPBAR_ICON_BUTTON_CLS } from './topbarIconButtonStyles';

const DIALOG_LABEL = 'Vincular teléfono con Prisma';
const MISSING_NAME_COPY = 'Configure el nombre de esta HMI en Configuración general → Prisma antes de vincular un teléfono.';
const READ_FAILURE_COPY = 'No se pudo leer el nombre guardado.';
const READ_FAILURE_DIRECTION_COPY = 'Revise el nombre de esta HMI en Configuración general → Prisma.';
const QR_IMAGE_LABEL = 'Código QR para vincular Telegram';
const TRIGGER_LABEL = 'Prisma';
const CLOSE_LABEL = 'Cerrar';
// Distinct from 'unavailable' (the runtime answered "Canal A no disponible"): this is shown
// only when the Prisma runtime itself could not be reached at all.
const RUNTIME_UNREACHABLE_COPY = 'Prisma no se pudo iniciar.';
const RUNTIME_UNREACHABLE_HINT_COPY = 'Reinicie el lanzador para volver a intentarlo.';

// T4b: when the launcher detected the specific reason (currently only a busy port), name it
// instead of the generic copy above. The port always comes from the detected data, never a
// literal. Formal "usted" register per the current copy decision for new strings.
function runtimeUnreachableCopy(detail: ChannelARuntimeUnreachableDetail | null): string {
    if (detail?.reason === 'port_in_use') {
        return `Prisma no se pudo iniciar: el puerto ${detail.port} está en uso por otro programa.`;
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
// QR's own rendered size (the qrcode.react `size` prop below) plus the p-3 padding (0.75rem
// at the 16px root font-size) that already wrapped it, instead of an independent constant.
const QR_SIZE_PX = 256;
const QR_SLOT_PADDING_PX = 12;
const PAIRING_VISUAL_SLOT_SIZE_PX = QR_SIZE_PX + QR_SLOT_PADDING_PX * 2;
const PAIRING_VISUAL_SLOT_STYLE = {
    '--pairing-visual-slot-size': `${PAIRING_VISUAL_SLOT_SIZE_PX}px`,
} as CSSProperties;
const PAIRING_VISUAL_SLOT_CLS = 'flex size-[var(--pairing-visual-slot-size)] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-industrial-surface p-3';

// T20: how long the "Teléfono vinculado" state stays visible before the modal auto-closes.
const PAIRING_LINKED_AUTO_CLOSE_MS = 3000;
// T20: fade-out duration for the modal+backdrop opacity transition (matches Tailwind's
// `duration-300` step below, kept as its own constant so the auto-close timing chain has one
// source of truth). `motion-reduce:transition-none` clears the transition itself under
// prefers-reduced-motion, so the opacity jumps instantly there — the close still happens after
// this same delay, it is just invisible instead of animated.
const PAIRING_FADE_DURATION_MS = 300;
const PAIRING_FADE_TRANSITION_CLS = 'transition-opacity duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0';

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
export default function PrismaPairingControl() {
    const [open, setOpen] = useState(false);
    // Result of the latest name read, refreshed on every panel open (never cached across
    // openings and never re-read while closed). `null` means the panel was never opened yet.
    const [nameRead, setNameRead] = useState<HmiNameReadResult | null>(null);
    // T20: the orb's visual settings, read alongside the name on every open (same lifecycle),
    // so a later admin edit of the orb appearance is reflected on the next pairing open.
    const [visualConfig, setVisualConfig] = useState<PrismaOrbVisualConfig | null>(null);
    // T20: true only while the linked-state auto-close fade is playing; drives the opacity
    // classes on both the backdrop and the panel so they fade out together.
    const [closing, setClosing] = useState(false);

    // The pairing hook only observes while the panel is open AND a valid configured name was
    // read; a stale or mocked hook result can never leak a QR past this gate.
    const nameGateOk = nameRead !== null && nameRead.ok && nameRead.name !== null;
    const hookOpen = open && nameGateOk;
    const { phase, qr, remainingSeconds, unreachableDetail } = useChannelAPairing(hookOpen);

    const close = () => {
        setOpen(false);
        setClosing(false);
    };
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
        setVisualConfig(readPrismaOrbVisualConfig());
        setClosing(false);
        setOpen(true);
    };

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
    }, [closing]);

    const fadeOpacityCls = closing ? 'opacity-0' : 'opacity-100';

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
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={DIALOG_LABEL}
                    className={`w-72 rounded-2xl border border-industrial-border bg-industrial-surface/95 p-4 shadow-2xl backdrop-blur-xl ${PAIRING_FADE_TRANSITION_CLS} ${fadeOpacityCls}`}
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
                                    style={PAIRING_VISUAL_SLOT_STYLE}
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
                                <p className="text-industrial-muted">
                                    Escanee el código QR con el teléfono y confirme el destino en
                                    Telegram.
                                </p>
                            </>
                        ) : (showPendingOrb || showLinkedOrb) && visualConfig !== null ? (
                            <>
                                <div
                                    data-testid="pairing-visual-slot"
                                    style={PAIRING_VISUAL_SLOT_STYLE}
                                    className={PAIRING_VISUAL_SLOT_CLS}
                                >
                                    <PrismaOrb config={visualConfig} className="size-full" />
                                </div>
                                <p className={showLinkedOrb ? 'text-status-normal' : 'text-status-warning'}>
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
