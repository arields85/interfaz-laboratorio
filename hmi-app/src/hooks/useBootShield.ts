import { useEffect } from 'react';
import { isShieldContentReady, waitForShieldContentReady } from '../shield/shieldContentReadiness';
import { SHIELD_PROFILES } from '../shield/shieldProfiles';

export const BOOT_SHIELD_ID = 'hmi-shield';
export const BOOT_SHIELD_MESSAGE = 'ACTUALIZANDO DATOS';
export const BOOT_SHIELD_HIDDEN_CLASS = 'hmi-shield--hidden';
export const BOOT_SHIELD_MIN_VISIBLE_MS = SHIELD_PROFILES.long.minVisibleMs;
export const BOOT_SHIELD_SHORT_VISIBLE_MS = SHIELD_PROFILES.short.minVisibleMs;
export const BOOT_SHIELD_TIMEOUT_MS = 10000;
export const BOOT_SHIELD_TRANSITION_FALLBACK_MS = 300;
export const BOOT_SHIELD_STABLE_FRAME_COUNT = 4;
export const SHADER_CANVAS_SELECTOR = '[data-hmi-shader-canvas="true"]';
export const SHADER_READY_ATTRIBUTE = 'data-hmi-webgl-ready';
export const WEBGL_FIRST_DRAW_EVENT = 'webgl-first-draw';
export const SHIELD_REVEAL_REQUEST_EVENT = 'hmi-shield-profile-change';

export type ShieldRunner = 'original-long' | 'short';

export interface ShieldRevealRequest {
    profileId: 'long' | 'short';
    runner: ShieldRunner;
    allowNoContentExtension: boolean;
    restartCycle: boolean;
    changed?: boolean;
}

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
const SHIELD_CURSOR_LOADER_ATTRIBUTE = 'data-hmi-shield-cursor-loader';
const SHIELD_TRAIL_ATTRIBUTE = 'data-hmi-shield-trail';
const SHIELD_TRAIL_SEGMENTS = ['g5', 'g4', 'g3', 'g2', 'g1', 'head'] as const;

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

function createShieldTypewriter(message = BOOT_SHIELD_MESSAGE): HTMLSpanElement {
    const typewriter = document.createElement('span');
    typewriter.setAttribute(SHIELD_TYPEWRITER_ATTRIBUTE, 'true');

    const typed = document.createElement('span');
    typed.setAttribute(SHIELD_TYPED_ATTRIBUTE, 'true');
    typed.textContent = message;

    const caret = document.createElement('span');
    caret.setAttribute(SHIELD_CARET_ATTRIBUTE, 'true');
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '_';

    typewriter.replaceChildren(typed, caret);
    return typewriter;
}

function createShieldCursorLoader(): HTMLDivElement {
    const cursorLoader = document.createElement('div');
    cursorLoader.setAttribute(SHIELD_CURSOR_LOADER_ATTRIBUTE, 'true');

    cursorLoader.replaceChildren(...SHIELD_TRAIL_SEGMENTS.map((segment) => {
        const trail = document.createElement('span');
        trail.setAttribute(SHIELD_TRAIL_ATTRIBUTE, segment);
        trail.setAttribute('aria-hidden', 'true');
        return trail;
    }));

    return cursorLoader;
}

function createShieldShell(message = BOOT_SHIELD_MESSAGE): HTMLDivElement {
    const shell = document.createElement('div');
    shell.setAttribute(SHIELD_SHELL_ATTRIBUTE, 'true');
    shell.replaceChildren(createShieldTypewriter(message), createShieldCursorLoader());
    return shell;
}

export function normalizeBootShieldContent(
    shield: HTMLElement,
    options?: { message?: string },
): void {
    const message = options?.message ?? BOOT_SHIELD_MESSAGE;
    const shell = shield.querySelector<HTMLElement>(`[${SHIELD_SHELL_ATTRIBUTE}]`);
    const typewriter = shield.querySelector<HTMLElement>(`[${SHIELD_TYPEWRITER_ATTRIBUTE}]`);
    const typed = shield.querySelector<HTMLElement>(`[${SHIELD_TYPED_ATTRIBUTE}]`);
    const caret = shield.querySelector<HTMLElement>(`[${SHIELD_CARET_ATTRIBUTE}]`);
    const cursorLoader = shield.querySelector<HTMLElement>(`[${SHIELD_CURSOR_LOADER_ATTRIBUTE}]`);
    const hasExpectedTypewriter = typewriter
        && typewriter.tagName === 'SPAN'
        && typewriter.childElementCount === 2
        && typed?.parentElement === typewriter
        && typed.textContent === message
        && caret?.parentElement === typewriter
        && caret.textContent === '_'
        && caret.getAttribute('aria-hidden') === 'true';
    const hasExpectedCursorLoader = cursorLoader
        && cursorLoader.tagName === 'DIV'
        && cursorLoader.childElementCount === SHIELD_TRAIL_SEGMENTS.length
        && SHIELD_TRAIL_SEGMENTS.every((segment, index) => {
            const child = cursorLoader.children.item(index);

            return child instanceof HTMLSpanElement
                && child.getAttribute(SHIELD_TRAIL_ATTRIBUTE) === segment
                && child.getAttribute('aria-hidden') === 'true';
        });

    if (shell && shell.childElementCount === 2 && hasExpectedTypewriter && hasExpectedCursorLoader && shield.childElementCount === 1) {
        return;
    }

    shield.replaceChildren(createShieldShell(message));
}

