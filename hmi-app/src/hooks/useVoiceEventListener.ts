import { useEffect, useRef } from 'react';

import { PRISMA_EVENTS_URL } from '../config/prismaAssistant.config';
import type { VoiceEvent } from '../domain/voice.types';
import { startVoiceEventListener } from '../services/voiceEventListener.service';

export function useVoiceEventListener(onEvent: (event: VoiceEvent) => void): void {
    const onEventRef = useRef(onEvent);

    useEffect(() => {
        onEventRef.current = onEvent;
    }, [onEvent]);

    useEffect(() => startVoiceEventListener({
        url: PRISMA_EVENTS_URL,
        onEvent: (event) => onEventRef.current(event),
    }), []);
}
