import type { CSSProperties, RefObject } from 'react';

import type { PrismaOrbVisualConfig } from '../domain/voice.types';
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
// first. The Tailwind arbitrary-duration classes below (`duration-[400ms]`,
// `duration-[700ms]`) must be kept in sync by hand with
// PRISMA_ORB_GROW_DURATION_MS and PRISMA_ORB_FADE_DURATION_MS in
// usePrismaOrbPresentation.ts -- Tailwind's class scanner needs the literal
// text in source and cannot read those constants at build time.
const PRISMA_ORB_THINKING_CLASSES = 'scale-75 opacity-60 duration-[400ms]';
const PRISMA_ORB_VISIBLE_CLASSES = 'scale-100 opacity-100 duration-[400ms]';
const PRISMA_ORB_FADING_CLASSES = 'scale-75 opacity-0 duration-[700ms]';

function phaseClasses(phase: Exclude<PrismaOrbPresentationPhase, 'hidden'>): string {
    if (phase === 'thinking') return PRISMA_ORB_THINKING_CLASSES;
    if (phase === 'visible') return PRISMA_ORB_VISIBLE_CLASSES;
    return PRISMA_ORB_FADING_CLASSES;
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
            style={{ '--prisma-orb-size': `${config.size}px` } as CSSProperties}
        >
            <PrismaOrb config={config} orbRef={orbRef} />
        </div>
    );
}