export function revealBootShield(
    shield: HTMLElement | null = getBootShield(),
    options?: { message?: string },
): void {
    if (!shield) {
        return;
    }

    normalizeBootShieldContent(shield, options);
    shield.classList.remove(BOOT_SHIELD_HIDDEN_CLASS);
    shield.setAttribute(SHIELD_STATE_ATTRIBUTE, 'visible');
    shield.removeAttribute('aria-hidden');
    shield.removeAttribute('inert');
}

export function requestShieldReveal(
    request: ShieldRevealRequest,
    shield: HTMLElement | null = getBootShield(),
): void {
    if (shield) {
        revealBootShield(shield, { message: SHIELD_PROFILES[request.profileId].message });
    }

    document.dispatchEvent(new CustomEvent<ShieldRevealRequest>(SHIELD_REVEAL_REQUEST_EVENT, {
        detail: request,
    }));
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

        if (!shield) {
            return;
        }

        let isActive = true;
        let activeCycleId = 0;
        const scheduledTimeoutIds = new Set<number>();
        const scheduledRafIds: number[] = [];

        const trackTimeout = (callback: () => void, delayMs: number): number => {
            const timeoutId = window.setTimeout(() => {
                scheduledTimeoutIds.delete(timeoutId);
                callback();
            }, delayMs);

            scheduledTimeoutIds.add(timeoutId);
            return timeoutId;
        };

        const finalizeHide = (cycleId: number) => {
            if (!isActive || activeCycleId !== cycleId || !shield.isConnected || shield.classList.contains(BOOT_SHIELD_HIDDEN_CLASS)) {
                return;
            }

            const handleTransitionEnd = (event: Event) => {
                if (activeCycleId !== cycleId || event.target !== shield) {
                    return;
                }

                shield.removeEventListener('transitionend', handleTransitionEnd);
            };

            shield.addEventListener('transitionend', handleTransitionEnd);
            hideBootShield(shield);

            trackTimeout(() => {
                shield.removeEventListener('transitionend', handleTransitionEnd);
            }, BOOT_SHIELD_TRANSITION_FALLBACK_MS);
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

        const runReveal = (request: ShieldRevealRequest) => {
            activeCycleId += 1;
            const cycleId = activeCycleId;
            const mountedAt = Date.now();
            const deadline = mountedAt + BOOT_SHIELD_TIMEOUT_MS;

            revealBootShield(shield, { message: SHIELD_PROFILES[request.profileId].message });

            const raceWithRemainingTimeout = async (work: Promise<void>): Promise<boolean> => {
                const remaining = Math.max(0, deadline - Date.now());

                if (remaining === 0) {
                    return false;
                }

                return Promise.race<boolean>([
                    work.then(() => true),
                    new Promise<boolean>((resolve) => {
                        trackTimeout(() => resolve(false), remaining);
                    }),
                ]);
            };

            const ensureActive = () => isActive && activeCycleId === cycleId;

            if (request.runner === 'short') {
                void (async () => {
                    await waitForDelay(BOOT_SHIELD_SHORT_VISIBLE_MS);

                    if (!ensureActive()) {
                        return;
                    }

                    finalizeHide(cycleId);
                })();

                return;
            }
            void (async () => {
                const fontsReady = await raceWithRemainingTimeout((async () => {
                    await waitForFontsReady();
                    await waitForRequiredFonts(deadline);
                })());

                if (!ensureActive()) {
                    return;
                }

                if (!fontsReady) {
                    finalizeHide(cycleId);
                    return;
                }

                const shaderReady = await raceWithRemainingTimeout(waitForShaderReady());

                if (!ensureActive()) {
                    return;
                }

                if (!shaderReady) {
                    finalizeHide(cycleId);
                    return;
                }

                const paintReady = await raceWithRemainingTimeout(waitForStablePaint());

                if (!ensureActive()) {
                    return;
                }

                if (!paintReady) {
                    finalizeHide(cycleId);
                    return;
                }

                const minimumVisibleTimeReady = await raceWithRemainingTimeout(
                    waitForDelay(Math.max(0, BOOT_SHIELD_MIN_VISIBLE_MS - (Date.now() - mountedAt))),
                );

                if (!ensureActive()) {
                    return;
                }

                if (!minimumVisibleTimeReady) {
                    finalizeHide(cycleId);
                    return;
                }

                if (request.allowNoContentExtension && !isShieldContentReady()) {
                    await waitForShieldContentReady();

                    if (!ensureActive()) {
                        return;
                    }
                }

                finalizeHide(cycleId);
            })();
        };

        const handleRevealRequest = (event: Event) => {
            const request = (event as CustomEvent<ShieldRevealRequest>).detail;

            if (!request) {
                return;
            }

            runReveal(request);
        };

        document.addEventListener(SHIELD_REVEAL_REQUEST_EVENT, handleRevealRequest as EventListener);

        if (!shield.classList.contains(BOOT_SHIELD_HIDDEN_CLASS)) {
            runReveal({
                profileId: 'long',
                runner: 'original-long',
                allowNoContentExtension: false,
                restartCycle: true,
            });
        }

        return () => {
            isActive = false;
            document.removeEventListener(SHIELD_REVEAL_REQUEST_EVENT, handleRevealRequest as EventListener);

            for (const timeoutId of scheduledTimeoutIds) {
                window.clearTimeout(timeoutId);
            }

            for (const rafId of scheduledRafIds) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, []);
}
