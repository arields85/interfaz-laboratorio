import { useEffect } from 'react';
import { BOOT_SHIELD_ID, requestShieldReveal } from './useBootShield';

export const RELOAD_HIDE_SELECTOR = '[data-hmi-shader-canvas]';

const RELOAD_HIDDEN_ATTRIBUTE = 'data-hmi-reload-hidden';

export const reloadController = {
    reload(): void {
        window.location.reload();
    },
};

function isReloadShortcut(event: KeyboardEvent): boolean {
    if (event.key === 'F5') {
        return true;
    }

    const hasReloadModifier = event.ctrlKey || event.metaKey;

    return hasReloadModifier && event.key.toLowerCase() === 'r';
}

function hideReloadTargets(): HTMLElement[] {
    const targets = Array.from(document.querySelectorAll<HTMLElement>(RELOAD_HIDE_SELECTOR));

    for (const target of targets) {
        target.setAttribute(RELOAD_HIDDEN_ATTRIBUTE, 'true');
        target.style.visibility = 'hidden';
    }

    return targets;
}

function restoreReloadTargets(targets: HTMLElement[]): void {
    for (const target of targets) {
        target.removeAttribute(RELOAD_HIDDEN_ATTRIBUTE);
        target.style.removeProperty('visibility');
    }
}

export function useReloadShield(): void {
    useEffect(() => {
        let reloadScheduled = false;
        let reloadFrameId = 0;
        let hiddenTargets: HTMLElement[] = [];

        const handleKeydown = (event: KeyboardEvent) => {
            if (reloadScheduled || !event.cancelable || !isReloadShortcut(event)) {
                return;
            }

            if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
                return;
            }

            event.preventDefault();
            reloadScheduled = true;

            const shield = document.getElementById(BOOT_SHIELD_ID);
            requestShieldReveal({
                profileId: 'long',
                runner: 'original-long',
                allowNoContentExtension: true,
                restartCycle: true,
            }, shield);
            hiddenTargets = hideReloadTargets();

            reloadFrameId = window.requestAnimationFrame(() => {
                reloadController.reload();
            });
        };

        document.addEventListener('keydown', handleKeydown, true);

        return () => {
            document.removeEventListener('keydown', handleKeydown, true);

            if (reloadFrameId) {
                window.cancelAnimationFrame(reloadFrameId);
            }

            restoreReloadTargets(hiddenTargets);
        };
    }, []);
}
