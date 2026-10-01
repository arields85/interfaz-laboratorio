import { LEDA_TTS_LIVE_URL } from '../config/ledaAssistant.config';
import type { LedaVoiceAudioSource } from './ledaVoiceAudioEngine';
import { LEDA_PCM_AUDIO_FORMAT } from './ledaPcmAudioFormat';
import { ledaSessionClient } from './ledaSessionClient';
import {
    recordSpeakLiveRequestStart,
    recordSpeakLiveResponseReceived,
    recordSpeakLiveStaleDiscarded,
} from './ledaVoiceTimelineRecorder';

export interface LedaVoiceTtsAudioRequest {
    eventId: string;
}

export type LedaVoiceAudioSourceFactory = (
    request: LedaVoiceTtsAudioRequest,
) => LedaVoiceAudioSource;

const LIVE_AUDIO_FORMAT = LEDA_PCM_AUDIO_FORMAT.encoding;
const LIVE_SAMPLE_RATE = LEDA_PCM_AUDIO_FORMAT.sampleRate;
const LIVE_CHANNELS = LEDA_PCM_AUDIO_FORMAT.channels;

export function createLedaVoiceTtsAudioSource(
    request: LedaVoiceTtsAudioRequest,
    fetchImpl?: typeof fetch,
): LedaVoiceAudioSource {
    return {
        async openLive(signal) {
            const eventId = request.eventId.trim();
            if (!eventId) {
                throw new Error('Leda voice event ID is required');
            }
            const requestStartedAt = performance.now();
            recordSpeakLiveRequestStart();
            const response = await (fetchImpl ?? ledaSessionClient.fetch.bind(ledaSessionClient))(LEDA_TTS_LIVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId }),
                cache: 'no-store',
                signal,
            });
            const responseElapsedMs = Math.max(0, performance.now() - requestStartedAt);
            recordSpeakLiveResponseReceived(response.status, responseElapsedMs);
            if (!response.ok) {
                throw new Error(`Leda Live request failed with status ${response.status}`);
            }
            if (fetchImpl === undefined && !ledaSessionClient.isCurrentResponse(response)) {
                recordSpeakLiveStaleDiscarded(responseElapsedMs);
                throw new Error('Leda Live response belongs to a stale session');
            }
            if (response.headers.get('X-Leda-Audio-Format')?.toLowerCase() !== LIVE_AUDIO_FORMAT) {
                throw new Error('Leda Live response has invalid audio format');
            }
            if (Number(response.headers.get('X-Leda-Sample-Rate')) !== LIVE_SAMPLE_RATE) {
                throw new Error('Leda Live response has invalid sample rate');
            }
            if (Number(response.headers.get('X-Leda-Channels')) !== LIVE_CHANNELS) {
                throw new Error('Leda Live response has invalid channels');
            }
            if (!response.body) {
                throw new Error('Leda Live response has no readable body');
            }

            return {
                reader: response.body.getReader(),
                sampleRate: LIVE_SAMPLE_RATE,
                channels: LIVE_CHANNELS,
            };
        },
    };
}
