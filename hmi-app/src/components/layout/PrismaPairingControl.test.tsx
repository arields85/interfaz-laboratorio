// Contract tests for PrismaPairingControl (TDD, PW-006 T20 rewrite).
//
// T20 replaces the AnchoredOverlay-anchored popover with a CENTERED MODAL that reuses the
// shared `ModalBackdrop` primitive (the same backdrop treatment as admin dialogs such as
// GlobalSettingsDialog/AdminDialog). Frozen contract under test:
// - Trigger: button `aria-label`/`title` "Prisma", `aria-haspopup="dialog"`, `aria-expanded`
//   false until a real click opens it. Dialog accessible name: "Vincular teléfono con Prisma".
//   Close via the "Cerrar" button, backdrop click or Escape (through the shared ModalBackdrop).
// - The hook is mocked at the boundary and returns the real hook shape
//   `{ phase, qr, remainingSeconds, unreachableDetail }`; the captured `open` argument proves
//   manual open/close without any service, network or fake clock.
// - The QR is the ACTUAL installed qrcode.react SVG, exposed accessibly as role img named
//   "Código QR para vincular Telegram", rendered ONLY while phase is `free` with a valid qr
//   payload and remainingSeconds > 0.
// - NAME gate unchanged from the previous popover: every open re-reads `readHmiName()`; a
//   missing/invalid name blocks the panel with its existing copy and never reaches the hook
//   with `open=true`.
// - T20 new behavior:
//   - `pending` (awaiting confirmation): the same "Confirme el destino en Telegram." copy, now
//     in the warning token color, with the Prisma orb (mocked leda-orb custom element) filling
//     the SAME fixed visual slot the QR occupied, sized from `readPrismaOrbVisualConfig()`
//     (mocked at the boundary).
//   - `linked`: "Teléfono vinculado" in the success token color, orb still in the same slot;
//     after the named auto-close delay the dialog fades out (opacity-0 on both the panel and
//     the ModalBackdrop) and unmounts after the fade duration — proven with fake timers.
//   - The visual slot (`data-testid="pairing-visual-slot"`) reports the identical fixed
//     `--pairing-visual-slot-size` custom property in all three states (QR, pending, linked):
//     no layout shift.
//   - Every other existing state (missing/invalid name, unavailable, error, unreachable incl.
//     the port_in_use detail, free-without-live-qr) keeps its previous text-only rendering.

import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HmiNameReadResult } from '../../domain/hmiName';
import type { PrismaOrbVisualConfig } from '../../domain/voice.types';
import PrismaPairingControl from './PrismaPairingControl';

type PairingPhase =
    | 'closed'
    | 'loading'
    | 'free'
    | 'pending'
    | 'linked'
    | 'unavailable'
    | 'error'
    | 'unreachable';

interface PairingQr {
    deepLink: string;
    expiresInSeconds: number;
}

const QR_LINK = `https://t.me/PrismaHmiBot?start=${'A'.repeat(43)}`;
const DIALOG_NAME = 'Vincular teléfono con Prisma';
const QR_IMG_NAME = 'Código QR para vincular Telegram';
const MISSING_NAME_COPY = 'Configure el nombre de esta HMI en Configuración general → Prisma antes de vincular un teléfono.';
const READ_FAILURE_COPY = 'No se pudo leer el nombre guardado.';
const SETTINGS_DIRECTION_FRAGMENT = 'Configuración general';
const SLOT_TEST_ID = 'pairing-visual-slot';
const ORB_TAG = 'leda-orb';

interface UnreachableDetail {
    reason: 'port_in_use';
    port: number;
}

// Mutable per-test fixture shaped exactly like the real hook return; the mock records every
// `open` argument so manual open/close is asserted without any service or clock.
const pairingFixture = vi.hoisted(() => ({
    phase: 'closed' as
        | 'closed'
        | 'loading'
        | 'free'
        | 'pending'
        | 'linked'
        | 'unavailable'
        | 'error'
        | 'unreachable',
    qr: null as { deepLink: string; expiresInSeconds: number } | null,
    remainingSeconds: 0,
    unreachableDetail: null as { reason: 'port_in_use'; port: number } | null,
    openArguments: [] as boolean[],
}));

