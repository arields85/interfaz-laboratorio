import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GaugeDisplay from './GaugeDisplay';

// jsdom cannot run CSS animations: this suite asserts the hooks the viewer entrance relies on
// (classes and the per-segment custom property) and the source contract of the entrance CSS.
// The inline width / dasharray values (asserted by GaugeDisplay.test.tsx) stay untouched: the
// keyframes are `from`-only, so the animation always ends at the element's own inline value.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, '../../index.css'), 'utf-8');

const COLOR = {
    primary: 'var(--color-accent-cyan)',
    gradient: ['var(--color-widget-gradient-from)', 'var(--color-widget-gradient-to)'] as [string, string],
};

describe('GaugeDisplay entrance hooks', () => {
    it('tags the bar fill for the value draw-in without changing its inline width', () => {
        render(<GaugeDisplay normalizedValue={0.4} mode="bar" color={COLOR} />);

        const fill = screen.getByTestId('gauge-bar-fill');

        expect(fill).toHaveClass('hmi-viewer-gauge-bar-fill');
        expect(fill.style.width).toBe('40%');
    });

    it('tags every ring segment with a stable sweep fraction from 0 to 1 (independent of the value)', () => {
        const { rerender } = render(<GaugeDisplay normalizedValue={0.4} color={COLOR} />);
        const readFractions = () => screen
            .getAllByTestId('gauge-circular-arc-segment')
            .map((segment) => segment.style.getPropertyValue('--viewer-gauge-segment-fraction'));

        const first = readFractions();

        expect(first).toHaveLength(90);
        expect(first[0]).toBe('0');
        expect(first[89]).toBe('1');
        expect(Number(first[45])).toBeCloseTo(45 / 89, 6);
        for (const segment of screen.getAllByTestId('gauge-circular-arc-segment')) {
            expect(segment).toHaveClass('hmi-viewer-gauge-ring-segment');
        }

        // A data refresh must not change the delays: a changed delay would replay the animation.
        rerender(<GaugeDisplay normalizedValue={0.9} color={COLOR} />);
        expect(readFractions()).toEqual(first);
    });

    it('tags the arc glow segments and the static top cap so they enter with the arc', () => {
        render(
            <GaugeDisplay
                normalizedValue={0.75}
                circularArcGlowIntensity={60}
                circularTopCap={{ enabled: true }}
                color={COLOR}
            />,
        );

        for (const glow of screen.getAllByTestId('gauge-circular-arc-glow-segment')) {
            expect(glow).toHaveClass('hmi-viewer-gauge-ring-segment');
        }
        expect(screen.getByTestId('gauge-circular-static-top-cap')).toHaveClass('hmi-viewer-gauge-ring-cap');
    });
});

describe('gauge entrance CSS contract (index.css)', () => {
    it('fills the bar from zero under the viewer scope, after its frame, with the value tokens', () => {
        const keyframes = indexCss.match(/@keyframes hmi-viewer-gauge-bar-fill\s*{([\s\S]*?)\r?\n}/);
        const rule = indexCss.match(/\[data-viewer-entrance='true'\] \.hmi-viewer-gauge-bar-fill\s*{([\s\S]*?)}/);

        expect(keyframes?.[1]).toMatch(/from\s*{\s*width:\s*0%;\s*}/);
        expect(keyframes?.[1]).not.toMatch(/\bto\s*{/);
        expect(rule?.[1]).toContain('animation-name: hmi-viewer-gauge-bar-fill;');
        expect(rule?.[1]).toContain('animation-duration: var(--viewer-entrance-value-duration);');
        expect(rule?.[1]).toContain('animation-timing-function: var(--viewer-entrance-ease);');
        expect(rule?.[1]).toContain(
            'animation-delay: calc(var(--viewer-entrance-item-delay, 0ms) + var(--viewer-entrance-value-offset));',
        );
        expect(rule?.[1]).toContain('animation-fill-mode: backwards;');
    });

    it('sweeps the ring segments over the value duration under the viewer scope', () => {
        const keyframes = indexCss.match(/@keyframes hmi-viewer-gauge-ring-segment\s*{([\s\S]*?)\r?\n}/);
        const rule = indexCss.match(/\[data-viewer-entrance='true'\] \.hmi-viewer-gauge-ring-segment\s*{([\s\S]*?)}/);

        expect(keyframes?.[1]).toMatch(/from\s*{\s*opacity:\s*0;\s*}/);
        expect(rule?.[1]).toContain('animation-duration: var(--viewer-entrance-ring-segment-fade);');
        expect(rule?.[1]).toContain('var(--viewer-entrance-item-delay, 0ms)');
        expect(rule?.[1]).toContain('var(--viewer-entrance-value-offset)');
        expect(rule?.[1]).toContain('var(--viewer-gauge-segment-fraction, 0)');
        expect(rule?.[1]).toContain('animation-fill-mode: backwards;');
    });

    it('turns the gauge value entrance off for reduced motion', () => {
        const reduced = [...indexCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\r?\n}\r?\n/g)]
            .map((match) => match[1])
            .join('\n');

        expect(reduced).toMatch(/\.hmi-viewer-gauge-bar-fill[\s\S]*?animation: none;/);
        expect(reduced).toMatch(/\.hmi-viewer-gauge-ring-segment[\s\S]*?animation: none;/);
    });
});
