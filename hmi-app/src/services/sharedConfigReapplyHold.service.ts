// Lets an editor with unsaved drafts defer the re-apply of remote configuration changes, so a
// remote change never overwrites the live preview of those drafts. Changes that arrive while
// held are remembered and handed to the re-apply handler when the last hold is released.

let holds = 0;
let handler: ((changedKeys: readonly string[]) => void) | null = null;
const heldKeys = new Set<string>();

/** Returns an idempotent release; the last release applies the changes that arrived meanwhile. */
export function holdSharedConfigReapply(): () => void {
    holds += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0 && heldKeys.size > 0) {
            const pending = [...heldKeys];
            heldKeys.clear();
            handler?.(pending);
        }
    };
}

/** Called by the re-apply path: true when the change was deferred because an editor holds it. */
export function deferWhileHeld(changedKeys: readonly string[]): boolean {
    if (holds === 0) return false;
    for (const key of changedKeys) heldKeys.add(key);
    return true;
}

/** Where deferred changes go on release (the re-apply path registers itself; null clears). */
export function setHeldChangesHandler(next: ((changedKeys: readonly string[]) => void) | null): void {
    handler = next;
}
