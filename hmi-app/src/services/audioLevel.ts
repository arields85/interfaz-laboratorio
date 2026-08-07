export interface AudioLevelPolicy {
    noiseFloor: number;
    gain: number;
    attack: number;
    release: number;
}

export const DEFAULT_AUDIO_LEVEL_POLICY: Readonly<AudioLevelPolicy> = {
    noiseFloor: 0.015,
    gain: 4,
    attack: 0.65,
    release: 0.2,
};

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(1, Math.max(0, value));
}

export function calculateRms(samples: Float32Array): number {
    let sumSquares = 0;
    let finiteSamples = 0;

    for (const sample of samples) {
        if (!Number.isFinite(sample)) {
            continue;
        }

        sumSquares += sample * sample;
        finiteSamples += 1;
    }

    return finiteSamples === 0 ? 0 : Math.sqrt(sumSquares / finiteSamples);
}

export function normalizeAudioLevel(
    rms: number,
    previousLevel: number,
    policy: AudioLevelPolicy = DEFAULT_AUDIO_LEVEL_POLICY,
): number {
    const safeRms = Number.isFinite(rms) ? Math.max(0, rms) : 0;
    const safePrevious = clampUnit(previousLevel);
    const normalized = clampUnit((safeRms - Math.max(0, policy.noiseFloor)) * Math.max(0, policy.gain));
    const smoothing = normalized >= safePrevious ? policy.attack : policy.release;

    return clampUnit(safePrevious + (normalized - safePrevious) * clampUnit(smoothing));
}
