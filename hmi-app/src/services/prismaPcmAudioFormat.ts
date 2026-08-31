export const PRISMA_PCM_AUDIO_FORMAT = {
    encoding: 'pcm_s16le',
    sampleRate: 24_000,
    channels: 1,
    bytesPerSample: Int16Array.BYTES_PER_ELEMENT,
} as const;
