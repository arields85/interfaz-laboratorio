import { useEffect, useRef, useState } from 'react';
import { Pyramid } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import AnchoredOverlay from '../ui/AnchoredOverlay';
import { useChannelAPairing, type ChannelAPairingPhase } from '../../hooks/useChannelAPairing';
import { TOPBAR_ICON_BUTTON_CLS } from './topbarIconButtonStyles';

const DIALOG_LABEL = 'Vincular teléfono con Prisma';
const QR_IMAGE_LABEL = 'Código QR para vincular Telegram';
const TRIGGER_LABEL = 'Prisma';
const CLOSE_LABEL = 'Cerrar';

// High-contrast QR built from existing theme tokens, inverted for scanner legibility: the
// quiet zone and background take the near-white text token and the modules take the near-black
// background token. CSS variables are valid SVG fill values, so dynamic theming keeps working.
const QR_BG_COLOR = 'var(--color-industrial-text)';
const QR_FG_COLOR = 'var(--color-industrial-bg)';

// Runtime panel size handed to the shared AnchoredOverlay primitive: measured from the open
// panel itself, never from arbitrary estimated/min constants (anti-hardcode dimensional policy).
interface PanelSize {
    width: number;
    height: number;
}

function pairingStatusCopy(phase: ChannelAPairingPhase): string {
    switch (phase) {
        case 'pending':
            return 'Confirma el destino en Telegram.';
        case 'linked':
            return 'Teléfono vinculado';
        case 'unavailable':
            return 'Canal A no disponible';
        case 'loading':
            return 'Consultando el estado del emparejamiento...';
        case 'error':
            return 'No se pudo obtener el estado del emparejamiento.';
        case 'free':
            return 'Generando código QR...';
        case 'closed':
            return '';
    }
}

// The control owns the trigger button, its open state, the runtime panel measurement and the
// existing AnchoredOverlay primitive; the pairing hook drives the ephemeral panel content.
// Nothing here writes to the plant or persists state: this is read-only pairing observation
// with manual open/close.
export default function PrismaPairingControl() {
    const [open, setOpen] = useState(false);
    const [panelSize, setPanelSize] = useState<PanelSize | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { phase, qr, remainingSeconds } = useChannelAPairing(open);

    const close = () => setOpen(false);
    const qrIsLive = phase === 'free' && qr !== null && remainingSeconds > 0;

    useEffect(() => {
        // The observer is owned by the open panel only: nothing observes while closed.
        if (!open) return;
        const panel = panelRef.current;
        // Environments without ResizeObserver (plain jsdom) skip measurement and the primitive
        // keeps its own documented defaults; no availability/polling machinery is invented.
        if (panel === null || typeof ResizeObserver === 'undefined') return;

        // A degenerate zero rect (layout not resolved) must never become a measurement.
        const applyRect = ({ width, height }: { width: number; height: number }) => {
            if (width <= 0 || height <= 0) return;
            setPanelSize((previous) => (
                previous !== null && previous.width === width && previous.height === height
                    ? previous // equal-measure guard: identical sizes never re-render
                    : { width, height }
            ));
        };

        // Initial measurement on open/layout; real browsers additionally fire the observer.
        applyRect(panel.getBoundingClientRect());

        const observer = new ResizeObserver(() => {
            // Always measure the ACTUAL border box of the open panel: the entry content box
            // excludes borders and padding, and the overlay geometry needs the rendered box —
            // the same box the initial on-open measurement reads.
            applyRect(panel.getBoundingClientRect());
        });
        observer.observe(panel);
        return () => {
            // Close/unmount disconnects and no stale element is retained.
            observer.disconnect();
        };
    }, [open]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                title={TRIGGER_LABEL}
                aria-label={TRIGGER_LABEL}
                aria-haspopup="dialog"
                aria-expanded={open}
                className={TOPBAR_ICON_BUTTON_CLS}
                onClick={() => setOpen((value) => !value)}
            >
                <Pyramid size={20} />
            </button>
            <AnchoredOverlay
                triggerRef={triggerRef}
                isOpen={open}
                onClose={close}
                align="end"
                estimatedHeight={panelSize?.height}
                minWidth={panelSize?.width}
            >
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label={DIALOG_LABEL}
                    className="w-72 rounded-2xl border border-industrial-border bg-industrial-surface/95 p-4 shadow-2xl backdrop-blur-xl"
                >
                    <div className="flex flex-col gap-3">
                        {qrIsLive && qr !== null ? (
                            <>
                                <div className="rounded-xl bg-industrial-surface p-3">
                                    <QRCodeSVG
                                        value={qr.deepLink}
                                        size={256}
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
                                <p className="text-sm text-industrial-text-soft">
                                    Escanea el código QR con el teléfono y confirma el destino en
                                    Telegram.
                                </p>
                            </>
                        ) : (
                            <p className="text-sm text-industrial-text-soft">
                                {pairingStatusCopy(phase)}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={close}
                            className="rounded-lg border border-industrial-border px-3 py-1.5 text-sm text-industrial-text transition-colors hover:bg-industrial-hover"
                        >
                            {CLOSE_LABEL}
                        </button>
                    </div>
                </div>
            </AnchoredOverlay>
        </>
    );
}
