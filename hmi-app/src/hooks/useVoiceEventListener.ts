import { useEffect, useRef, useState } from 'react';

import {
    DATA_CONNECTION_CONFIG_CHANGED_EVENT,
    getDataVoiceUrl,
} from '../config/dataConnection.config';
import { resolvePrismaVoiceUrl } from '../config/prismaAssistant.config';
import type { VoiceEvent } from '../domain/voice.types';
import { startVoiceEventListener } from '../services/voiceEventListener.service';
import { usePrismaRuntimeProfile } from './usePrismaRuntimeProfile';

export function useVoiceEventListener(onEvent: (event: VoiceEvent) => void): void {
    const onEventRef = useRef(onEvent);
    const [configRevision, setConfigRevision] = useState(0);
    const runtimeProfile = usePrismaRuntimeProfile();

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

    const voiceUrl = resolvePrismaVoiceUrl(runtimeProfile.mode, getDataVoiceUrl());
    const centralConfigRevision = runtimeProfile.mode === 'central' ? configRevision : 0;

    useEffect(() => {
        return startVoiceEventListener({
            url: voiceUrl,
            onEvent: (event) => onEventRef.current(event),
        });
    }, [centralConfigRevision, runtimeProfile.revision, voiceUrl]);
}
