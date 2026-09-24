import type { CSSProperties, RefObject } from 'react';

import type { PrismaOrbVisualConfig } from '../domain/voice.types';
import {
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

function phaseClasses(phase: Exclude<PrismaOrbPresentationPhase, 'hidden'>): string {
    if (phase === 'thinking') return PRISMA_ORB_THINKING_CLASSES;
    if (phase === 'visible') return PRISMA_ORB_VISIBLE_CLASSES;
    return PRISMA_ORB_FADING_CLASSES;
}

function phaseTransitionDurationMs(phase: Exclude<PrismaOrbPresentationPhase, 'hidden'>): number {
    return phase === 'fading' ? PRISMA_ORB_FADE_DURATION_MS : PRISMA_ORB_GROW_DURATION_MS;
}

export default function PrismaOrbOverlay({ phase, orbRef, config }: PrismaOrbOverlayProps) {
    if (phase === 'hidden') {
        return null;
    }

    return (
        <div
            aria-hidden="true"
            data-testid="prisma-orb-overlay"
            data-phase={phase}
            className={`pointer-events-none fixed left-1/2 top-[46px] z-[100] size-[min(var(--prisma-orb-size),calc(var(--viewport-width)-2rem),calc(var(--viewport-height)-62px))] -translate-x-1/2 bg-transparent transition-[opacity,transform] ease-out motion-reduce:transition-none motion-reduce:duration-0 ${phaseClasses(phase)}`}
            style={{
                '--prisma-orb-size': `${config.size}px`,
                transitionDuration: `${phaseTransitionDurationMs(phase)}ms`,
            } as CSSProperties}
        >
            <PrismaOrb config={config} orbRef={orbRef} />
        </div>
    );
}
