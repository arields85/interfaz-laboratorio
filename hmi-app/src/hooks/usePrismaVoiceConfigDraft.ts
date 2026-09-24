import { useCallback, useState } from 'react';

import {
    arePrismaVoiceConfigsEqual,
    clonePrismaVoiceConfig,
    createDefaultPrismaVoiceConfig,
    type PrismaRoboticVoiceConfig,
    type PrismaVoiceConfig,
    type PrismaVoicePlaybackBufferConfig,
} from '../domain/prismaVoiceConfig';

type PrismaVoiceScalarKey = Exclude<keyof PrismaVoiceConfig, 'robotic' | 'playbackBuffer'>;

function rebaseDraft(
    sentSnapshot: PrismaVoiceConfig,
    currentDraft: PrismaVoiceConfig,
    remoteConfig: PrismaVoiceConfig,
): PrismaVoiceConfig {
    const robotic = { ...remoteConfig.robotic };
    for (const key of Object.keys(robotic) as Array<keyof PrismaRoboticVoiceConfig>) {
        if (currentDraft.robotic[key] !== sentSnapshot.robotic[key]) {
            robotic[key] = currentDraft.robotic[key];
        }
    }

    // Field-by-field like the top-level scalars below (not the generic
    // per-key loop `robotic` uses above): `PrismaVoicePlaybackBufferConfig`
    // mixes a string-union `mode` with a numeric `manualSeconds`, so a
    // single indexed assignment across both keys does not type-check.
    const playbackBuffer: PrismaVoicePlaybackBufferConfig = {
        mode: currentDraft.playbackBuffer.mode !== sentSnapshot.playbackBuffer.mode
            ? currentDraft.playbackBuffer.mode
            : remoteConfig.playbackBuffer.mode,
        manualSeconds: currentDraft.playbackBuffer.manualSeconds !== sentSnapshot.playbackBuffer.manualSeconds
            ? currentDraft.playbackBuffer.manualSeconds
            : remoteConfig.playbackBuffer.manualSeconds,
    };

    return {
        effectEnabled: currentDraft.effectEnabled !== sentSnapshot.effectEnabled
            ? currentDraft.effectEnabled
            : remoteConfig.effectEnabled,
        preset: currentDraft.preset !== sentSnapshot.preset
            ? currentDraft.preset
            : remoteConfig.preset,
        effectIntensity: currentDraft.effectIntensity !== sentSnapshot.effectIntensity
            ? currentDraft.effectIntensity
            : remoteConfig.effectIntensity,
        robotic,
        playbackBuffer,
    };
}

export function usePrismaVoiceConfigDraft(initialConfig?: PrismaVoiceConfig) {
    const createInitialConfig = () => initialConfig
        ? clonePrismaVoiceConfig(initialConfig)
        : createDefaultPrismaVoiceConfig();
    const [state, setState] = useState(() => ({
        committed: createInitialConfig(),
        draft: createInitialConfig(),
        baselineGeneration: 0,
        acceptsRemoteInitialization: true,
    }));

    const updateField = <Key extends PrismaVoiceScalarKey>(
        key: Key,
        value: PrismaVoiceConfig[Key],
    ) => {
        setState((current) => ({
            ...current,
            draft: { ...current.draft, [key]: value },
            acceptsRemoteInitialization: false,
        }));
    };

    const updateRoboticField = <Key extends keyof PrismaRoboticVoiceConfig>(
        key: Key,
        value: PrismaRoboticVoiceConfig[Key],
    ) => {
        setState((current) => ({
            ...current,
            draft: {
                ...current.draft,
                robotic: { ...current.draft.robotic, [key]: value },
            },
            acceptsRemoteInitialization: false,
        }));
    };

    const updatePlaybackBufferField = <Key extends keyof PrismaVoicePlaybackBufferConfig>(
        key: Key,
        value: PrismaVoicePlaybackBufferConfig[Key],
    ) => {
        setState((current) => ({
            ...current,
            draft: {
                ...current.draft,
                playbackBuffer: { ...current.draft.playbackBuffer, [key]: value },
            },
            acceptsRemoteInitialization: false,
        }));
    };

    const commitDraft = () => {
        setState((current) => ({
            ...current,
            committed: clonePrismaVoiceConfig(current.draft),
        }));
    };

    const initializeFromRemote = useCallback((config: PrismaVoiceConfig) => {
        setState((current) => {
            if (!current.acceptsRemoteInitialization) {
                return current;
            }

            return {
                committed: clonePrismaVoiceConfig(config),
                draft: clonePrismaVoiceConfig(config),
                baselineGeneration: current.baselineGeneration + 1,
                acceptsRemoteInitialization: true,
            };
        });
    }, []);

    const commitRemote = useCallback((
        sentSnapshot: PrismaVoiceConfig,
        remoteConfig: PrismaVoiceConfig,
        resetAdvancedValues = true,
    ) => {
        setState((current) => ({
            committed: clonePrismaVoiceConfig(remoteConfig),
            draft: rebaseDraft(sentSnapshot, current.draft, remoteConfig),
            baselineGeneration: current.baselineGeneration + (resetAdvancedValues ? 1 : 0),
            acceptsRemoteInitialization: false,
        }));
    }, []);

    return {
        draft: state.draft,
        isDirty: !arePrismaVoiceConfigsEqual(state.draft, state.committed),
        baselineGeneration: state.baselineGeneration,
        updateField,
        updateRoboticField,
        updatePlaybackBufferField,
        commitDraft,
        commitRemote,
        initializeFromRemote,
    };
}
