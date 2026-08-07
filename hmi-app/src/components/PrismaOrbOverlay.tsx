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

export default function PrismaOrbOverlay({ phase, orbRef, config }: PrismaOrbOverlayProps) {
    if (phase === 'hidden') {
        return null;
    }

    return (
        <div
            aria-hidden="true"
            data-testid="prisma-orb-overlay"
            className={`pointer-events-none fixed left-1/2 top-[46px] z-[100] size-[min(var(--prisma-orb-size),calc(100vw-2rem),calc(100vh-62px))] -translate-x-1/2 bg-transparent transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${phase === 'fading' ? 'opacity-0' : 'opacity-100'}`}
            style={{ '--prisma-orb-size': `${config.size}px` } as CSSProperties}
        >
            <PrismaOrb config={config} orbRef={orbRef} />
        </div>
    );
}
