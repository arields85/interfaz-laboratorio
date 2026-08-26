import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Boxes, ExternalLink, Gauge, Plus, Printer, Settings, UserRound, Wifi, type LucideIcon } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import type { EppiScreenId } from '../../../domain';
import {
    eppiAccessControlTable,
    eppiClientsTable,
    eppiEquipmentTable,
    eppiIdentityCapture,
    eppiLocationsTable,
    eppiLogbookTable,
    eppiOrdersTable,
    eppiPharmaTrialsTable,
    eppiProcessesTable,
    eppiProductionTable,
    eppiProductsTable,
    eppiToolsTable,
    eppiUsersTable,
} from '../../../mocks/eppi.mock';
import HmiButton from '../../ui/HmiButton';
import AdminActionButton from '../../admin/AdminActionButton';
import EppiTablePanel from './EppiTablePanel';
import { EPPI_NAVIGATION_ITEMS, EPPI_SCREEN_TITLES } from './eppiNavigation';
import { preserveEppiEntryState } from './eppiRouting';

function suppressUnavailableClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
}

function suppressUnavailableKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
    }
}

function UnavailableAdminAction({ icon: Icon, label, variant }: { icon: LucideIcon; label: string; variant: 'primary' | 'secondary' }) {
    return (
        <AdminActionButton
            variant={variant}
            aria-disabled="true"
            data-unavailable="true"
            title="No disponible en modo de consulta"
            onClick={suppressUnavailableClick}
            onKeyDown={suppressUnavailableKey}
            onKeyUp={suppressUnavailableKey}
        >
            <Icon size={14} strokeWidth={2} aria-hidden="true" />
            {label}
        </AdminActionButton>
    );
}

function TablePanelHeading({ actions, icon: Icon, title }: { actions: ReactNode; icon: LucideIcon; title: string }) {
    return (
        <div className="flex flex-none items-center justify-between gap-3 pb-3.5">
            <div className="flex min-w-0 items-center gap-2.5 text-industrial-muted transition-colors group-hover:text-industrial-text">
                <Icon size={24} strokeWidth={2} aria-hidden="true" />
                <h2 className="font-system uppercase">{title}</h2>
            </div>
            <div className="flex items-center gap-2">{actions}</div>
        </div>
    );
}

function ToolsScreen() {
    return (
        <div className="hmi-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
            <EppiTablePanel
                definition={eppiEquipmentTable}
                density="compact"
                scrollMode="horizontal"
                showToolbar={false}
                variant="equipment"
                heading={(
                    <TablePanelHeading
                        icon={Settings}
                        title="Equipo"
                        actions={(
                            <>
                                <UnavailableAdminAction label="Ver todo" icon={ExternalLink} variant="secondary" />
                                <UnavailableAdminAction label="Equipo" icon={Plus} variant="primary" />
                            </>
                        )}
                    />
                )}
            />
            <EppiTablePanel
                definition={eppiToolsTable}
                density="compact"
                scrollMode="horizontal"
                showToolbar={false}
                variant="equipment"
                heading={(
                    <TablePanelHeading
                        icon={Boxes}
                        title="Elemento de uso"
                        actions={(
                            <>
                                <UnavailableAdminAction label="Ver todo" icon={ExternalLink} variant="secondary" />
                                <UnavailableAdminAction label="Elemento de uso" icon={Plus} variant="primary" />
                            </>
                        )}
                    />
                )}
            />
        </div>
    );
}

function StatisticsScreen() {
    const [activeTab, setActiveTab] = useState<'Lote' | 'Producto'>('Lote');

    return (
        <div className="hmi-scrollbar min-h-0 flex-1 overflow-auto p-2">
            <article className="glass-panel flex min-h-72 w-full max-w-3xl flex-col gap-6 p-5">
                <div className="flex gap-2" role="tablist" aria-label="Estadísticas">
                    {(['Lote', 'Producto'] as const).map((tab) => (
                        <HmiButton
                            key={tab}
                            role="tab"
                            variant={activeTab === tab ? 'primary' : 'secondary'}
                            aria-selected={activeTab === tab}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </HmiButton>
                    ))}
                </div>
                <div className="grid gap-4 md:grid-cols-3" role="tabpanel">
                    <label className="flex min-w-0 flex-col gap-2 text-industrial-muted">
                        <span>{activeTab}</span>
                        <input
                            type="search"
                            className="h-9 rounded-lg border border-industrial-border bg-industrial-hover px-3 font-system text-industrial-text outline-none focus:border-admin-accent"
                            placeholder={`Buscar ${activeTab.toLocaleLowerCase()}`}
                        />
                    </label>
                    <label className="flex min-w-0 flex-col gap-2 text-industrial-muted">
                        <span>Proceso</span>
                        <input
                            readOnly
                            value="Sin asignar"
                            className="h-9 rounded-lg border border-industrial-border bg-industrial-hover px-3 font-system text-industrial-muted opacity-60"
                        />
                    </label>
                    <label className="flex min-w-0 flex-col gap-2 text-industrial-muted">
                        <span>Ensayo</span>
                        <input
                            readOnly
                            value="Sin asignar"
                            className="h-9 rounded-lg border border-industrial-border bg-industrial-hover px-3 font-system text-industrial-muted opacity-60"
                        />
                    </label>
                </div>
            </article>
        </div>
    );
}

function AuditScreen() {
    return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <article className="glass-panel w-full max-w-2xl p-8" role="status">
                <h2
                    className="text-industrial-text"
                    style={{
                        fontFamily: 'var(--font-dashboard-title)',
                        fontSize: 'calc(var(--font-size-dashboard-title) * 0.75)',
                        fontWeight: 'var(--font-weight-dashboard-title)',
                        letterSpacing: 'var(--tracking-dashboard-title)',
                    }}
                >
                    Acceso no autorizado
                </h2>
                <div className="my-4 border-t border-industrial-border" />
                <p className="text-industrial-muted">
                    No tienes permiso para acceder a este recurso. Verifica tus credenciales o contacta al administrador si crees que esto es un error.
                </p>
            </article>
        </div>
    );
}

