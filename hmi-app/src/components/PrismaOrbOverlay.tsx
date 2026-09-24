import type { CSSProperties, RefObject } from 'react';
import { useEffect, useState } from 'react';

import type { PrismaOrbVisualConfig } from '../domain/voice.types';
import {
    PRISMA_ORB_ENTRY_DURATION_MS,
    PRISMA_ORB_FADE_DURATION_MS,
    PRISMA_ORB_GROW_DURATION_MS,
} from '../hooks/usePrismaOrbPresentation';
import type { PrismaOrbPresentationPhase } from '../hooks/usePrismaOrbPresentation';
import type { LedaOrbElement } from '../vendor/leda-orb.js';
import PrismaOrb from './PrismaOrb';

interface PrismaOrbOverlayProps {
    phase: PrismaOrbPresentationPhase;
    orbRef: RefObject<LedaOrbElement | null>;
    config: PrismaOrbVisualConfig;
}

// T17: container-only "thinking" look. The orb's own two internal states
// (leda-orb.js idle breathing vs. speaking voice modulation, driven
// imperatively by the audio engine) stay untouched -- only this overlay's
// scale/opacity change per phase, so no extra CSS pulse/keyframe animation
// is added (a removed CSS animation would snap instead of interpolating;
// the orb's native idle breathing already conveys "thinking").
//
// Values: thinking = 75% scale / 60% opacity (agreed with the user);
// visible = 100% / 100%; fading eases opacity to 0 while the scale eases
// back toward the thinking scale, so the fade doesn't balloon to full size
// first. Scale/opacity use Tailwind's own default steps (no arbitrary
// values needed: 60/75/100/0 are all on the default scale). Durations come
// from PRISMA_ORB_GROW_DURATION_MS/PRISMA_ORB_FADE_DURATION_MS via inline
// `transitionDuration` instead of a Tailwind `duration-[...]` class, so the
// numeric values live in exactly one place (usePrismaOrbPresentation.ts) --
// Tailwind's class scanner needs literal text and cannot read a JS
// constant, and an inline duration is safe here because
// `motion-reduce:transition-none` clears `transition-property` itself
// (not just the duration), so reduced motion still skips the transition
// entirely regardless of the inline duration value.
const PRISMA_ORB_THINKING_CLASSES = 'scale-75 opacity-60';
const PRISMA_ORB_VISIBLE_CLASSES = 'scale-100 opacity-100';
const PRISMA_ORB_FADING_CLASSES = 'scale-75 opacity-0';

// T17b: the entering look is the thinking scale at zero opacity -- the
// "from" state the very first appearance fades out of (see
// PrismaOrbOverlayVisible below). Kept as its own named constant (rather
// than reusing PRISMA_ORB_THINKING_CLASSES) because it is a distinct,
// mount-only concept, not one of the three steady phase looks.
const PRISMA_ORB_ENTERING_CLASSES = 'scale-75 opacity-0';

type VisiblePhase = Exclude<PrismaOrbPresentationPhase, 'hidden'>;

function phaseClasses(phase: VisiblePhase): string {
    if (phase === 'thinking') return PRISMA_ORB_THINKING_CLASSES;
    if (phase === 'visible') return PRISMA_ORB_VISIBLE_CLASSES;
    return PRISMA_ORB_FADING_CLASSES;
}

function phaseTransitionDurationMs(phase: VisiblePhase): number {
    return phase === 'fading' ? PRISMA_ORB_FADE_DURATION_MS : PRISMA_ORB_GROW_DURATION_MS;
}

// T17b root cause 1 fix: Tailwind v4 compiles `scale-*` to the CSS `scale`
// property and `-translate-x-1/2` to the CSS `translate` property -- both
// are separate properties from `transform` (CSS Transforms Level 2), so the
// previous `transition-[opacity,transform]` never covered the scale change
// at all (verified against the compiled CSS served by Vite: `.scale-75 {
// scale: var(--tw-scale-x) var(--tw-scale-y); }`, no `transform` involved).
// Fixed to transition `opacity,scale`; `translate` is deliberately left out
// (it never changes -- it only centers the fixed-position overlay -- so
// nothing would ever animate on it, and CSS Transforms Level 2 animates
// `translate`/`scale`/`rotate` independently of `transform` and of each
// other).
const PRISMA_ORB_TRANSITION_CLASSNAME = 'transition-[opacity,scale]';

