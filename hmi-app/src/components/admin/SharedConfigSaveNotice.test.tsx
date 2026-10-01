import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SharedConfigStatus } from '../../domain/sharedConfig.types';
import SharedConfigSaveNotice from './SharedConfigSaveNotice';

const OK_STATUS: SharedConfigStatus = {
    loaded: true, source: 'server', revision: 3, saving: false, unsavedKeyCount: 0, saveError: null,
};

function createFakeStorage(initial: SharedConfigStatus = OK_STATUS) {
    let status = initial;
    const listeners = new Set<() => void>();
    return {
        retrySave: vi.fn(async () => undefined),
        getStatus: () => status,
        subscribeStatus: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        set(next: SharedConfigStatus) {
            status = next;
            for (const listener of [...listeners]) listener();
        },
    };
}

describe('SharedConfigSaveNotice', () => {
    it('renders nothing while there is no save error', () => {
        const storage = createFakeStorage();

        const { container } = render(<SharedConfigSaveNotice storage={storage} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('announces a save error with a retry action and hides again once it clears', async () => {
        const storage = createFakeStorage();
        render(<SharedConfigSaveNotice storage={storage} />);

        act(() => {
            storage.set({ ...OK_STATUS, unsavedKeyCount: 2, saveError: { code: 'AUTH_TRANSPORT_UNAVAILABLE', status: null } });
        });

        expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar la configuración en el servidor.');

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(storage.retrySave).toHaveBeenCalledTimes(1);

        act(() => {
            storage.set(OK_STATUS);
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
