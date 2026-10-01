import { useEffect, useRef } from 'react';

import { LEDA_EVENTS_STREAM_URL, LEDA_EVENTS_URL } from '../config/ledaAssistant.config';
import type { VoiceEvent } from '../domain/voice.types';
import { startVoiceEventListener } from '../services/voiceEventListener.service';

export function useVoiceEventListener(onEvent: (event: VoiceEvent) => void): void {
    const onEventRef = useRef(onEvent);

    useEffect(() => {
        onEventRef.current = onEvent;
    }, [onEvent]);

    useEffect(() => startVoiceEventListener({
        url: LEDA_EVENTS_URL,
        streamUrl: LEDA_EVENTS_STREAM_URL,
        onEvent: (event) => onEventRef.current(event),
    }), []);
}