const useChannelAPairingMock = vi.hoisted(() =>
    vi.fn((open: boolean) => {
        pairingFixture.openArguments.push(open);
        return {
            phase: pairingFixture.phase,
            qr: pairingFixture.qr,
            remainingSeconds: pairingFixture.remainingSeconds,
            unreachableDetail: pairingFixture.unreachableDetail,
        };
    }),
);

// The hook module does not exist... it does, but the mock factory still includes every export
// the component may consume. No service, network or timer is involved.
vi.mock('../../hooks/useChannelAPairing', () => ({
    useChannelAPairing: useChannelAPairingMock,
    CHANNEL_A_PAIRING_POLL_INTERVAL_MS: 2000,
}));

function setPairingFixture(phase: PairingPhase, qr: PairingQr | null, remainingSeconds: number, unreachableDetail: UnreachableDetail | null = null): void {
    pairingFixture.phase = phase;
    pairingFixture.qr = qr;
    pairingFixture.unreachableDetail = unreachableDetail;
    pairingFixture.remainingSeconds = remainingSeconds;
}

// The name service is the authority for the configured HMI name; the mock sits exactly on that
// boundary and returns the real discriminated `HmiNameReadResult` union.
const hmiNameBoundary = vi.hoisted(() => ({
    result: {
        ok: true,
        name: 'Panel recepción',
    } as HmiNameReadResult,
    reads: [] as HmiNameReadResult[],
}));

const readHmiNameMock = vi.hoisted(() =>
    vi.fn((): HmiNameReadResult => {
        hmiNameBoundary.reads.push(hmiNameBoundary.result);
        return hmiNameBoundary.result;
    }),
);

vi.mock('../../services/hmiName.service', () => ({
    readHmiName: readHmiNameMock,
}));

function setHmiNameResult(result: HmiNameReadResult): void {
    hmiNameBoundary.result = result;
}

// The orb visual config service is mocked at the same boundary as the name service (deterministic
// fixture, no real localStorage read) — matches admin's `VoiceSettingsTab` preview config shape.
const ORB_CONFIG: PrismaOrbVisualConfig = {
    rays: 0.45,
    speed: 1,
    intensity: 1,
    size: 290,
    core: '#1b6ee0',
    glow: '#8ff0ff',
};

const readPrismaOrbVisualConfigMock = vi.hoisted(() => vi.fn(() => ORB_CONFIG));

vi.mock('../../config/prismaOrb.config', () => ({
    readPrismaOrbVisualConfig: readPrismaOrbVisualConfigMock,
}));

// Real custom element registration for `<leda-orb>` (PrismaOrb's host element), mirroring the
// convention already used by PrismaOrbOverlay.test.tsx: the actual `leda-orb.js` module is
// mocked out and a minimal stand-in custom element is registered instead.
vi.mock('../../vendor/leda-orb.js', () => ({}));

class MockLedaOrb extends HTMLElement {
    public setSpeaking = vi.fn();
}

if (!customElements.get(ORB_TAG)) customElements.define(ORB_TAG, MockLedaOrb);

function liveQr(): PairingQr {
    return { deepLink: QR_LINK, expiresInSeconds: 42 };
}

// ModalBackdrop registers its Escape listener synchronously (unlike the old AnchoredOverlay,
// which deferred registration past a macrotask); nothing here needs a listener-registration
// flush, but click/keyboard interactions still go through userEvent's own internal scheduling.
async function openDialog(): Promise<HTMLElement> {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Prisma' }));
    return screen.getByRole('dialog', { name: DIALOG_NAME });
}

