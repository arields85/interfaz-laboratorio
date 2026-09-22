// Offline component contract tests for PrismaPairingControl (RCA-5l, TDD RED stage).
// The component source does NOT exist yet: importing it must fail collection, which is the
// honest observed RED for the later UI gate. No placeholder source and no import catch here.
//
// Frozen contract under test (tracker `odd/tasks/prisma-channel-a-remote.md`):
// - The default `PrismaPairingControl` owns the `Pyramid` button ref, the open state and the
//   existing `AnchoredOverlay` primitive itself — never via props — with local state only.
// - Trigger: button `aria-label`/`title` "Prisma", `aria-haspopup="dialog"`, `aria-expanded`
//   false until a real click opens it. Dialog accessible name: "Vincular teléfono con Prisma".
//   Close via the "Cerrar" button, outside click or Escape through `AnchoredOverlay`.
// - The hook is mocked at the boundary and returns the real hook shape
//   `{ phase, qr, remainingSeconds }`; the captured `open` argument proves manual open/close
//   without any service, network or fake clock.
// - The QR is the ACTUAL installed qrcode.react SVG, exposed accessibly as
//   role img named "Código QR para vincular Telegram", and rendered ONLY while
//   phase is `free` with a valid qr payload and remainingSeconds > 0. No QR token ever reaches
//   a title attribute, log or storage beyond the deep link itself.
// - Spanish neutral copy: pending "Confirma el destino en Telegram.", linked
//   "Teléfono vinculado", unavailable "Canal A no disponible"; loading/error stay truthful and
//   generic (exact copy intentionally not pinned). No extra Renew/Apply/local-confirm buttons;
//   no admin auth dependency. High-contrast token styling is checked by static source review,
//   never by computed color assertions (jsdom does not resolve stylesheets).
// - Panel sizing follows the anti-hardcode dimensional policy: the control measures the open
//   panel at runtime (ResizeObserver/getBoundingClientRect) and feeds the SHARED
//   AnchoredOverlay primitive, instead of arbitrary estimatedHeight/minWidth constants. The
//   synthetic geometry numbers in the measurement test are TEST inputs, never production
//   dimensions.

import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PrismaPairingControl from './PrismaPairingControl';

type PairingPhase =
    | 'closed'
    | 'loading'
    | 'free'
    | 'pending'
    | 'linked'
    | 'unavailable'
    | 'error';

interface PairingQr {
    deepLink: string;
    expiresInSeconds: number;
}

const QR_LINK = `https://t.me/PrismaHmiBot?start=${'A'.repeat(43)}`;
const DIALOG_NAME = 'Vincular teléfono con Prisma';
const QR_IMG_NAME = 'Código QR para vincular Telegram';

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
        | 'error',
    qr: null as { deepLink: string; expiresInSeconds: number } | null,
    remainingSeconds: 0,
    openArguments: [] as boolean[],
}));

const useChannelAPairingMock = vi.hoisted(() =>
    vi.fn((open: boolean) => {
        pairingFixture.openArguments.push(open);
        return {
            phase: pairingFixture.phase,
            qr: pairingFixture.qr,
            remainingSeconds: pairingFixture.remainingSeconds,
        };
    }),
);

// The hook module does not exist yet, so the mock factory is fully synthetic and includes every
// export the component may consume. No service, network or timer is involved.
vi.mock('../../hooks/useChannelAPairing', () => ({
    useChannelAPairing: useChannelAPairingMock,
    CHANNEL_A_PAIRING_POLL_INTERVAL_MS: 2000,
}));

function setPairingFixture(phase: PairingPhase, qr: PairingQr | null, remainingSeconds: number): void {
    pairingFixture.phase = phase;
    pairingFixture.qr = qr;
    pairingFixture.remainingSeconds = remainingSeconds;
}

function liveQr(): PairingQr {
    return { deepLink: QR_LINK, expiresInSeconds: 42 };
}

