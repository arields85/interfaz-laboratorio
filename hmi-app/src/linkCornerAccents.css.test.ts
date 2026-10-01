import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// jsdom paints nothing: like `iconCutout.css.test.ts` this asserts the source contract of the link
// corner accents layer and leaves the pixels to the browser check.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, './index.css'), 'utf-8').replaceAll('\r\n', '\n');

function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = indexCss.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*{([\\s\\S]*?)\\n\\s*}`));
    expect(match, `${selector} rule not found`).not.toBeNull();

    return match?.[1] ?? '';
}

describe('link corner accents tokens', () => {
    const root = indexCss.match(/:root {([^}]*--link-accent-offset[^}]*)}/)?.[1] ?? '';

    it('declares the offset (4px) and the Contorno accent values as tokens', () => {
        expect(root).toContain('--link-accent-offset: 4px;');
        expect(root).toContain('--link-accent-length-rest: 12px;');
        expect(root).toContain('--link-accent-length-hover: 6px;');
        expect(root).toContain('--link-accent-thickness-rest: 1px;');
        expect(root).toContain('--link-accent-thickness-hover: 1px;');
        expect(root).toContain('--link-accent-color-rest: #ffffff;');
        expect(root).toContain('--link-accent-color-hover: #ffffff;');
        expect(root).toContain('--link-accent-opacity-rest: 0%;');
        expect(root).toContain('--link-accent-opacity-hover: 60%;');
    });
});

describe('link corner accents layer', () => {
    it('is an inert absolute layer rounded like the widget corners (frame radius + offset)', () => {
        const body = rule('.hmi-link-accents');

        expect(body).toContain('position: absolute;');
        expect(body).toContain('pointer-events: none;');
        expect(body).toContain('border-radius: calc(var(--frame-radius-rest) + var(--link-accent-offset));');
    });

    it('starts from the rest tokens on the registered accent properties', () => {
        const body = rule('.hmi-link-accents');

        expect(body).toContain('--frame-accent-length: var(--link-accent-length-rest);');
        expect(body).toContain('--frame-accent-thickness: var(--link-accent-thickness-rest);');
        expect(body).toContain('--frame-accent-color: var(--link-accent-color-rest);');
        expect(body).toContain('--frame-accent-opacity: var(--link-accent-opacity-rest);');
    });

    it('draws the lab brackets: 8 straight gradients as background on an invisible rounded outer frame', () => {
        const body = rule('.hmi-link-accents');

        // The rounding clips the gradient ends at the corners, exactly like `.glass-panel::after`; no border, no mask.
        expect(body).not.toMatch(/(^|\s)border:/);
        expect(body).not.toContain('mask');
        expect(body.match(/linear-gradient\(/g)).toHaveLength(8);
        expect(body).toContain('background-repeat: no-repeat;');
        expect(body).toContain('background-position: top left, top left, top right, top right, bottom left, bottom left, bottom right, bottom right;');
        expect(body).toContain('--frame-accent-tint: color-mix(in srgb, var(--frame-accent-color) var(--frame-accent-opacity), transparent);');
        expect(body).toContain(
            'transition: --frame-accent-length 0.2s ease, --frame-accent-thickness 0.2s ease,\n      --frame-accent-color 0.2s ease, --frame-accent-opacity 0.2s ease;',
        );
    });

    it('measures the length from where the corner curve ends: the gradient runs radius + offset + length along the edge', () => {
        const body = rule('.hmi-link-accents');
        const along = 'calc(var(--frame-radius-rest) + var(--link-accent-offset) + var(--frame-accent-length))';

        expect(body).toContain(`--link-accent-reach: ${along};`);
        expect(body).toContain('var(--link-accent-reach) var(--frame-accent-thickness),');
        expect(body).toContain('var(--frame-accent-thickness) var(--link-accent-reach),');
        expect(body).not.toContain('var(--frame-accent-length) var(--frame-accent-thickness)');
    });

    it('switches to the hover tokens while the viewer item is hovered', () => {
        const body = indexCss.match(/\.hmi-link-accents-host:hover \.hmi-link-accents,[^{]*{([\s\S]*?)\n\s*}/)?.[1] ?? '';

        expect(body).toContain('--frame-accent-length: var(--link-accent-length-hover);');
        expect(body).toContain('--frame-accent-thickness: var(--link-accent-thickness-hover);');
        expect(body).toContain('--frame-accent-color: var(--link-accent-color-hover);');
        expect(body).toContain('--frame-accent-opacity: var(--link-accent-opacity-hover);');
    });

    it('also switches to the hover tokens while a member of its locked group is hovered (group hover target)', () => {
        // Members cover most of a group, so the group item itself is rarely `:hover`: the viewer marks it with
        // `data-group-hover-target` while any member is hovered (G5), and the accents must follow that too.
        const combined = indexCss.match(
            /\.hmi-link-accents-host:hover \.hmi-link-accents,\s*\.hmi-link-accents-host\[data-group-hover-target='true'\] \.hmi-link-accents\s*{([\s\S]*?)\n\s*}/,
        );

        expect(combined, 'combined hover rule not found').not.toBeNull();
        expect(combined?.[1]).toContain('--frame-accent-opacity: var(--link-accent-opacity-hover);');
    });

    it('disables its transition under prefers-reduced-motion like the other accents', () => {
        const reduced = indexCss.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/)?.[1] ?? '';

        expect(reduced).toContain('.hmi-link-accents');
    });
});