beforeEach(() => {
    setPairingFixture('closed', null, 0);
    pairingFixture.openArguments = [];
    useChannelAPairingMock.mockClear();
    setHmiNameResult({ ok: true, name: 'Panel recepción' });
    hmiNameBoundary.reads = [];
    readHmiNameMock.mockClear();
    readPrismaOrbVisualConfigMock.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('PrismaPairingControl', () => {
    it('opens and closes the pairing dialog manually through the owned Pyramid button', async () => {
        const user = userEvent.setup();

        render(<PrismaPairingControl />);

        const trigger = screen.getByRole('button', { name: 'Prisma' });
        expect(trigger).toHaveAttribute('title', 'Prisma');
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();

        await user.click(trigger);

        const dialog = screen.getByRole('dialog', { name: DIALOG_NAME });
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        // The component drives the hook with the manual open flag, never an auto-open.
        expect(pairingFixture.openArguments.at(-1)).toBe(true);

        await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));

        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(pairingFixture.openArguments.at(-1)).toBe(false);
    });

    it('renders the dialog centered behind the shared backdrop treatment', async () => {
        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        // Shared with AdminDialog via the extracted ModalBackdrop primitive: fixed, centered,
        // dark, blurred backdrop — never a copy-pasted variant of it.
        const backdrop = dialog.parentElement;
        expect(backdrop).not.toBeNull();
        expect(backdrop).toHaveClass('fixed', 'inset-0', 'flex', 'items-center', 'justify-center', 'bg-black/60', 'backdrop-blur-sm');
        expect(backdrop).toHaveAttribute('role', 'presentation');
    });

    it('shows the actual local QR SVG with its accessible label while a valid challenge is live', async () => {
        setPairingFixture('free', liveQr(), 42);

        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        const qrImage = within(dialog).getByRole('img', { name: QR_IMG_NAME });
        expect(qrImage.tagName.toLowerCase()).toBe('svg');
        const dialogButtons = within(dialog).getAllByRole('button');
        expect(dialogButtons).toHaveLength(1);
        expect(dialogButtons[0]).toHaveAccessibleName('Cerrar');
    });

    it('blocks the panel with the actionable missing-name copy before any QR even while a challenge is live', async () => {
        setPairingFixture('free', liveQr(), 42);
        setHmiNameResult({ ok: true, name: null });

        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        expect(within(dialog).getByText(MISSING_NAME_COPY)).toBeInTheDocument();
        expect(within(dialog).queryByText(READ_FAILURE_COPY)).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();
        expect(pairingFixture.openArguments.every((value) => value === false)).toBe(true);

        const user = userEvent.setup();
        await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));

        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(pairingFixture.openArguments.at(-1)).toBe(false);
    });

    it('reports a failed or invalid name read truthfully with the settings direction and never a QR', async () => {
        setPairingFixture('free', liveQr(), 42);

        const failures: ReadonlyArray<HmiNameReadResult> = [
            { ok: false, name: null, error: 'invalid' },
            { ok: false, name: null, error: 'unavailable' },
        ];

        for (const failure of failures) {
            setHmiNameResult(failure);

            const { unmount } = render(<PrismaPairingControl />);
            const dialog = await openDialog();

            expect(within(dialog).getByText(READ_FAILURE_COPY)).toBeInTheDocument();
            expect(within(dialog).getByText(new RegExp(SETTINGS_DIRECTION_FRAGMENT))).toBeInTheDocument();
            expect(within(dialog).queryByText(MISSING_NAME_COPY)).not.toBeInTheDocument();
            expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();
            expect(pairingFixture.openArguments.every((value) => value === false)).toBe(true);

            unmount();
        }
    });

    it('re-reads the saved name on every open: blocked while missing, pairing once configured, blocked again after clearing', async () => {
        setHmiNameResult({ ok: true, name: null });

        render(<PrismaPairingControl />);

        const first = await openDialog();
        expect(within(first).getByText(MISSING_NAME_COPY)).toBeInTheDocument();
        expect(within(first).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();

        const user = userEvent.setup();
        await user.click(within(first).getByRole('button', { name: 'Cerrar' }));

        setPairingFixture('free', liveQr(), 42);
        setHmiNameResult({ ok: true, name: 'Panel recepción' });

        const second = await openDialog();
        expect(within(second).getByRole('img', { name: QR_IMG_NAME })).toBeInTheDocument();
        expect(within(second).queryByText(MISSING_NAME_COPY)).not.toBeInTheDocument();

        await user.click(within(second).getByRole('button', { name: 'Cerrar' }));

        setHmiNameResult({ ok: true, name: null });

        const third = await openDialog();
        expect(within(third).getByText(MISSING_NAME_COPY)).toBeInTheDocument();
        expect(within(third).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();

        expect(hmiNameBoundary.reads.length).toBeGreaterThanOrEqual(3);
        expect(hmiNameBoundary.reads.at(-1)).toEqual({ ok: true, name: null });
    });

    it('shows the unavailable state with its copy and never a QR', async () => {
        setPairingFixture('unavailable', liveQr(), 30);

        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        expect(within(dialog).getByText('Canal A no disponible')).toBeInTheDocument();
        expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();
        expect(within(dialog).queryByTestId(SLOT_TEST_ID)).not.toBeInTheDocument();
    });

    it('shows the clear runtime-unreachable copy and never a QR when the Prisma runtime could not be reached', async () => {
        setPairingFixture('unreachable', liveQr(), 30);

        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        expect(within(dialog).getByText('Prisma no se pudo iniciar.')).toBeInTheDocument();
        expect(within(dialog).queryByText('Canal A no disponible')).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();
    });

    it('shows the detected busy port instead of the generic copy when the launcher reports port_in_use', async () => {
        setPairingFixture('unreachable', null, 0, { reason: 'port_in_use', port: 5057 });

        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        expect(within(dialog).getByText('Prisma no se pudo iniciar: el puerto 5057 está en uso por otro programa.')).toBeInTheDocument();
        expect(within(dialog).queryByText('Prisma no se pudo iniciar.')).not.toBeInTheDocument();
        expect(within(dialog).getByText('Reinicie el lanzador para volver a intentarlo.')).toBeInTheDocument();
        expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();
    });

    it('falls back to the generic unreachable copy when no port detail was detected', async () => {
        setPairingFixture('unreachable', null, 0, null);

        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        expect(within(dialog).getByText('Prisma no se pudo iniciar.')).toBeInTheDocument();
        expect(within(dialog).queryByText(/el puerto/)).not.toBeInTheDocument();
    });

    it('never shows the QR once the countdown reaches zero or the payload is missing', async () => {
        setPairingFixture('free', liveQr(), 0);

        const first = render(<PrismaPairingControl />);
        const dialog = await openDialog();
        expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();
        first.unmount();

        setPairingFixture('free', null, 30);
        render(<PrismaPairingControl />);
        const reopened = await openDialog();
        expect(within(reopened).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();
    });

    it('closes the dialog with Escape through the shared ModalBackdrop primitive', async () => {
        render(<PrismaPairingControl />);
        await openDialog();
        const trigger = screen.getByRole('button', { name: 'Prisma' });

        const user = userEvent.setup();
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(pairingFixture.openArguments.at(-1)).toBe(false);
    });

    it('closes the dialog when clicking the backdrop outside the panel', async () => {
        render(<PrismaPairingControl />);
        const dialog = await openDialog();
        const backdrop = dialog.parentElement as HTMLElement;

        const user = userEvent.setup();
        await user.click(backdrop);

        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(pairingFixture.openArguments.at(-1)).toBe(false);
    });

    describe('T20 — awaiting confirmation and linked orb states', () => {
        it('shows the Prisma orb with the configured visual settings and the warning-token copy while awaiting confirmation', async () => {
            setPairingFixture('pending', null, 0);

            render(<PrismaPairingControl />);
            const dialog = await openDialog();

            const orb = dialog.querySelector(ORB_TAG);
            expect(orb).not.toBeNull();
            expect(orb).toHaveAttribute('rays', String(ORB_CONFIG.rays));
            expect(orb).toHaveAttribute('speed', String(ORB_CONFIG.speed));
            expect(orb).toHaveAttribute('intensity', String(ORB_CONFIG.intensity));
            expect(orb).toHaveAttribute('core', ORB_CONFIG.core);
            expect(orb).toHaveAttribute('glow', ORB_CONFIG.glow);
            expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();

            const copy = within(dialog).getByText('Confirme el destino en Telegram.');
            expect(copy).toHaveClass('text-status-warning');
        });

        it('shows the Prisma orb with the success-token copy once linked', async () => {
            setPairingFixture('linked', null, 0);

            render(<PrismaPairingControl />);
            const dialog = await openDialog();

            expect(dialog.querySelector(ORB_TAG)).not.toBeNull();
            const copy = within(dialog).getByText('Teléfono vinculado');
            expect(copy).toHaveClass('text-status-normal');
        });

        it('keeps the identical fixed visual-slot size across the QR, pending and linked states', async () => {
            setPairingFixture('free', liveQr(), 42);
            const first = render(<PrismaPairingControl />);
            const qrDialog = await openDialog();
            const qrSlot = within(qrDialog).getByTestId(SLOT_TEST_ID);
            const slotSizeStyle = qrSlot.style.getPropertyValue('--pairing-visual-slot-size');
            expect(slotSizeStyle).not.toBe('');
            first.unmount();

            setPairingFixture('pending', null, 0);
            const second = render(<PrismaPairingControl />);
            const pendingDialog = await openDialog();
            const pendingSlot = within(pendingDialog).getByTestId(SLOT_TEST_ID);
            expect(pendingSlot.style.getPropertyValue('--pairing-visual-slot-size')).toBe(slotSizeStyle);
            second.unmount();

            setPairingFixture('linked', null, 0);
            render(<PrismaPairingControl />);
            const linkedDialog = await openDialog();
            const linkedSlot = within(linkedDialog).getByTestId(SLOT_TEST_ID);
            expect(linkedSlot.style.getPropertyValue('--pairing-visual-slot-size')).toBe(slotSizeStyle);
        });

        it('auto-closes with a fade after the phone links, animating the backdrop and panel opacity together', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            setPairingFixture('linked', null, 0);

            render(<PrismaPairingControl />);
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            await user.click(screen.getByRole('button', { name: 'Prisma' }));

            const dialog = screen.getByRole('dialog', { name: DIALOG_NAME });
            const backdrop = dialog.parentElement as HTMLElement;
            expect(dialog).toHaveClass('opacity-100');
            expect(backdrop).toHaveClass('opacity-100');

            // Still visible well before the auto-close delay elapses.
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(screen.getByRole('dialog', { name: DIALOG_NAME })).toBeInTheDocument();

            // The named auto-close delay (~3 s) elapses: the fade starts on both layers together.
            act(() => {
                vi.advanceTimersByTime(2000);
            });
            expect(dialog).toHaveClass('opacity-0');
            expect(backdrop).toHaveClass('opacity-0');
            // Still mounted mid-fade.
            expect(screen.getByRole('dialog', { name: DIALOG_NAME })).toBeInTheDocument();

            // The fade duration elapses: the dialog unmounts.
            act(() => {
                vi.advanceTimersByTime(500);
            });
            expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Prisma' })).toHaveAttribute('aria-expanded', 'false');
        });

        it('skips the fade transition under prefers-reduced-motion, on both the panel and the backdrop', async () => {
            setPairingFixture('pending', null, 0);

            render(<PrismaPairingControl />);
            const dialog = await openDialog();
            const backdrop = dialog.parentElement as HTMLElement;

            expect(dialog).toHaveClass('motion-reduce:transition-none', 'motion-reduce:duration-0');
            expect(backdrop).toHaveClass('motion-reduce:transition-none', 'motion-reduce:duration-0');
        });
    });
});
