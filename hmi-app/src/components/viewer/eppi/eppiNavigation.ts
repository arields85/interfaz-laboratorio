import {
    BookOpen,
    ChartNoAxesCombined,
    ClipboardCheck,
    ClipboardList,
    ContactRound,
    Factory,
    FlaskConical,
    ScrollText,
    Settings,
    ShieldCheck,
    TestTubeDiagonal,
    Users,
    Warehouse,
    Wifi,
    Workflow,
    type LucideIcon,
} from 'lucide-react';
import type { EppiScreenId } from '../../../domain';

export interface EppiNavigationItem {
    icon: LucideIcon;
    id: EppiScreenId;
    label: string;
    path: string;
}

export const EPPI_NAVIGATION_ITEMS: readonly EppiNavigationItem[] = [
    { id: 'orders', label: 'Órdenes de producción', path: '/eppi/orders', icon: ClipboardList },
    { id: 'tools', label: 'Equipamiento', path: '/eppi/tools', icon: Settings },
    { id: 'locations', label: 'Locales', path: '/eppi/locations', icon: Warehouse },
    { id: 'logbook', label: 'Bitácora', path: '/eppi/logbook', icon: ScrollText },
    { id: 'users', label: 'Usuarios', path: '/eppi/users', icon: Users },
    { id: 'clients', label: 'Clientes', path: '/eppi/clients', icon: ContactRound },
    { id: 'products', label: 'Productos', path: '/eppi/products', icon: FlaskConical },
    { id: 'processes', label: 'Procesos', path: '/eppi/processes', icon: Workflow },
    { id: 'production', label: 'Producción', path: '/eppi/production', icon: Factory },
    { id: 'pharma-trials', label: 'Ensayo farmacotécnico', path: '/eppi/pharma-trials', icon: TestTubeDiagonal },
    { id: 'statistics', label: 'Estadísticas', path: '/eppi/statistics', icon: ChartNoAxesCombined },
    { id: 'audit', label: 'Registro de auditoría', path: '/eppi/audit', icon: ClipboardCheck },
    { id: 'devices', label: 'Dispositivos', path: '/eppi/devices', icon: Wifi },
    { id: 'access-control', label: 'Control de acceso', path: '/eppi/access-control', icon: ShieldCheck },
    { id: 'documentation', label: 'Documentación', path: '/eppi/documentation', icon: BookOpen },
];

export const EPPI_SCREEN_TITLES: Readonly<Record<EppiScreenId, string>> = {
    orders: 'Órdenes de producción',
    tools: 'Equipamiento',
    locations: 'Locales',
    logbook: 'Bitácora',
    users: 'Usuarios',
    clients: 'Clientes',
    products: 'Productos',
    processes: 'Procesos',
    production: 'Producción',
    'pharma-trials': 'Ensayos farmacotécnicos',
    statistics: 'Estadísticas de ensayo farmacotécnico',
    audit: 'Registro de auditoría',
    devices: 'Dispositivos',
    'access-control': 'Control de acceso',
    documentation: 'Documentación',
};
