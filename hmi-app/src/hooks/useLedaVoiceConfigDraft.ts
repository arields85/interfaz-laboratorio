import { useCallback, useState } from 'react';

import {
    areLedaVoiceConfigsEqual,
    cloneLedaVoiceConfig,
    createDefaultLedaVoiceConfig,
    type LedaRoboticVoiceConfig,
    type LedaVoiceConfig,
    type LedaVoicePlaybackBufferConfig,
} from '../domain/ledaVoiceConfig';

type LedaVoiceScalarKey = Exclude<keyof LedaVoiceConfig, 'robotic' | 'playbackBuffer'>;

function rebaseDraft(
    sentSnapshot: LedaVoiceConfig,
    currentDraft: LedaVoiceConfig,
    remoteConfig: LedaVoiceConfig,
): LedaVoiceConfig {
    const robotic = { ...remoteConfig.robotic };
    for (const key of Object.keys(robotic) as Array<keyof LedaRoboticVoiceConfig>) {
        if (currentDraft.robotic[key] !== sentSnapshot.robotic[key]) {
            robotic[key] = currentDraft.robotic[key];
        }
    }

    // Field-by-field like the top-level scalars below (not the generic
    // per-key loop `robotic` uses above): `LedaVoicePlaybackBufferConfig`
    // mixes a string-union `mode` with a numeric `manualSeconds`, so a
    // single indexed assignment across both keys does not type-check.
    const playbackBuffer: LedaVoicePlaybackBufferConfig = {
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

export function useLedaVoiceConfigDraft(initialConfig?: LedaVoiceConfig) {
    const createInitialConfig = () => initialConfig
        ? cloneLedaVoiceConfig(initialConfig)
        : createDefaultLedaVoiceConfig();
    const [state, setState] = useState(() => ({
        committed: createInitialConfig(),
        draft: createInitialConfig(),
        baselineGeneration: 0,
        acceptsRemoteInitialization: true,
    }));

    const updateField = <Key extends LedaVoiceScalarKey>(
        key: Key,
        value: LedaVoiceConfig[Key],
    ) => {
        setState((current) => ({
            ...current,
            draft: { ...current.draft, [key]: value },
            acceptsRemoteInitialization: false,
        }));
    };

    const updateRoboticField = <Key extends keyof LedaRoboticVoiceConfig>(
        key: Key,
        value: LedaRoboticVoiceConfig[Key],
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

    const updatePlaybackBufferField = <Key extends keyof LedaVoicePlaybackBufferConfig>(
        key: Key,
        value: LedaVoicePlaybackBufferConfig[Key],
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
            committed: cloneLedaVoiceConfig(current.draft),
        }));
    };

    const initializeFromRemote = useCallback((config: LedaVoiceConfig) => {
        setState((current) => {
            if (!current.acceptsRemoteInitialization) {
                return current;
            }

            return {
                committed: cloneLedaVoiceConfig(config),
                draft: cloneLedaVoiceConfig(config),
                baselineGeneration: current.baselineGeneration + 1,
                acceptsRemoteInitialization: true,
            };
        });
    }, []);

    const commitRemote = useCallback((
        sentSnapshot: LedaVoiceConfig,
        remoteConfig: LedaVoiceConfig,
        resetAdvancedValues = true,
    ) => {
        setState((current) => ({
            committed: cloneLedaVoiceConfig(remoteConfig),
            draft: rebaseDraft(sentSnapshot, current.draft, remoteConfig),
            baselineGeneration: current.baselineGeneration + (resetAdvancedValues ? 1 : 0),
            acceptsRemoteInitialization: false,
        }));
    }, []);

    return {
        draft: state.draft,
        isDirty: !areLedaVoiceConfigsEqual(state.draft, state.committed),
        baselineGeneration: state.baselineGeneration,
        updateField,
        updateRoboticField,
        updatePlaybackBufferField,
        commitDraft,
        commitRemote,
        initializeFromRemote,
    };
}
