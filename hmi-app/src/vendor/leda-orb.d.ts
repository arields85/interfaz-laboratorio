import type { DetailedHTMLProps, HTMLAttributes } from 'react';

export interface LedaOrbElement extends HTMLElement {
    level: number;
    setSpeaking(speaking: boolean): void;
}

interface LedaOrbAttributes extends DetailedHTMLProps<HTMLAttributes<LedaOrbElement>, LedaOrbElement> {
    rays?: string;
    intensity?: string;
    speed?: string;
    core?: string;
    glow?: string;
}

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            'leda-orb': LedaOrbAttributes;
        }
    }
}
