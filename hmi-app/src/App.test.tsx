import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { useBootShieldMock, useReloadShieldMock } = vi.hoisted(() => ({
    useBootShieldMock: vi.fn(),
    useReloadShieldMock: vi.fn(),
}));

vi.mock('./hooks/useBootShield', () => ({
    useBootShield: useBootShieldMock,
}));

vi.mock('./hooks/useReloadShield', () => ({
    useReloadShield: useReloadShieldMock,
}));

vi.mock('./hooks/useResumeShield', () => {
    throw new Error('App must not import useResumeShield for warm resumes.');
});

vi.mock('./app/router', () => ({
    default: () => <div>Router shell</div>,
}));

import App from './App';

describe('App', () => {
    it('owns only boot and reload shield hooks at the root and still renders the router shell', () => {
        render(<App />);

        expect(useBootShieldMock).toHaveBeenCalledTimes(1);
        expect(useReloadShieldMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Router shell')).toBeInTheDocument();
    });
});
