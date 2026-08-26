import { useLocation, useNavigate } from 'react-router-dom';
import HoverTooltip from '../../ui/HoverTooltip';
import { preserveEppiEntryState } from './eppiRouting';
import { EPPI_NAVIGATION_ITEMS } from './eppiNavigation';

export default function EppiTopbarNavigation() {
    const location = useLocation();
    const navigate = useNavigate();

    return (
        <nav
            aria-label="Navegación EPPI"
            className="hmi-scrollbar flex max-w-[calc(100vw-22rem)] items-center gap-1 overflow-x-auto overflow-y-hidden"
        >
            {EPPI_NAVIGATION_ITEMS.map(({ icon: Icon, label, path }) => {
                const isActive = location.pathname === path;
                return (
                    <HoverTooltip key={path} label={label} position="bottom" className="shrink-0">
                        <button
                            type="button"
                            aria-label={label}
                            aria-current={isActive ? 'page' : undefined}
                            className={`rounded-lg p-2 transition-colors hover:bg-industrial-hover ${
                                isActive
                                    ? 'text-admin-accent'
                                    : 'text-industrial-muted hover:text-industrial-text'
                            }`}
                            onClick={() => navigate(path, { state: preserveEppiEntryState(location.state) })}
                        >
                            <Icon size={20} />
                        </button>
                    </HoverTooltip>
                );
            })}
        </nav>
    );
}
