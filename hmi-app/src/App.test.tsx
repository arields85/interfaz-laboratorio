import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    presentVoiceEventMock,
    useBootShieldMock,
    useReloadShieldMock,
    useVoiceEventListenerMock,
} = vi.hoisted(() => ({
    presentVoiceEventMock: vi.fn(),
    useBootShieldMock: vi.fn(),
    useReloadShieldMock: vi.fn(),
    useVoiceEventListenerMock: vi.fn(),
}));

vi.mock('./vendor/leda-orb.js', () => ({}));
vi.mock('./hooks/useBootShield', () => ({ useBootShield: useBootShieldMock }));
vi.mock('./hooks/useReloadShield', () => ({ useReloadShield: useReloadShieldMock }));
vi.mock('./hooks/useVoiceEventListener', () => ({ useVoiceEventListener: useVoiceEventListenerMock }));
vi.mock('./hooks/usePrismaOrbPresentation', () => ({
    usePrismaOrbPresentation: () => ({
        phase: 'hidden',
        orbRef: { current: null },
        presentVoiceEvent: presentVoiceEventMock,
    }),
}));
vi.mock('./hooks/useResumeShield', () => {
    throw new Error('App must not import useResumeShield for warm resumes.');
});
vi.mock('./app/router', () => ({ default: () => <div>Router shell</div> }));

import App from './App';

describe('App', () => {
    beforeEach(() => {
        presentVoiceEventMock.mockClear();
        useBootShieldMock.mockClear();
        useReloadShieldMock.mockClear();
        useVoiceEventListenerMock.mockClear();
    });

    it('keeps the exact log and starts playback only when the listener emits a new event', () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        render(<App />);

        expect(useBootShieldMock).toHaveBeenCalledTimes(1);
        expect(useReloadShieldMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Router shell')).toBeInTheDocument();
        expect(presentVoiceEventMock).not.toHaveBeenCalled();

        const event = {
            id: 'voice-2',
            timestamp: '2026-08-06T12:00:01.000Z',
            text: 'Current response',
            question: 'Current question',
        };
        const onEvent = useVoiceEventListenerMock.mock.calls[0]?.[0];
        act(() => onEvent?.(event));

        expect(consoleLogSpy).toHaveBeenCalledWith('HMI voice event received: Current response');
        expect(presentVoiceEventMock).toHaveBeenCalledTimes(1);
        expect(presentVoiceEventMock).toHaveBeenCalledWith(event);
    });
});
