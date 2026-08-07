import { useEffect, useRef, useState } from 'react';

import {
    DATA_CONNECTION_CONFIG_CHANGED_EVENT,
    getDataVoiceUrl,
} from '../config/dataConnection.config';
import type { VoiceEvent } from '../domain/voice.types';
import { startVoiceEventListener } from '../services/voiceEventListener.service';

export function useVoiceEventListener(onEvent: (event: VoiceEvent) => void): void {
    const onEventRef = useRef(onEvent);
    const [configRevision, setConfigRevision] = useState(0);

    useEffect(() => {
        onEventRef.current = onEvent;
    }, [onEvent]);

    useEffect(() => {
        const refreshConfig = () => {
            setConfigRevision((revision) => revision + 1);
        };

        window.addEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, refreshConfig);

        return () => {
            window.removeEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, refreshConfig);
        };
    }, []);

    useEffect(() => {
        return startVoiceEventListener({
            url: getDataVoiceUrl(),
            onEvent: (event) => onEventRef.current(event),
        });
    }, [configRevision]);
}
