import { useEffect } from 'react';

export const BOOT_SHIELD_ID = 'hmi-shield';
export const BOOT_SHIELD_MESSAGE = 'ACTUALIZANDO DATOS';
export const BOOT_SHIELD_HIDDEN_CLASS = 'hmi-shield--hidden';
export const BOOT_SHIELD_MIN_VISIBLE_MS = 1200;
export const BOOT_SHIELD_TIMEOUT_MS = 5000;
export const BOOT_SHIELD_TRANSITION_FALLBACK_MS = 300;
export const BOOT_SHIELD_STABLE_FRAME_COUNT = 4;
export const SHADER_CANVAS_SELECTOR = '[data-hmi-shader-canvas="true"]';
export const SHADER_READY_ATTRIBUTE = 'data-hmi-webgl-ready';
export const WEBGL_FIRST_DRAW_EVENT = 'webgl-first-draw';

type FontsReadyDocument = Document & {
    fonts?: {
        check?: (font: string) => boolean;
        ready?: Promise<unknown>;
    };
};

interface FontCheckToken {
    family: string;
    weight: string;
    size: string;
}

const SHIELD_STATE_ATTRIBUTE = 'data-hmi-shield-state';
const FONT_CHECK_TOKENS: FontCheckToken[] = [
    {
        family: '--font-system',
        weight: '--font-weight-system',
        size: '--font-size-system',
    },
    {
        family: '--font-mono',
        weight: '--font-weight-mono',
        size: '--font-size-mono',
    },
    {
        family: '--font-dashboard-title',
        weight: '--font-weight-dashboard-title',
        size: '--font-size-dashboard-title',
    },
];
const SHIELD_SHELL_ATTRIBUTE = 'data-hmi-shield-shell';
const SHIELD_TYPEWRITER_ATTRIBUTE = 'data-hmi-shield-typewriter';
const SHIELD_TYPED_ATTRIBUTE = 'data-hmi-shield-typed';
const SHIELD_CARET_ATTRIBUTE = 'data-hmi-shield-caret';

