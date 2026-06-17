import type { ShieldProfileId } from './shieldProfiles';

export const SHIELD_PROFILE_CHANGE_EVENT = 'hmi-shield-profile-change';

export type ShieldRunner = 'original-long' | 'short';

export interface ShieldRevealRequest {
    profileId: ShieldProfileId;
    runner: ShieldRunner;
    allowNoContentExtension: boolean;
    resolvedMinVisibleMs?: number;
    changed?: boolean;
    restartCycle?: boolean;
}

export type ShieldProfileChangeDetail = ShieldRevealRequest;