function DevicesScreen() {
    const devices = [
        { label: 'Administrar impresoras', icon: Printer, detail: 'Inventario de impresión disponible en modo de consulta.' },
        { label: 'Administrar dispositivos de medición', icon: Gauge, detail: 'Inventario de medición disponible en modo de consulta.' },
    ];

    return (
        <div className="hmi-scrollbar min-h-0 flex-1 overflow-auto p-2">
            <div className="grid gap-4 md:grid-cols-2">
                {devices.map(({ detail, icon: Icon, label }) => (
                    <article key={label} className="glass-panel flex min-h-56 flex-col items-start gap-4 p-6">
                        <span className="grid size-14 place-items-center rounded-xl border border-admin-accent/30 bg-admin-accent/10 text-admin-accent">
                            <Icon size={30} aria-hidden="true" />
                        </span>
                        <h2 className="font-system text-industrial-text">{label}</h2>
                        <p className="text-industrial-muted">{detail}</p>
                    </article>
                ))}
            </div>
        </div>
    );
}

function DocumentationScreen() {
    return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <article className="glass-panel grid min-h-60 w-full max-w-xl place-content-center justify-items-center gap-3 p-8 text-center text-industrial-muted" role="status">
                <Wifi size={32} aria-hidden="true" />
                <h2 className="font-system text-industrial-text">Documentación no disponible</h2>
                <p>El contenido integrado no está disponible en este entorno.</p>
            </article>
        </div>
    );
}

function ScreenContent({ screenId }: { screenId: EppiScreenId }) {
    switch (screenId) {
        case 'orders':
            return <EppiTablePanel definition={eppiOrdersTable} variant="orders" />;
        case 'tools':
            return <ToolsScreen />;
        case 'locations':
            return <EppiTablePanel definition={eppiLocationsTable} variant="locations" />;
        case 'logbook':
            return <EppiTablePanel definition={eppiLogbookTable} variant="logbook" />;
        case 'users':
            return <EppiTablePanel definition={eppiUsersTable} variant="users" />;
        case 'clients':
            return <EppiTablePanel definition={eppiClientsTable} variant="clients" />;
        case 'products':
            return <EppiTablePanel definition={eppiProductsTable} />;
        case 'processes':
            return <EppiTablePanel definition={eppiProcessesTable} />;
        case 'production':
            return <EppiTablePanel definition={eppiProductionTable} />;
        case 'pharma-trials':
            return <EppiTablePanel definition={eppiPharmaTrialsTable} />;
        case 'statistics':
            return <StatisticsScreen />;
        case 'audit':
            return <AuditScreen />;
        case 'devices':
            return <DevicesScreen />;
        case 'access-control':
            return <EppiTablePanel definition={eppiAccessControlTable} emptyMessage="No se encontraron dispositivos" />;
        case 'documentation':
            return <DocumentationScreen />;
    }
}

function EppiIdentity() {
    const [internetStatus, serverStatus, responseStatus] = eppiIdentityCapture.connectionStatus;

    return (
        <div
            className="flex flex-none items-center gap-2.5 text-industrial-text-soft"
            aria-label={eppiIdentityCapture.displayName}
        >
            <div
                className="grid size-9 place-items-center rounded-full border border-admin-accent/30 bg-admin-accent/10 text-admin-accent"
                aria-hidden="true"
            >
                <UserRound size={18} strokeWidth={2} />
            </div>
            <div className="min-w-0 font-system">
                <h2 className="truncate text-industrial-text">{eppiIdentityCapture.displayName}</h2>
                <p className="font-mono text-industrial-muted">{eppiIdentityCapture.role}</p>
            </div>
            <div className="grid grid-cols-[0.5rem_auto_auto] items-center gap-x-2 gap-y-0.5 border-l border-industrial-border pl-3 font-mono text-industrial-muted">
                <span className="led-glow-green row-span-2 size-2 rounded-full bg-status-normal" aria-hidden="true" />
                <span>{internetStatus} </span>
                <span>{serverStatus} </span>
                <span className="col-span-2">{responseStatus}</span>
            </div>
        </div>
    );
}

export default function EppiViewer() {
    const location = useLocation();
    const screenId = location.pathname.split('/')[2];
    const activeItem = EPPI_NAVIGATION_ITEMS.find((item) => item.id === screenId);

    if (!activeItem) {
        return (
            <Navigate
                replace
                to="/eppi/orders"
                state={preserveEppiEntryState(location.state)}
            />
        );
    }

    return (
        <section className="eppi-viewer flex h-full min-h-[40rem] min-w-0 flex-col" aria-labelledby="eppi-page-title">
            <header className="mb-4 flex min-h-18 flex-none items-center justify-between gap-6 px-2">
                <h1
                    id="eppi-page-title"
                    className="truncate text-industrial-text"
                    style={{
                        fontFamily: 'var(--font-dashboard-title)',
                        fontSize: 'var(--font-size-dashboard-title)',
                        fontWeight: 'var(--font-weight-dashboard-title)',
                        letterSpacing: 'var(--tracking-dashboard-title)',
                        lineHeight: 1,
                    }}
                >
                    {EPPI_SCREEN_TITLES[activeItem.id]}
                </h1>
                <EppiIdentity />
            </header>
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-industrial-border p-2">
                <div className="flex h-full min-h-0 flex-col">
                    <ScreenContent screenId={activeItem.id} />
                </div>
            </div>
        </section>
    );
}
