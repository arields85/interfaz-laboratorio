import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../components/layout/Topbar', () => ({
    default: () => <div>Topbar</div>,
}));

vi.mock('../components/ui/EventHorizonBackground', () => ({
    default: () => <div data-testid="event-horizon-background" />,
}));

import MainLayout from './MainLayout';

describe('MainLayout', () => {
    it('preserves the persistent viewer shell without owning boot or reload lifecycle hooks', () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route index element={<div>Dashboard viewer</div>} />
                    </Route>
                </Routes>
            </MemoryRouter>,
        );

        expect(screen.getByText('Topbar')).toBeInTheDocument();
        expect(screen.getByTestId('event-horizon-background')).toBeInTheDocument();
        expect(screen.getByText('Dashboard viewer')).toBeInTheDocument();
    });
});