function normalizeFontFamilyValue(value: string): string {
    const primaryFamily = value.split(',')[0]?.trim() ?? '';

    if (!primaryFamily) {
        return '';
    }

    return primaryFamily.replace(/^(['"])(.*)\1$/, '$1$2$1');
}

function resolveFontCheck(token: FontCheckToken): string | null {
    if (!document.documentElement) {
        return null;
    }

    const style = getComputedStyle(document.documentElement);
    const family = normalizeFontFamilyValue(style.getPropertyValue(token.family).trim());
    const weight = style.getPropertyValue(token.weight).trim() || '400';
    const size = style.getPropertyValue(token.size).trim() || '16px';

    if (!family) {
        return null;
    }

    return `${weight} ${size} ${family}`;
}

export function getRequiredFontChecks(): string[] {
    return FONT_CHECK_TOKENS
        .map(resolveFontCheck)
        .filter((font): font is string => font !== null);
}

function getBootShield(): HTMLElement | null {
    return document.getElementById(BOOT_SHIELD_ID);
}

function createShieldTypewriter(): HTMLSpanElement {
    const typewriter = document.createElement('span');
    typewriter.setAttribute(SHIELD_TYPEWRITER_ATTRIBUTE, 'true');

    const typed = document.createElement('span');
    typed.setAttribute(SHIELD_TYPED_ATTRIBUTE, 'true');
    typed.textContent = BOOT_SHIELD_MESSAGE;

    const caret = document.createElement('span');
    caret.setAttribute(SHIELD_CARET_ATTRIBUTE, 'true');
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '_';

    typewriter.replaceChildren(typed, caret);
    return typewriter;
}

function createShieldShell(): HTMLDivElement {
    const shell = document.createElement('div');
    shell.setAttribute(SHIELD_SHELL_ATTRIBUTE, 'true');
    shell.replaceChildren(createShieldTypewriter());
    return shell;
}

function normalizeBootShieldContent(shield: HTMLElement): void {
    const shell = shield.querySelector<HTMLElement>(`[${SHIELD_SHELL_ATTRIBUTE}]`);
    const typewriter = shield.querySelector<HTMLElement>(`[${SHIELD_TYPEWRITER_ATTRIBUTE}]`);
    const typed = shield.querySelector<HTMLElement>(`[${SHIELD_TYPED_ATTRIBUTE}]`);
    const caret = shield.querySelector<HTMLElement>(`[${SHIELD_CARET_ATTRIBUTE}]`);
    const hasExpectedTypewriter = typewriter
        && typewriter.tagName === 'SPAN'
        && typewriter.childElementCount === 2
        && typed?.parentElement === typewriter
        && typed.textContent === BOOT_SHIELD_MESSAGE
        && caret?.parentElement === typewriter
        && caret.textContent === '_'
        && caret.getAttribute('aria-hidden') === 'true';

    if (shell && shell.childElementCount === 1 && hasExpectedTypewriter && shield.childElementCount === 1) {
        return;
    }

    shield.replaceChildren(createShieldShell());
}

export function revealBootShield(shield: HTMLElement | null = getBootShield()): void {
    if (!shield) {
        return;
    }

    normalizeBootShieldContent(shield);
    shield.classList.remove(BOOT_SHIELD_HIDDEN_CLASS);
    shield.setAttribute(SHIELD_STATE_ATTRIBUTE, 'visible');
    shield.removeAttribute('aria-hidden');
    shield.removeAttribute('inert');
}

export function hideBootShield(shield: HTMLElement): void {
    shield.classList.add(BOOT_SHIELD_HIDDEN_CLASS);
    shield.setAttribute(SHIELD_STATE_ATTRIBUTE, 'hidden');
    shield.setAttribute('aria-hidden', 'true');
    shield.setAttribute('inert', '');
}

function getShaderCanvas(): HTMLElement | null {
    return document.querySelector<HTMLElement>(SHADER_CANVAS_SELECTOR);
}

function isShaderReady(canvas: Element | null): boolean {
    return canvas?.getAttribute(SHADER_READY_ATTRIBUTE) === 'true';
}

async function waitForFontsReady(): Promise<void> {
    const fonts = (document as FontsReadyDocument).fonts;

    if (!fonts?.ready) {
        return;
    }

    try {
        await fonts.ready;
    } catch {
        // Ignore font subsystem failures — the shield timeout remains the safety net.
    }
}

export function areRequiredFontsReady(): boolean {
    const fonts = (document as FontsReadyDocument).fonts;

    if (!fonts?.check) {
        return true;
    }

    const requiredFontChecks = getRequiredFontChecks();

    if (requiredFontChecks.length === 0) {
        return true;
    }

    return requiredFontChecks.every((font) => fonts.check?.(font) ?? true);
}

function waitForDelay(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        window.setTimeout(resolve, delayMs);
    });
}

async function waitForRequiredFonts(deadline: number): Promise<void> {
    while (!areRequiredFontsReady() && Date.now() < deadline) {
        await waitForDelay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
}

async function waitForShaderReady(): Promise<void> {
    const shaderCanvas = getShaderCanvas();

    if (!shaderCanvas || isShaderReady(shaderCanvas)) {
        return;
    }

    await new Promise<void>((resolve) => {
        const handleFirstDraw = (event: Event) => {
            const target = event.target;

            if (!(target instanceof Element) || !target.matches(SHADER_CANVAS_SELECTOR)) {
                return;
            }

            document.removeEventListener(WEBGL_FIRST_DRAW_EVENT, handleFirstDraw);
            resolve();
        };

        document.addEventListener(WEBGL_FIRST_DRAW_EVENT, handleFirstDraw);

        if (isShaderReady(shaderCanvas)) {
            document.removeEventListener(WEBGL_FIRST_DRAW_EVENT, handleFirstDraw);
            resolve();
        }
    });
}

export function useBootShield(): void {
    useEffect(() => {
        const shield = getBootShield();

        if (!shield || shield.classList.contains(BOOT_SHIELD_HIDDEN_CLASS)) {
            return;
        }

        normalizeBootShieldContent(shield);

        let isActive = true;
        let readinessTimeoutId = 0;
        let transitionTimeoutId = 0;
        const scheduledRafIds: number[] = [];
        const mountedAt = Date.now();

        const clearReadinessTimeout = () => {
            if (readinessTimeoutId) {
                window.clearTimeout(readinessTimeoutId);
                readinessTimeoutId = 0;
            }
        };

        const completeHideTransition = () => {
            if (transitionTimeoutId) {
                window.clearTimeout(transitionTimeoutId);
                transitionTimeoutId = 0;
            }
        };

        const finalizeHide = () => {
            if (!isActive || !shield.isConnected || shield.classList.contains(BOOT_SHIELD_HIDDEN_CLASS)) {
                return;
            }

            const handleTransitionEnd = (event: Event) => {
                if (event.target !== shield) {
                    return;
                }

                shield.removeEventListener('transitionend', handleTransitionEnd);
                completeHideTransition();
            };

            shield.addEventListener('transitionend', handleTransitionEnd);
            hideBootShield(shield);

            transitionTimeoutId = window.setTimeout(() => {
                shield.removeEventListener('transitionend', handleTransitionEnd);
                completeHideTransition();
            }, BOOT_SHIELD_TRANSITION_FALLBACK_MS);
        };

        const deadline = Date.now() + BOOT_SHIELD_TIMEOUT_MS;

        const raceWithRemainingTimeout = async (work: Promise<void>): Promise<boolean> => {
            const remaining = Math.max(0, deadline - Date.now());

            if (remaining === 0) {
                return false;
            }

            const didComplete = await Promise.race<boolean>([
                work.then(() => true),
                new Promise<boolean>((resolve) => {
                    readinessTimeoutId = window.setTimeout(() => {
                        readinessTimeoutId = 0;
                        resolve(false);
                    }, remaining);
                }),
            ]);

            clearReadinessTimeout();
            return didComplete;
        };

        const waitForStablePaint = () => new Promise<void>((resolve) => {
            const scheduleFrame = (remainingFrames: number) => {
                const rafId = window.requestAnimationFrame(() => {
                    if (remainingFrames <= 1) {
                        resolve();
                        return;
                    }

                    scheduleFrame(remainingFrames - 1);
                });

                scheduledRafIds.push(rafId);
            };

            scheduleFrame(BOOT_SHIELD_STABLE_FRAME_COUNT);
        });

        void (async () => {
            const deadline = mountedAt + BOOT_SHIELD_TIMEOUT_MS;
            const fontsReady = await raceWithRemainingTimeout((async () => {
                await waitForFontsReady();
                await waitForRequiredFonts(deadline);
            })());

            if (!isActive) {
                return;
            }

            if (!fontsReady) {
                finalizeHide();
                return;
            }

            const shaderReady = await raceWithRemainingTimeout(waitForShaderReady());

            if (!isActive) {
                return;
            }

            if (!shaderReady) {
                finalizeHide();
                return;
            }

            const paintReady = await raceWithRemainingTimeout(waitForStablePaint());

            if (!isActive) {
                return;
            }

            if (!paintReady) {
                finalizeHide();
                return;
            }

            const minimumVisibleTimeReady = await raceWithRemainingTimeout(
                waitForDelay(Math.max(0, BOOT_SHIELD_MIN_VISIBLE_MS - (Date.now() - mountedAt))),
            );

            if (!isActive) {
                return;
            }

            if (!minimumVisibleTimeReady) {
                finalizeHide();
                return;
            }

            finalizeHide();
        })();

        return () => {
            isActive = false;
            clearReadinessTimeout();

            if (transitionTimeoutId) {
                window.clearTimeout(transitionTimeoutId);
            }

            for (const rafId of scheduledRafIds) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, []);
}
