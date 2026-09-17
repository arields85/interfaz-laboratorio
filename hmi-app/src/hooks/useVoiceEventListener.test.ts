import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startVoiceEventListenerMock } = vi.hoisted(() => ({
    startVoiceEventListenerMock: vi.fn(),
}));

vi.mock('../services/voiceEventListener.service', () => ({
    startVoiceEventListener: startVoiceEventListenerMock,
}));

import { useVoiceEventListener } from './useVoiceEventListener';

describe('useVoiceEventListener', () => {
    beforeEach(() => startVoiceEventListenerMock.mockReset());

    it('uses one fixed same-origin listener and cleans it on unmount', () => {
        const stop = vi.fn();
        const onEvent = vi.fn();
        startVoiceEventListenerMock.mockReturnValue(stop);

        const { unmount, rerender } = renderHook(({ callback }) => useVoiceEventListener(callback), {
            initialProps: { callback: onEvent },
        });
        rerender({ callback: vi.fn() });

        expect(startVoiceEventListenerMock).toHaveBeenCalledTimes(1);
        expect(startVoiceEventListenerMock).toHaveBeenCalledWith({
            url: '/api/prisma/events/latest',
            onEvent: expect.any(Function),
        });
        unmount();
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