// AnchoredOverlay registers its outside-click/Escape listeners after a macrotask boundary; a
// single real 0 ms timeout is the deterministic way to cross it under real timers.
async function flushListenerRegistration(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

async function openDialog(): Promise<HTMLElement> {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Prisma' }));
    await flushListenerRegistration();
    return screen.getByRole('dialog', { name: DIALOG_NAME });
}

beforeEach(() => {
    setPairingFixture('closed', null, 0);
    pairingFixture.openArguments = [];
    useChannelAPairingMock.mockClear();
});

// --- Runtime panel measurement fixture (anti-hardcode dimensional policy) --------------------
// Every geometry number below is a synthetic TEST input: never a production dimension and never
// the old arbitrary estimatedHeight/minWidth constants (340/280), which are never asserted.

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const OVERLAY_GAP_PX = 4; // AnchoredOverlay's documented default gap.

const MEASURED_WIDTH = 320;
const MEASURED_TALL_HEIGHT = 500; // exceeds the 160 px of space below the trigger
const MEASURED_SHORT_HEIGHT = 120; // fits below the trigger

const TRIGGER_RECT: DOMRect = {
    x: 1000,
    y: 528,
    width: 160,
    height: 32,
    top: 528,
    right: 1160,
    bottom: 560,
    left: 1000,
    toJSON: () => ({}),
} as DOMRect;

const originalViewport = { width: window.innerWidth, height: window.innerHeight };

class ResizeObserverFixture {
    static instances: ResizeObserverFixture[] = [];

    callback: ResizeObserverCallback;
    observed: Element[] = [];
    disconnected = false;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverFixture.instances.push(this);
    }

    observe(target: Element): void {
        this.observed.push(target);
    }

    unobserve(target: Element): void {
        this.observed = this.observed.filter((element) => element !== target);
    }

    disconnect(): void {
        this.disconnected = true;
    }
}

// getBoundingClientRect overrides applied during a test; restored after EVERY test so no
// geometry instrumentation leaks into the other cases.
const geometryRestorers: Array<() => void> = [];

function spyGeometry(element: Element, rect: DOMRect): void {
    geometryRestorers.push((() => {
        const spy = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
        return () => spy.mockRestore();
    })());
}

function panelRect(width: number, height: number): DOMRect {
    return {
        x: 0,
        y: 0,
        width,
        height,
        top: 0,
        right: width,
        bottom: height,
        left: 0,
        toJSON: () => ({}),
    } as DOMRect;
}

// Border box vs content box: getBoundingClientRect reports the BORDER box (the actual
// rendered size, padding and border included), while a ResizeObserver entry.contentRect is the
// CONTENT box only (padding and border excluded). The real panel pads its content (p-4 plus
// border, w-72 = 288 px outer), so an implementation that measured entry.contentRect would
// treat the content width as the whole overlay width and misalign the 'end' placement. The
// fixture therefore keeps the getBoundingClientRect spies at the provided border-box
// width/height but delivers a contentRect deliberately SMALLER by this explicit positive TEST
// inset: only a source measuring the ACTUAL rendered panel (getBoundingClientRect on the RO
// callback, or borderBoxSize) satisfies the unchanged minWidth/left and flip expectations.
const CONTENT_BOX_INSET_PX = 24;

async function emitPanelMeasurement(
    observer: ResizeObserverFixture,
    width: number,
    height: number,
): Promise<void> {
    // Observed elements report the ACTUAL rendered border-box size via getBoundingClientRect.
    for (const observed of observer.observed) {
        spyGeometry(observed, panelRect(width, height));
    }
    const entry = {
        target: observer.observed[0],
        contentRect: panelRect(width - CONTENT_BOX_INSET_PX, height - CONTENT_BOX_INSET_PX),
    } as unknown as ResizeObserverEntry;
    await act(async () => {
        observer.callback([entry], observer as unknown as ResizeObserver);
    });
}

function overlayOf(dialog: HTMLElement): HTMLElement {
    const overlay = dialog.parentElement;
    if (!overlay) {
        throw new Error('the pairing dialog must be portaled inside the overlay wrapper');
    }
    return overlay;
}

function lastPanelObserver(): ResizeObserverFixture {
    const observer = ResizeObserverFixture.instances.at(-1);
    if (!observer) {
        throw new Error('the open panel never registered a ResizeObserver');
    }
    return observer;
}

