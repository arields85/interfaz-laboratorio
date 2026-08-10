import { useCallback, useState } from 'react';

import {
    arePrismaVoiceConfigsEqual,
    clonePrismaVoiceConfig,
    createDefaultPrismaVoiceConfig,
    type PrismaRoboticVoiceConfig,
    type PrismaVoiceConfig,
} from '../domain/prismaVoiceConfig';

type PrismaVoiceScalarKey = Exclude<keyof PrismaVoiceConfig, 'robotic'>;

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
        commitDraft,
        commitRemote,
        initializeFromRemote,
    };
}
