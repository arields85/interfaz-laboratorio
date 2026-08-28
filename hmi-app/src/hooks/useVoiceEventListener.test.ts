import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { savePrismaRuntimeMode } from '../config/prismaRuntime.config';

const { getDataVoiceUrlMock, startVoiceEventListenerMock } = vi.hoisted(() => ({
    getDataVoiceUrlMock: vi.fn(),
    startVoiceEventListenerMock: vi.fn(),
}));

vi.mock('../config/dataConnection.config', () => ({
    DATA_CONNECTION_CONFIG_CHANGED_EVENT: 'hmi:data-connection-config-changed',
    getDataVoiceUrl: getDataVoiceUrlMock,
}));

vi.mock('../services/voiceEventListener.service', () => ({
    startVoiceEventListener: startVoiceEventListenerMock,
}));

import { useVoiceEventListener } from './useVoiceEventListener';

describe('useVoiceEventListener', () => {
    beforeEach(() => {
        localStorage.clear();
        getDataVoiceUrlMock.mockReset();
        startVoiceEventListenerMock.mockReset();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('restarts with the new URL and cleans the previous historical reference when config changes', () => {
        const firstStop = vi.fn();
        const secondStop = vi.fn();
        const onEvent = vi.fn();
        getDataVoiceUrlMock
            .mockReturnValueOnce('https://node-red.local/hmi/voice/latest')
            .mockReturnValueOnce('https://node-red.local/custom/voice');
        startVoiceEventListenerMock
            .mockReturnValueOnce(firstStop)
            .mockReturnValueOnce(secondStop);

        const { unmount } = renderHook(() => useVoiceEventListener(onEvent));

        expect(startVoiceEventListenerMock).toHaveBeenNthCalledWith(1, {
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent: expect.any(Function),
        });

        act(() => {
            window.dispatchEvent(new Event('hmi:data-connection-config-changed'));
        });

        expect(firstStop).toHaveBeenCalledTimes(1);
        expect(startVoiceEventListenerMock).toHaveBeenNthCalledWith(2, {
            url: 'https://node-red.local/custom/voice',
            onEvent: expect.any(Function),
        });

        unmount();
        expect(secondStop).toHaveBeenCalledTimes(1);
    });

    it('does not restart the Node-RED listener when only Prisma TTS configuration changes', () => {
        getDataVoiceUrlMock.mockReturnValue('https://node-red.local/hmi/voice/latest');
        startVoiceEventListenerMock.mockReturnValue(vi.fn());

        renderHook(() => useVoiceEventListener(vi.fn()));
        act(() => {
            window.dispatchEvent(new Event('hmi:prisma-voice-tts-config-changed'));
        });

        expect(startVoiceEventListenerMock).toHaveBeenCalledTimes(1);
    });

    it('routes local voice polling to the fixed loopback endpoint', () => {
        localStorage.setItem('hmi:prisma-runtime-mode', 'local');
        getDataVoiceUrlMock.mockReturnValue('https://node-red.local/hmi/voice/latest');
        startVoiceEventListenerMock.mockReturnValue(vi.fn());

        renderHook(() => useVoiceEventListener(vi.fn()));

        expect(startVoiceEventListenerMock).toHaveBeenCalledWith({
            url: 'http://127.0.0.1:5057/hmi/voice/latest',
            onEvent: expect.any(Function),
        });
    });

    it('aborts the old listener before replacing it when the runtime profile changes', () => {
        getDataVoiceUrlMock.mockReturnValue('https://node-red.local/hmi/voice/latest');
        const firstStop = vi.fn();
        const secondStop = vi.fn();
        startVoiceEventListenerMock
            .mockReturnValueOnce(firstStop)
            .mockReturnValueOnce(secondStop);

        renderHook(() => useVoiceEventListener(vi.fn()));

        act(() => savePrismaRuntimeMode('local'));

        expect(firstStop.mock.invocationCallOrder[0]).toBeLessThan(
            startVoiceEventListenerMock.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
        );
        expect(startVoiceEventListenerMock).toHaveBeenLastCalledWith({
            url: 'http://127.0.0.1:5057/hmi/voice/latest',
            onEvent: expect.any(Function),
        });
    });
});