interface PrismaOrbOverlayVisibleProps {
    phase: VisiblePhase;
    orbRef: RefObject<LedaOrbElement | null>;
    config: PrismaOrbVisualConfig;
}

// T17b root cause 2 fix: split out of PrismaOrbOverlay so this inner
// component's own mount/unmount lifecycle exactly matches the div's --
// PrismaOrbOverlay (the outer component) is instantiated once for the
// app's whole lifetime (App.tsx always renders it), so hooks placed there
// would only ever run their mount effect once, not on every hidden ->
// thinking reappearance. This component instead mounts fresh every single
// time the outer component starts rendering non-null, i.e. on every
// hidden -> thinking transition, giving every reappearance its own entry
// animation.
//
// On mount this renders one frame in an invisible "entering" look (the
// thinking scale at 0% opacity) with no prior DOM state to interpolate
// from, then a double `requestAnimationFrame` flips to the real phase
// look on the next paint -- by then the browser has already painted the
// "entering" frame, so the flip has a "from" state and the CSS transition
// on this element (see PRISMA_ORB_TRANSITION_CLASSNAME) actually
// interpolates instead of popping in. Double rAF (not a single one) is the
// standard guard against a browser coalescing the state change into the
// same frame as the initial paint; a bare `useEffect` risks the same
// coalescing in a real browser even though it happens to work under the
// test environment's synchronous `act()` flush.
function PrismaOrbOverlayVisible({ phase, orbRef, config }: PrismaOrbOverlayVisibleProps) {
    const [mounted, setMounted] = useState(false);
    // T17b: `durationForPhase` remembers which phase the CURRENT
    // `transitionDurationMs` was computed for, so a genuine phase change
    // (thinking -> visible, visible -> fading, ...) can be told apart from
    // the entry flip landing on the very same phase ('thinking', since this
    // component only ever mounts on hidden -> thinking). Adjusted
    // synchronously during render, React's documented pattern for deriving
    // state from a change since the last render
    // (https://react.dev/reference/react/useState#storing-information-from-previous-renders):
    // unlike a ref (flagged by this repo's `react-hooks/refs` lint rule for
    // render-time access) or a `useEffect` (which would apply the new
    // duration one commit too late, visibly using the wrong duration for a
    // transition's first frame), this resolves within the same render pass
    // before anything commits/paints -- one consistent commit, no lag.
    const [durationForPhase, setDurationForPhase] = useState<VisiblePhase | null>(null);
    const [transitionDurationMs, setTransitionDurationMs] = useState(PRISMA_ORB_ENTRY_DURATION_MS);

    useEffect(() => {
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => setMounted(true));
        });
        return () => {
            cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        };
    }, []);

    if (mounted && durationForPhase === null) {
        // The entry flip itself: record the phase it landed on, but leave
        // `transitionDurationMs` at its initial entry-duration value.
        setDurationForPhase(phase);
    } else if (mounted && durationForPhase !== phase) {
        // A real phase change after the entry flip already happened.
        setDurationForPhase(phase);
        setTransitionDurationMs(phaseTransitionDurationMs(phase));
    }

    const displayClasses = mounted ? phaseClasses(phase) : PRISMA_ORB_ENTERING_CLASSES;

    return (
        <div
            aria-hidden="true"
            data-testid="prisma-orb-overlay"
            data-phase={phase}
            className={`pointer-events-none fixed left-1/2 top-[46px] z-[100] size-[min(var(--prisma-orb-size),calc(var(--viewport-width)-2rem),calc(var(--viewport-height)-62px))] -translate-x-1/2 bg-transparent ${PRISMA_ORB_TRANSITION_CLASSNAME} ease-out motion-reduce:transition-none motion-reduce:duration-0 ${displayClasses}`}
            style={{
                '--prisma-orb-size': `${config.size}px`,
                transitionDuration: `${transitionDurationMs}ms`,
            } as CSSProperties}
        >
            <PrismaOrb config={config} orbRef={orbRef} />
        </div>
    );
}

export default function PrismaOrbOverlay({ phase, orbRef, config }: PrismaOrbOverlayProps) {
    if (phase === 'hidden') {
        return null;
    }

    return <PrismaOrbOverlayVisible phase={phase} orbRef={orbRef} config={config} />;
}