afterEach(() => {
    vi.unstubAllGlobals();
    for (const restore of geometryRestorers) {
        restore();
    }
    geometryRestorers.length = 0;
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalViewport.width,
    });
    Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalViewport.height,
    });
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
        await flushListenerRegistration();

        expect(screen.getByRole('dialog', { name: DIALOG_NAME })).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        // The component drives the hook with the manual open flag, never an auto-open.
        expect(pairingFixture.openArguments.at(-1)).toBe(true);

        await user.click(within(screen.getByRole('dialog', { name: DIALOG_NAME })).getByRole('button', { name: 'Cerrar' }));

        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(pairingFixture.openArguments.at(-1)).toBe(false);
    });

    it('shows the actual local QR SVG with its accessible label while a valid challenge is live', async () => {
        setPairingFixture('free', liveQr(), 42);

        render(<PrismaPairingControl />);
        const dialog = await openDialog();

        const qrImage = within(dialog).getByRole('img', { name: QR_IMG_NAME });
        // The real installed qrcode.react SVG is rendered locally, not a fake or remote image.
        expect(qrImage.tagName.toLowerCase()).toBe('svg');
        // No extra Renew/Apply/local-confirm actions exist anywhere in the dialog.
        const dialogButtons = within(dialog).getAllByRole('button');
        expect(dialogButtons).toHaveLength(1);
        expect(dialogButtons[0]).toHaveAccessibleName('Cerrar');
    });

    it('reflects pending, linked and unavailable states with their copy and never a QR', async () => {
        const stateCopy: ReadonlyArray<[PairingPhase, string]> = [
            ['pending', 'Confirma el destino en Telegram.'],
            ['linked', 'Teléfono vinculado'],
            ['unavailable', 'Canal A no disponible'],
        ];

        for (const [phase, copy] of stateCopy) {
            setPairingFixture(phase, liveQr(), 30);

            const { unmount } = render(<PrismaPairingControl />);
            const dialog = await openDialog();

            expect(within(dialog).getByText(copy)).toBeInTheDocument();
            expect(within(dialog).queryByRole('img', { name: QR_IMG_NAME })).not.toBeInTheDocument();

            unmount();
        }
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

    it('closes the dialog with Escape through the existing overlay primitive', async () => {
        render(<PrismaPairingControl />);
        await openDialog();
        const trigger = screen.getByRole('button', { name: 'Prisma' });

        const user = userEvent.setup();
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(pairingFixture.openArguments.at(-1)).toBe(false);
    });

    it('closes the dialog when clicking outside through the existing overlay primitive', async () => {
        render(<PrismaPairingControl />);
        await openDialog();

        const user = userEvent.setup();
        await user.click(document.body);

        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(pairingFixture.openArguments.at(-1)).toBe(false);
    });

    it('sizes and places the overlay from the ACTUAL measured panel and disconnects the observer on close/unmount', async () => {
        vi.stubGlobal('ResizeObserver', ResizeObserverFixture);
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT_HEIGHT });

        setPairingFixture('free', liveQr(), 42);
        const first = render(<PrismaPairingControl />);

        // Scoped trigger instrumentation: 160 px of space below the trigger fit the SHORT
        // measurement but not the TALL one.
        const trigger = screen.getByRole('button', { name: 'Prisma' });
        spyGeometry(trigger, TRIGGER_RECT);

        const dialog = await openDialog();
        const overlay = overlayOf(dialog);

        // The control must own the runtime measurement: a real ResizeObserver observing the
        // open panel, with the shared AnchoredOverlay primitive left completely untouched.
        const observer = lastPanelObserver();
        expect(
            observer.observed.some(
                (element) => element === dialog || dialog.contains(element) || overlay.contains(element),
            ),
        ).toBe(true);
        expect(observer.disconnected).toBe(false);

        // Tall measured QR content cannot fit below the trigger: the overlay flips ABOVE it,
        // with end-alignment geometry derived from the MEASURED width (never from the removed
        // estimatedHeight/minWidth constants).
        await emitPanelMeasurement(observer, MEASURED_WIDTH, MEASURED_TALL_HEIGHT);
        expect(overlay).toHaveStyle({
            bottom: `${VIEWPORT_HEIGHT - TRIGGER_RECT.top + OVERLAY_GAP_PX}px`,
        });
        expect(overlay.style.top).toBe('');
        expect(overlay).toHaveStyle({ minWidth: `${MEASURED_WIDTH}px` });
        expect(overlay).toHaveStyle({ left: `${TRIGGER_RECT.right - MEASURED_WIDTH}px` });

        // Short measured pending content fits below: back underneath the trigger, still sized
        // by the same measured width.
        setPairingFixture('pending', null, 0);
        await emitPanelMeasurement(observer, MEASURED_WIDTH, MEASURED_SHORT_HEIGHT);
        expect(within(dialog).getByText('Confirma el destino en Telegram.')).toBeInTheDocument();
        expect(overlay).toHaveStyle({ top: `${TRIGGER_RECT.bottom + OVERLAY_GAP_PX}px` });
        expect(overlay.style.bottom).toBe('');
        expect(overlay).toHaveStyle({ minWidth: `${MEASURED_WIDTH}px` });
        expect(overlay).toHaveStyle({ left: `${TRIGGER_RECT.right - MEASURED_WIDTH}px` });

        // The observer is owned by the open panel only: an explicit close disconnects it.
        const user = userEvent.setup();
        await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
        expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).not.toBeInTheDocument();
        expect(observer.disconnected).toBe(true);
        first.unmount();

        // Unmount while open also disconnects any observer still owned by the control.
        ResizeObserverFixture.instances = [];
        setPairingFixture('pending', null, 0);
        const second = render(<PrismaPairingControl />);
        await openDialog();
        const reopenObserver = lastPanelObserver();
        expect(reopenObserver.disconnected).toBe(false);
        second.unmount();
        expect(reopenObserver.disconnected).toBe(true);
    });
});
