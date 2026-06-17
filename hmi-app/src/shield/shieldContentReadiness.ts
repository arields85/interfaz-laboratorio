import { logShieldDebug } from './shieldDebug';

export const CONTENT_READY_ATTRIBUTE = 'data-hmi-content-ready';
export const CONTENT_READY_EVENT = 'hmi-content-ready';
export const DEFAULT_CONTENT_READY_TIMEOUT_MS = 1500;

function getRoot(): HTMLElement | null {
    return document.getElementById('root');
}

export function signalShieldContentReady(): void {
    const root = getRoot();

    if (!root) {
        logShieldDebug('content-ready:signal-skipped', { detail: 'root-missing' });
        return;
    }

    root.setAttribute(CONTENT_READY_ATTRIBUTE, 'true');
    root.dispatchEvent(new CustomEvent(CONTENT_READY_EVENT, { bubbles: true }));
    logShieldDebug('content-ready:signal', { detail: 'root-attribute-set' });
}

export function isShieldContentReady(): boolean {
    return getRoot()?.getAttribute(CONTENT_READY_ATTRIBUTE) === 'true';
}

export function resetShieldContentReady(): void {
    getRoot()?.removeAttribute(CONTENT_READY_ATTRIBUTE);
    logShieldDebug('content-ready:reset');
}

export async function waitForShieldContentReady(timeoutMs = DEFAULT_CONTENT_READY_TIMEOUT_MS): Promise<void> {
    if (isShieldContentReady()) {
        logShieldDebug('content-ready:wait-end', { detail: 'already-ready' });
        return;
    }

    logShieldDebug('content-ready:wait-start', { detail: { timeoutMs } });

    await new Promise<void>((resolve) => {
        const root = getRoot();

        if (!root) {
            logShieldDebug('content-ready:wait-end', { detail: 'root-missing' });
            resolve();
            return;
        }

        let settled = false;
        let timeoutId = 0;

        const finish = (detail: string) => {
            if (settled) {
                return;
            }

            settled = true;
            root.removeEventListener(CONTENT_READY_EVENT, handleReady);

            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }

            logShieldDebug('content-ready:wait-end', { detail });
            resolve();
        };

        const handleReady = () => {
            finish('event-received');
        };

        root.addEventListener(CONTENT_READY_EVENT, handleReady, { once: true });

        if (isShieldContentReady()) {
            finish('became-ready-before-listener-return');
            return;
        }

        timeoutId = window.setTimeout(() => {
            finish('timeout');
        }, timeoutMs);
    });
}
