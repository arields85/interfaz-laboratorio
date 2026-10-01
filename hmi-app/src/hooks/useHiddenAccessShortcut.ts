import { useEffect } from 'react';

import { toggleHiddenAccess } from '../services/hiddenAccess.service';

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement;
}

/**
 * Ctrl+Alt+A reveals or hides the users icon and the Prisma control in this browser. Mounted once
 * at app level. It is ignored while the user is typing, and it does not collide with the builder's
 * undo/redo (Ctrl+Z / Ctrl+Y), which never use Alt.
 */
export function useHiddenAccessShortcut(): void {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== 'KeyA' || !event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
            if (isTypingTarget(event.target)) return;
            event.preventDefault();
            toggleHiddenAccess();
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);
}
