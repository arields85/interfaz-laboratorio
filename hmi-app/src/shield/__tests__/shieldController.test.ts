import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLoaderOptionsConfig, saveLoaderOptionsConfig } from '../../config/loaderOptions.config';
import * as bootShieldModule from '../../hooks/useBootShield';
import { DEFAULT_PROFILE, SHIELD_PROFILES } from '../shieldProfiles';
import { SHIELD_PROFILE_CHANGE_EVENT, shieldController } from '../shieldController';
import type { ShieldRevealRequest } from '../shieldEvents';

function mountShield() {
    document.body.innerHTML = `
        <div id="hmi-shield" data-hmi-shield-state="hidden">
            <div data-hmi-shield-shell>
                <span data-hmi-shield-typewriter>
                    <span data-hmi-shield-typed>ACTUALIZANDO DATOS</span><span data-hmi-shield-caret aria-hidden="true">_</span>
                </span>
                <div data-hmi-shield-cursor-loader>
                    <span data-hmi-shield-trail="g5" aria-hidden="true"></span>
                    <span data-hmi-shield-trail="g4" aria-hidden="true"></span>
                    <span data-hmi-shield-trail="g3" aria-hidden="true"></span>
                    <span data-hmi-shield-trail="g2" aria-hidden="true"></span>
                    <span data-hmi-shield-trail="g1" aria-hidden="true"></span>
                    <span data-hmi-shield-trail="head" aria-hidden="true"></span>
                </div>
            </div>
        </div>
    `;

    return document.getElementById('hmi-shield') as HTMLDivElement;
}

function registerProfileChangeListener(eventSpy: ReturnType<typeof vi.fn<(event: CustomEvent<ShieldRevealRequest>) => void>>) {
    const listener: EventListener = (event) => {
        eventSpy(event as CustomEvent<ShieldRevealRequest>);
    };

    document.addEventListener(SHIELD_PROFILE_CHANGE_EVENT, listener);
    return listener;
}

