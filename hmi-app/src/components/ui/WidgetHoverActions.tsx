import type { MouseEvent, PointerEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

interface WidgetHoverAction {
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    /** Marks a toggle action (e.g. pencil edit mode) as currently pressed/active. */
    isActive?: boolean;
}

interface WidgetHoverActionsProps {
    actions: WidgetHoverAction[];
    className?: string;
    iconSize?: number;
    /**
     * Vertical offset from the grid item's top edge. Defaults to `--widget-spacing`, which
     * straddles a normal widget's visible top border (also inset by that same token). A group
     * container (G9) passes `0px` — its frame now sits ON the grid line, with no inset of its
     * own — so its hover actions stay centered on that same border instead of appearing to
     * float below it.
     */
    top?: string;
}

const stopEvent = (event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
};

export default function WidgetHoverActions({
    actions,
    className = '',
    iconSize = 14,
    top = 'var(--widget-spacing)',
}: WidgetHoverActionsProps) {
    return (
        <div
            data-testid="widget-hover-actions"
            className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${className}`}
            style={{ top }}
        >
            <div className="pointer-events-auto flex items-center gap-1">
                {actions.map(({ label, icon: Icon, onClick, isActive = false }) => (
                    <button
                        key={label}
                        type="button"
                        draggable={false}
                        aria-label={label}
                        aria-pressed={isActive}
                        onPointerDown={stopEvent}
                        onMouseDown={stopEvent}
                        onClick={(event) => {
                            event.stopPropagation();
                            onClick();
                        }}
                        className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                            isActive
                                ? 'border-admin-accent/40 bg-admin-accent/20 text-admin-accent'
                                : 'border-white/10 bg-industrial-surface/90 text-industrial-muted hover:text-admin-accent'
                        }`}
                    >
                        <Icon size={iconSize} />
                    </button>
                ))}
            </div>
        </div>
    );
}
