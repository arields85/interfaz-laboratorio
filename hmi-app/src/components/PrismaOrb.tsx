import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { PrismaOrbVisualConfig } from '../domain/voice.types';
import type { LedaOrbElement } from '../vendor/leda-orb.js';
import '../vendor/leda-orb.js';

interface PrismaOrbProps {
    config: PrismaOrbVisualConfig;
    orbRef?: RefObject<LedaOrbElement | null>;
    speaking?: boolean;
    className?: string;
}

export default function PrismaOrb({
    config,
    orbRef,
    speaking,
    className = '',
}: PrismaOrbProps) {
    const internalRef = useRef<LedaOrbElement>(null);
    const resolvedRef = orbRef ?? internalRef;

    useLayoutEffect(() => {
        if (speaking === undefined) {
            return;
        }

        const orb = resolvedRef.current;
        orb?.setSpeaking(speaking);

        return () => {
            orb?.setSpeaking(false);
        };
    }, [resolvedRef, speaking]);

    return (
        <leda-orb
            ref={resolvedRef}
            rays={String(config.rays)}
            intensity={String(config.intensity)}
            speed={String(config.speed)}
            core={config.core}
            glow={config.glow}
            className={`block size-full ${className}`.trim()}
        />
    );
}
