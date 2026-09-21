import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => {
    const bytes = new Map<string, string>();
    const refused: string[] = [];
    const storage: Storage = {
        get length() { return bytes.size; },
        clear: () => bytes.clear(), key: (index) => [...bytes.keys()][index] ?? null,
        getItem: vi.fn((key: string) => bytes.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => { bytes.set(key, value); }),
        removeItem: (key) => { bytes.delete(key); },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        refused.push(String(input));
        throw new Error('TEST_NETWORK_REFUSED');
    });
    return { bytes, storage, refused };
});

import HmiNameSettings from './HmiNameSettings';
import { UNAUTHENTICATED_SESSION, useAuthStore } from '../../store/auth.store';

afterAll(() => vi.unstubAllGlobals());
const KEY = 'hmi:prisma-hmi-name';
function authenticate(access = true) {
    useAuthStore.setState({
        isHydrated: true,
        session: {
            isAuthenticated: true, loginTimestamp: '2026-01-01T00:00:00Z',
            user: { id: 'test-admin', username: 'admin', displayName: 'Admin',
                role: { id: 'admin', name: 'Admin', permissions: access ? ['admin:access'] : [] } },
        },
    });
}
function draft(value: string) {
    fireEvent.change(screen.getByLabelText('Nombre de esta HMI'), { target: { value } });
}
function save() {
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));
}
beforeEach(() => {
    boundary.bytes.clear();
    boundary.refused.length = 0;
    boundary.storage.getItem = vi.fn((key) => boundary.bytes.get(key) ?? null);
    boundary.storage.setItem = vi.fn((key, value) => { boundary.bytes.set(key, value); });
    authenticate();
});
afterEach(() => {
    cleanup();
    useAuthStore.setState({ session: UNAUTHENTICATED_SESSION, isHydrated: false });
    expect(boundary.refused).toEqual([]);
});

describe('HmiNameSettings with real local persistence', () => {
    it('saves a normalized local name and restores it on remount', async () => {
        const view = render(<HmiNameSettings active />);
        draft('  Panel   recepción  ');
        save();
        expect(await screen.findByText('Nombre guardado en este navegador')).toHaveAttribute('aria-live', 'polite');
        expect(boundary.bytes.get(KEY)).toBe(JSON.stringify({ version: 1, name: 'Panel recepción' }));
        expect(screen.queryByText(/sincroniz|confirmado.*remot/i)).not.toBeInTheDocument();
        view.unmount();
        render(<HmiNameSettings active />);
        expect(screen.getByLabelText('Nombre de esta HMI')).toHaveValue('Panel recepción');
    });

    it('clears an existing name explicitly', async () => {
        boundary.bytes.set(KEY, JSON.stringify({ version: 1, name: 'Panel' }));
        render(<HmiNameSettings active />);
        draft('   ');
        save();
        expect(await screen.findByText('Nombre guardado en este navegador')).toBeInTheDocument();
        expect(boundary.bytes.get(KEY)).toBe(JSON.stringify({ version: 1, name: null }));
        expect(screen.getByLabelText('Nombre de esta HMI')).toHaveValue('');
    });

    it('rejects invalid text without mutation', () => {
        render(<HmiNameSettings active />);
        draft('😀'.repeat(161));
        save();
        expect(boundary.storage.setItem).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Nombre de esta HMI')).toHaveValue('😀'.repeat(161));
        expect(screen.queryByText('Nombre guardado en este navegador')).not.toBeInTheDocument();
    });

    it('preserves the draft and reports failure when storage throws', () => {
        boundary.storage.setItem = vi.fn(() => { throw new Error('private storage detail'); });
        render(<HmiNameSettings active />);
        draft('Panel');
        save();
        expect(screen.getByLabelText('Nombre de esta HMI')).toHaveValue('Panel');
        expect(screen.queryByText('Nombre guardado en este navegador')).not.toBeInTheDocument();
        expect(screen.getByText(/no se pudo guardar/i)).toBeInTheDocument();
        expect(screen.queryByText(/private storage detail/)).not.toBeInTheDocument();
    });

    it.each(['unauthenticated', 'no-access', 'inactive'])('refuses mutation when %s', (gate) => {
        if (gate === 'unauthenticated') useAuthStore.setState({ session: UNAUTHENTICATED_SESSION });
        if (gate === 'no-access') authenticate(false);
        render(<HmiNameSettings active={gate !== 'inactive'} />);
        expect(screen.getByLabelText('Nombre de esta HMI')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeDisabled();
        save();
        expect(boundary.storage.setItem).not.toHaveBeenCalled();
    });

    it('discards unsaved input when inactive without deleting the saved name', () => {
        boundary.bytes.set(KEY, JSON.stringify({ version: 1, name: 'Persisted' }));
        const view = render(<HmiNameSettings active />);
        draft('Unsaved');
        view.rerender(<HmiNameSettings active={false} />);
        view.rerender(<HmiNameSettings active />);
        expect(screen.getByLabelText('Nombre de esta HMI')).toHaveValue('Persisted');
        expect(boundary.storage.setItem).not.toHaveBeenCalled();
    });

    it('discards unsaved input and disables saving on logout', () => {
        render(<HmiNameSettings active />);
        draft('Unsaved');
        act(() => useAuthStore.setState({ session: UNAUTHENTICATED_SESSION }));
        expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeDisabled();
        save();
        expect(boundary.storage.setItem).not.toHaveBeenCalled();
        act(() => authenticate());
        expect(screen.getByLabelText('Nombre de esta HMI')).toHaveValue('');
    });
});
