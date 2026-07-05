import { Factory, LayoutDashboard, Wrench, type LucideIcon } from 'lucide-react';
import type { DashboardViewIconKey } from '../domain/admin.types';

export const DASHBOARD_VIEW_ICON_COMPONENTS: Record<DashboardViewIconKey, LucideIcon> = {
    default: LayoutDashboard,
    production: Factory,
    technical: Wrench,
    maintenance: Wrench,
};

export function getDashboardViewIconComponent(iconKey: DashboardViewIconKey): LucideIcon {
    return DASHBOARD_VIEW_ICON_COMPONENTS[iconKey];
}
