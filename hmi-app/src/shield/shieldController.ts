import { resolveRuntimeLoaderRequest } from '../config/loaderOptions.config';
import { BOOT_SHIELD_ID, normalizeBootShieldContent, revealBootShield } from '../hooks/useBootShield';
import { SHIELD_PROFILE_CHANGE_EVENT, type ShieldProfileChangeDetail, type ShieldRunner } from './shieldEvents';
import { logShieldDebug, logShieldDebugFromShield } from './shieldDebug';
import { DEFAULT_PROFILE, SHIELD_PROFILES, type ShieldProfile, type ShieldProfileId } from './shieldProfiles';

const SHIELD_PROFILE_ATTRIBUTE = 'data-hmi-shield-profile';
const SHIELD_STATE_ATTRIBUTE = 'data-hmi-shield-state';
const SHORT_PROFILE_CLASS = 'hmi-shield--profile-short';
const SHORT_SHELL_WIDTH_VARIABLE = '--hmi-shield-short-shell-width';
const SHORT_TYPING_DURATION_VARIABLE = '--hmi-shield-short-typing-duration';
const SHORT_TYPING_DELAY_VARIABLE = '--hmi-shield-short-typing-delay';
const SHORT_CARET_BLINK_DELAY_VARIABLE = '--hmi-shield-short-caret-blink-delay';

function getShield(): HTMLElement | null {
    return document.getElementById(BOOT_SHIELD_ID);
}

function applyProfileVariables(shield: HTMLElement, profile: ShieldProfile): void {
    if (profile.id === 'short') {
        shield.style.setProperty(SHORT_SHELL_WIDTH_VARIABLE, `${profile.shellWidthCh}ch`);
        shield.style.setProperty(SHORT_TYPING_DURATION_VARIABLE, `${profile.typingDurationMs}ms`);
        shield.style.setProperty(SHORT_TYPING_DELAY_VARIABLE, `${profile.typingDelayMs}ms`);
        shield.style.setProperty(SHORT_CARET_BLINK_DELAY_VARIABLE, `${profile.caretBlinkDelayMs}ms`);
        return;
    }

    shield.style.removeProperty(SHORT_SHELL_WIDTH_VARIABLE);
    shield.style.removeProperty(SHORT_TYPING_DURATION_VARIABLE);
    shield.style.removeProperty(SHORT_TYPING_DELAY_VARIABLE);
    shield.style.removeProperty(SHORT_CARET_BLINK_DELAY_VARIABLE);
}

function isShieldVisible(shield: HTMLElement): boolean {
    return shield.getAttribute(SHIELD_STATE_ATTRIBUTE) !== 'hidden' && !shield.classList.contains('hmi-shield--hidden');
}

function resolveRunner(profileId: ShieldProfileId): ShieldRunner {
    return profileId === 'long' ? 'original-long' : 'short';
}

function resolveAllowNoContentExtension(
    profileId: ShieldProfileId,
    options?: { allowNoContentExtension?: boolean },
): boolean {
    if (profileId === 'short') {
        return false;
    }

    if (typeof options?.allowNoContentExtension === 'boolean') {
        return options.allowNoContentExtension;
    }

    return false;
}

export const shieldController = {
    applyProfile(shield: HTMLElement, profileId: ShieldProfileId): void {
        const profile = SHIELD_PROFILES[profileId];
        const activeProfile = shield.getAttribute(SHIELD_PROFILE_ATTRIBUTE) as ShieldProfileId | null;
        const typed = shield.querySelector('[data-hmi-shield-typed]');

        if (activeProfile === profileId && typed?.textContent === profile.message) {
            applyProfileVariables(shield, profile);
            shield.classList.toggle(SHORT_PROFILE_CLASS, profileId === 'short');
            logShieldDebugFromShield('shield:profile-applied', shield, { detail: 'idempotent-profile-refresh' });
            return;
        }

        shield.setAttribute(SHIELD_PROFILE_ATTRIBUTE, profileId);
        shield.classList.toggle(SHORT_PROFILE_CLASS, profileId === 'short');
        applyProfileVariables(shield, profile);
        normalizeBootShieldContent(shield, { profileId, message: profile.message });
        logShieldDebugFromShield('shield:profile-applied', shield);
    },

    revealWithProfile(
        profileId: ShieldProfileId,
        options?: { allowNoContentExtension?: boolean },
    ): boolean {
        const shield = getShield();
        const runner = resolveRunner(profileId);
        const allowNoContentExtension = resolveAllowNoContentExtension(profileId, options);
        const runtimeRequest = resolveRuntimeLoaderRequest(profileId);

        if (!shield) {
            logShieldDebug('shield:reveal-requested', {
                profile: profileId,
                detail: { runner, allowNoContentExtension, result: 'shield-missing', resolvedMinVisibleMs: runtimeRequest.minVisibleMs },
            });
            return false;
        }

        if (!runtimeRequest.enabled) {
            logShieldDebugFromShield('shield:reveal-request-skipped', shield, {
                profile: profileId,
                detail: { runner, allowNoContentExtension, reason: 'runtime-profile-disabled' },
            });
            return false;
        }

        logShieldDebugFromShield('shield:reveal-requested', shield, {
            profile: profileId,
            detail: { runner, allowNoContentExtension, resolvedMinVisibleMs: runtimeRequest.minVisibleMs },
        });

        const wasVisible = isShieldVisible(shield);
        const previousProfile = this.getActiveProfile();

        if (wasVisible && previousProfile === profileId) {
            logShieldDebugFromShield('shield:reveal-request-ignored', shield, {
                profile: profileId,
                detail: { runner, allowNoContentExtension, reason: 'already-visible-same-profile', resolvedMinVisibleMs: runtimeRequest.minVisibleMs },
            });
            return true;
        }

        this.applyProfile(shield, profileId);

        if (!wasVisible) {
            revealBootShield(shield, { profileId, message: SHIELD_PROFILES[profileId].message });
        }

        document.dispatchEvent(new CustomEvent<ShieldProfileChangeDetail>(SHIELD_PROFILE_CHANGE_EVENT, {
            detail: {
                profileId,
                runner,
                allowNoContentExtension,
                resolvedMinVisibleMs: runtimeRequest.minVisibleMs,
                changed: previousProfile !== profileId,
                restartCycle: !wasVisible,
            },
        }));
        logShieldDebugFromShield('shield:profile-change-event-dispatched', shield, {
            detail: { profileId, runner, allowNoContentExtension, resolvedMinVisibleMs: runtimeRequest.minVisibleMs, restartCycle: !wasVisible },
        });

        return true;
    },

    getActiveProfile(): ShieldProfileId {
        const profile = getShield()?.getAttribute(SHIELD_PROFILE_ATTRIBUTE);
        return profile === 'short' || profile === 'long' ? profile : DEFAULT_PROFILE;
    },

    getProfileConfig(profileId: ShieldProfileId): ShieldProfile {
        return SHIELD_PROFILES[profileId];
    },
};

export { SHIELD_PROFILE_CHANGE_EVENT };