describe('shieldController', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
        localStorage.clear();
        window.history.replaceState({}, '', '/');
    });

    it('applies profile attributes, css variables, text, and short class', () => {
        const shield = mountShield();

        shieldController.applyProfile(shield, 'short');

        expect(SHIELD_PROFILES.short.typingDurationMs).toBe(320);
        expect(SHIELD_PROFILES.short.typingDelayMs).toBe(300);
        expect(SHIELD_PROFILES.short.caretBlinkDelayMs).toBe(620);
        expect(shield.dataset.hmiShieldProfile).toBe('short');
        expect(shield).toHaveClass('hmi-shield--profile-short');
        expect(shield.style.getPropertyValue('--hmi-shield-short-shell-width')).toBe(`${SHIELD_PROFILES.short.shellWidthCh}ch`);
        expect(shield.style.getPropertyValue('--hmi-shield-short-typing-duration')).toBe(`${SHIELD_PROFILES.short.typingDurationMs}ms`);
        expect(shield.style.getPropertyValue('--hmi-shield-short-typing-delay')).toBe(`${SHIELD_PROFILES.short.typingDelayMs}ms`);
        expect(shield.style.getPropertyValue('--hmi-shield-short-caret-blink-delay')).toBe(`${SHIELD_PROFILES.short.caretBlinkDelayMs}ms`);
        expect(shield.querySelector('[data-hmi-shield-short-typed]')).toHaveTextContent(SHIELD_PROFILES.short.message);
        expect(shield.querySelector('[data-hmi-shield-cursor-loader]')).toBeNull();
    });

    it('is idempotent for the same profile and swaps the visual root between long and short markup', () => {
        const shield = mountShield();

        shieldController.applyProfile(shield, 'long');
        const firstShell = shield.querySelector('[data-hmi-shield-shell]');
        const firstTypewriter = shield.querySelector('[data-hmi-shield-typewriter]');
        const firstCursorLoader = shield.querySelector('[data-hmi-shield-cursor-loader]');

        shieldController.applyProfile(shield, 'long');
        expect(shield.querySelector('[data-hmi-shield-shell]')).toBe(firstShell);
        expect(shield.querySelector('[data-hmi-shield-typewriter]')).toBe(firstTypewriter);
        expect(shield.querySelector('[data-hmi-shield-cursor-loader]')).toBe(firstCursorLoader);

        shieldController.applyProfile(shield, 'short');
        const shortShell = shield.querySelector('[data-hmi-shield-short-shell]');
        expect(shortShell).not.toBeNull();
        expect(shortShell).not.toBe(firstShell);
        expect(shield.querySelector('[data-hmi-shield-short-typewriter]')).not.toBe(firstTypewriter);
        expect(shield.querySelector('[data-hmi-shield-short-typed]')).toHaveTextContent(SHIELD_PROFILES.short.message);
        expect(shield.querySelector('[data-hmi-shield-cursor-loader]')).toBeNull();

        shieldController.applyProfile(shield, 'long');
        expect(shield.querySelector('[data-hmi-shield-shell]')).not.toBeNull();
        expect(shield.querySelector('[data-hmi-shield-typed]')).toHaveTextContent(SHIELD_PROFILES.long.message);
        expect(shield.querySelectorAll('[data-hmi-shield-trail]')).toHaveLength(6);
        expect(shield.querySelector('[data-hmi-shield-short-shell]')).toBeNull();
    });

    it('reveals long with the final original-long request contract and no compatibility fields', () => {
        const revealSpy = vi.spyOn(bootShieldModule, 'revealBootShield').mockImplementation(() => undefined);
        const eventSpy = vi.fn<(event: CustomEvent<ShieldRevealRequest>) => void>();
        const listener = registerProfileChangeListener(eventSpy);

        mountShield();
        shieldController.revealWithProfile('long');

        expect(revealSpy).toHaveBeenCalledTimes(1);
        expect(eventSpy).toHaveBeenCalledTimes(1);
        expect(eventSpy.mock.calls[0]?.[0].detail).toMatchObject({
            profileId: 'long',
            runner: 'original-long',
            allowNoContentExtension: false,
            restartCycle: true,
            changed: false,
        });
        expect(eventSpy.mock.calls[0]?.[0].detail).not.toHaveProperty('waitForViewerReady');
        expect(shieldController.getActiveProfile()).toBe('long');
        expect(shieldController.getProfileConfig(DEFAULT_PROFILE)).toEqual(SHIELD_PROFILES.long);

        document.removeEventListener(SHIELD_PROFILE_CHANGE_EVENT, listener);
    });

    it('allows explicit long no-content extension without reviving compatibility fields', () => {
        const eventSpy = vi.fn<(event: CustomEvent<ShieldRevealRequest>) => void>();
        const listener = registerProfileChangeListener(eventSpy);

        mountShield();
        shieldController.revealWithProfile('long', { allowNoContentExtension: true });

        expect(eventSpy).toHaveBeenCalledTimes(1);
        expect(eventSpy.mock.calls[0]?.[0].detail).toMatchObject({
            profileId: 'long',
            runner: 'original-long',
            allowNoContentExtension: true,
            restartCycle: true,
            changed: false,
        });
        expect(eventSpy.mock.calls[0]?.[0].detail).not.toHaveProperty('waitForViewerReady');

        document.removeEventListener(SHIELD_PROFILE_CHANGE_EVENT, listener);
    });

    it('reveals short as an isolated fast-path request even when the caller asks for long-only extension', () => {
        const eventSpy = vi.fn<(event: CustomEvent<ShieldRevealRequest>) => void>();
        const listener = registerProfileChangeListener(eventSpy);

        mountShield();
        shieldController.revealWithProfile('short', { allowNoContentExtension: true });

        expect(eventSpy).toHaveBeenCalledTimes(1);
        expect(eventSpy.mock.calls[0]?.[0].detail).toMatchObject({
            profileId: 'short',
            runner: 'short',
            allowNoContentExtension: false,
            restartCycle: true,
            changed: true,
        });

        document.removeEventListener(SHIELD_PROFILE_CHANGE_EVENT, listener);
    });

    it('ignores duplicate reveal requests for the same visible profile without restarting the lifecycle', () => {
        const revealSpy = vi.spyOn(bootShieldModule, 'revealBootShield');
        const eventSpy = vi.fn<(event: CustomEvent<ShieldRevealRequest>) => void>();
        const listener = registerProfileChangeListener(eventSpy);

        mountShield();

        shieldController.revealWithProfile('long');
        shieldController.revealWithProfile('long');

        expect(revealSpy).toHaveBeenCalledTimes(1);
        expect(eventSpy).toHaveBeenCalledTimes(1);

        document.removeEventListener(SHIELD_PROFILE_CHANGE_EVENT, listener);
    });

    it('captures the runtime duration snapshot per future request', () => {
        const eventSpy = vi.fn<(event: CustomEvent<ShieldRevealRequest>) => void>();
        const shield = mountShield();
        const listener = registerProfileChangeListener(eventSpy);

        saveLoaderOptionsConfig({
            short: { enabled: true, durationSeconds: 2 },
            long: { enabled: true, durationSeconds: 5 },
        });

        shieldController.revealWithProfile('long');

        saveLoaderOptionsConfig({
            short: { enabled: true, durationSeconds: 2 },
            long: { enabled: true, durationSeconds: 9 },
        });

        shield.setAttribute('data-hmi-shield-state', 'hidden');
        shield.classList.add('hmi-shield--hidden');
        shieldController.revealWithProfile('long');

        expect(eventSpy).toHaveBeenCalledTimes(2);
        expect(eventSpy.mock.calls[0]?.[0].detail.resolvedMinVisibleMs).toBe(5_000);
        expect(eventSpy.mock.calls[1]?.[0].detail.resolvedMinVisibleMs).toBe(9_000);

        document.removeEventListener(SHIELD_PROFILE_CHANGE_EVENT, listener);
        clearLoaderOptionsConfig();
    });

    it('skips visualization immediately when the runtime profile is disabled', () => {
        const revealSpy = vi.spyOn(bootShieldModule, 'revealBootShield').mockImplementation(() => undefined);
        const eventSpy = vi.fn<(event: CustomEvent<ShieldRevealRequest>) => void>();
        const listener = registerProfileChangeListener(eventSpy);

        mountShield();
        saveLoaderOptionsConfig({
            short: { enabled: false, durationSeconds: 2 },
            long: { enabled: true, durationSeconds: 8 },
        });

        expect(shieldController.revealWithProfile('short')).toBe(false);
        expect(revealSpy).not.toHaveBeenCalled();
        expect(eventSpy).not.toHaveBeenCalled();

        document.removeEventListener(SHIELD_PROFILE_CHANGE_EVENT, listener);
        clearLoaderOptionsConfig();
    });
});
