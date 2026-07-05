import type { DashboardViewIconKey } from '../domain/admin.types';

interface DashboardViewPresentationSource {
    name: string;
    subtitle?: string;
    iconKey?: DashboardViewIconKey;
}

const PRODUCTION_VIEW_NAMES = new Set(['production', 'producción']);
const TECHNICAL_VIEW_NAMES = new Set(['technical', 'técnica']);
const MAINTENANCE_VIEW_NAMES = new Set(['maintenance', 'mantenimiento']);

export function resolveDashboardViewIconKey(view: Pick<DashboardViewPresentationSource, 'name' | 'iconKey'>): DashboardViewIconKey {
    if (view.iconKey) {
        return view.iconKey;
    }

    const normalizedName = view.name.trim().toLocaleLowerCase();

    if (PRODUCTION_VIEW_NAMES.has(normalizedName)) {
        return 'production';
    }

    if (TECHNICAL_VIEW_NAMES.has(normalizedName)) {
        return 'technical';
    }

    if (MAINTENANCE_VIEW_NAMES.has(normalizedName)) {
        return 'maintenance';
    }

    return 'default';
}

export function buildDashboardViewSubtitle(
    view: Pick<DashboardViewPresentationSource, 'name' | 'subtitle'>,
    fallbackSubtitle?: string,
): string {
    const resolvedSubtitle = view.subtitle?.trim() || fallbackSubtitle?.trim();

    return resolvedSubtitle ? `${view.name} - ${resolvedSubtitle}` : view.name;
}
