import { describe, expect, it } from 'vitest';
import { buildDashboardViewSubtitle, resolveDashboardViewIconKey } from './dashboardViewPresentation';

describe('dashboardViewPresentation', () => {
    it('prefers explicit icon keys and otherwise falls back to known internal-view defaults', () => {
        expect(resolveDashboardViewIconKey({ name: 'Technical', iconKey: 'production' })).toBe('production');
        expect(resolveDashboardViewIconKey({ name: 'Production', iconKey: 'maintenance' })).toBe('maintenance');
        expect(resolveDashboardViewIconKey({ name: 'Production' })).toBe('production');
        expect(resolveDashboardViewIconKey({ name: 'Producción' })).toBe('production');
        expect(resolveDashboardViewIconKey({ name: 'Technical' })).toBe('technical');
        expect(resolveDashboardViewIconKey({ name: 'Técnica' })).toBe('technical');
        expect(resolveDashboardViewIconKey({ name: 'Maintenance' })).toBe('maintenance');
        expect(resolveDashboardViewIconKey({ name: 'Mantenimiento' })).toBe('maintenance');
        expect(resolveDashboardViewIconKey({ name: 'Overview' })).toBe('default');
    });

    it('prefixes the active view name and preserves sensible subtitle fallbacks', () => {
        expect(buildDashboardViewSubtitle({ name: 'Production', subtitle: 'Main line overview' }, 'Ignored global subtitle')).toBe('Production - Main line overview');
        expect(buildDashboardViewSubtitle({ name: 'Technical' }, 'Maintenance context')).toBe('Technical - Maintenance context');
        expect(buildDashboardViewSubtitle({ name: 'Overview' }, undefined)).toBe('Overview');
    });
});
