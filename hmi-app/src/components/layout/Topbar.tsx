import { useRef, useState } from 'react';
import { Bell, Search, User, Home, FolderTree, Activity, AlertTriangle, Box, Settings, LayoutDashboard, Stethoscope, ScrollText, Palette } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import LoginOverlay from '../auth/LoginOverlay';
import ShaderSettingsPanel from './ShaderSettingsPanel';
import { useAuthStore } from '../../store/auth.store';
import { requestShieldReveal } from '../../hooks/useBootShield';

const navLeftItems = [
    { icon: Home, label: 'Visión General', path: '/' },
    { icon: FolderTree, label: 'Explorador', path: '/explorer' },
    { icon: Activity, label: 'Tendencias', path: '/trends' },
    { icon: AlertTriangle, label: 'Alarmas', path: '/alerts' },
];

const navRightItems = [
    { icon: Box, label: 'Trazabilidad', path: '/traceability' },
    { icon: LayoutDashboard, label: 'Overview', path: '/overview' },
    { icon: Stethoscope, label: 'Diagnostics', path: '/diagnostics' },
    { icon: ScrollText, label: 'Logs', path: '/logs' },
];

function NavIconLink({ icon: Icon, label, path }: { icon: typeof Home; label: string; path: string }) {
    return (
        <NavLink
            to={path}
            title={label}
            end={path === '/'}
            className={({ isActive }) =>
                `p-2 rounded-lg transition-colors ${
                    isActive
                        ? 'text-admin-accent hover:bg-industrial-hover'
                        : 'text-industrial-muted hover:bg-industrial-hover hover:text-industrial-text'
                }`
            }
        >
            <Icon size={20} />
        </NavLink>
    );
}

export default function Topbar() {
    const [shaderPanelOpen, setShaderPanelOpen] = useState(false);
    const [loginOverlayOpen, setLoginOverlayOpen] = useState(false);
    const userButtonRef = useRef<HTMLButtonElement>(null);
    const isHydrated = useAuthStore((state) => state.isHydrated);
    const hasAdminAccess = useAuthStore((state) => state.hasPermission('admin:access'));
    const navigate = useNavigate();
    const shouldShowAdminActions = isHydrated && hasAdminAccess;

    const iconButtonClassName = 'relative rounded-lg p-2 text-industrial-muted transition-colors hover:bg-industrial-hover hover:text-industrial-text';

    const handleAdminNavigation = () => {
        requestShieldReveal({
            profileId: 'short',
            runner: 'short',
            allowNoContentExtension: false,
            restartCycle: true,
        });
        navigate('/admin');
    };

    return (
        <>
            <header className="relative z-50 sticky top-0 flex items-center justify-between border-b border-industrial-border bg-industrial-surface/80 px-6 py-4 backdrop-blur-xl lg:px-10">
                {/* Left: Logo */}
                <h2 className="shrink-0 uppercase text-industrial-text" style={{ fontSize: 'var(--font-size-logo)' }}>
                    Core<span className="text-gradient">Analytics</span>
                </h2>

                {/* Center: Nav Left + Search + Nav Right */}
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
                    <nav className="flex items-center gap-1">
                        {navLeftItems.map((item) => (
                            <NavIconLink key={item.path} {...item} />
                        ))}
                    </nav>

                    <div className="hidden w-80 items-center rounded-2xl border border-industrial-border bg-industrial-hover px-4 py-2 lg:flex">
                        <Search className="shrink-0 text-industrial-muted" size={20} />
                        <input
                            className="ml-2 w-full border-none bg-transparent text-industrial-text placeholder:text-industrial-muted focus:outline-none focus:ring-0"
                            placeholder="Analyze equipment..."
                            type="text"
                        />
                    </div>

                    <nav className="flex items-center gap-1">
                        {navRightItems.map((item) => (
                            <NavIconLink key={item.path} {...item} />
                        ))}
                    </nav>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1">
                    <button title="Notificaciones" className={iconButtonClassName}>
                        <span className="led-glow-red absolute right-1 top-1 size-2 rounded-full bg-status-critical"></span>
                        <Bell size={20} />
                    </button>
                    {shouldShowAdminActions ? (
                        <button
                            title="Personalizar fondo"
                            className={`p-2 rounded-lg transition-colors ${
                                shaderPanelOpen
                                    ? 'bg-industrial-hover text-admin-accent'
                                    : iconButtonClassName
                            }`}
                            onClick={() => setShaderPanelOpen((value) => !value)}
                        >
                            <Palette size={20} />
                        </button>
                    ) : null}
                    {shouldShowAdminActions ? (
                        <button
                            title="Administracion"
                            className={iconButtonClassName}
                            onClick={handleAdminNavigation}
                        >
                            <Settings size={20} />
                        </button>
                    ) : null}
                    <button
                        ref={userButtonRef}
                        title="Usuario"
                        className={iconButtonClassName}
                        onClick={() => setLoginOverlayOpen((value) => !value)}
                    >
                        <User size={20} />
                    </button>
                </div>
            </header>
            <ShaderSettingsPanel
                open={shaderPanelOpen}
                onClose={() => setShaderPanelOpen(false)}
            />
            <LoginOverlay
                triggerRef={userButtonRef}
                isOpen={loginOverlayOpen}
                onClose={() => setLoginOverlayOpen(false)}
            />
        </>
    );
}
