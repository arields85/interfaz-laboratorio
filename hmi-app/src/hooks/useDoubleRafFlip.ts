import { useEffect, useState } from 'react';

// T20b: single source of truth for the "invisible mount frame -> double
// requestAnimationFrame -> visible frame" entry pattern used by every CSS-transition-driven
// entry animation in the HMI (mount in a from-state with no prior DOM to interpolate from, then
// flip on the next paint so the transition actually interpolates instead of popping in; double
// rAF, not a single one, guards against the browser coalescing the flip into the same frame as
// the initial paint).
//
// `active` gates the flip: while false, the hook stays/reverts to `false` (the "entering" look);
// once it becomes true, the double-rAF flip runs and the hook returns `true` (the real look) two
// paints later. Passing a constant `true` (a component that only ever mounts once, at the moment
// its entry animation should start — see PairingOrbVisual in PrismaPairingControl.tsx) reproduces
// a mount-only flip; passing a boolean that toggles over the owner's lifetime (see the pairing
// modal's own open/close fade in PrismaPairingControl.tsx) reproduces a re-armable flip.
//
// TODO(no active owner yet): `PrismaOrbOverlay.tsx`'s `PrismaOrbOverlayVisible` (T17b) has its
// own equivalent, not-yet-extracted implementation — that file was concurrently owned by another
// writer (T21) when this hook was introduced, so it could not be migrated to use it in the same
// change. Fold that call site into this hook next time it is touched, so the double-rAF pattern
// has exactly one implementation instead of two.
export function useDoubleRafFlip(active: boolean): boolean {
    const [flipped, setFlipped] = useState(false);
    // Tracks the `active` value the current render's state already reflects, so a change since
    // the last render can reset `flipped` synchronously during render instead of from inside the
    // effect below (React's documented pattern for deriving state from a prop change —
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders,
    // the same one PrismaOrbOverlay.tsx's `durationForPhase` already uses — avoids both an extra
    // render and calling setState unconditionally inside an effect body, flagged by this repo's
    // `react-hooks/set-state-in-effect` lint rule).
    const [trackedActive, setTrackedActive] = useState(active);
    if (active !== trackedActive) {
        setTrackedActive(active);
        if (!active) setFlipped(false);
    }

    useEffect(() => {
        if (!active) return;
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => setFlipped(true));
        });
        return () => {
            cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        };
    }, [active]);

    return flipped;
}
