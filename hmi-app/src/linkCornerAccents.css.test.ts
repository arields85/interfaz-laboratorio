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
        expect(root).toContain('--link-accent-length-rest: 30px;');
        expect(root).toContain('--link-accent-length-hover: 22px;');
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
        // Auto (frame radius + offset) unless the Tema radius slider writes `--link-accent-radius` on the root.
        expect(body).toContain(
            '--link-accent-r: var(--link-accent-radius, calc(var(--frame-radius-rest) + var(--link-accent-offset)));',
        );
    });

    it('starts from the rest tokens on the registered accent properties', () => {
        const body = rule('.hmi-link-accents');

        expect(body).toContain('--frame-accent-length: var(--link-accent-length-rest);');
        expect(body).toContain('--frame-accent-thickness: var(--link-accent-thickness-rest);');
        expect(body).toContain('--frame-accent-color: var(--link-accent-color-rest);');
        expect(body).toContain('--frame-accent-opacity: var(--link-accent-opacity-rest);');
    });

    it('draws each bracket as the corner ARC plus a straight tail: a rounded border masked to the four corners', () => {
        const body = rule('.hmi-link-accents');

        // Drawn 4 px outside the widget there is no frame border to complete the corner curve, so straight gradients
        // clipped by the rounding look cut (user, 2026-09-30): the border follows the arc and the mask keeps only the
        // corner squares. No background gradients.
        expect(body).not.toContain('linear-gradient(var(--frame-accent-tint)');
        expect(body).toContain('border: var(--frame-accent-thickness) solid var(--frame-accent-tint);');
        expect(body).toContain('--frame-accent-tint: color-mix(in srgb, var(--frame-accent-color) var(--frame-accent-opacity), transparent);');
        expect(body).toContain('-webkit-mask-position: top left, top right, bottom left, bottom right;');
        expect(body).toContain('mask-position: top left, top right, bottom left, bottom right;');
        expect(body).toContain('mask-repeat: no-repeat;');
        expect(body).toContain(
            'transition: --frame-accent-length 0.2s ease, --frame-accent-thickness 0.2s ease,\n      --frame-accent-color 0.2s ease, --frame-accent-opacity 0.2s ease;',
        );
    });

    it('sizes each visible corner square by the length measured from the middle of the arc (0 = nothing visible)', () => {
        const body = rule('.hmi-link-accents');

        // Measured from the MIDDLE of the arc, not from the box corner: the arc's middle sits at r * (1 - 1/sqrt 2)
        // ~= 0.2929 r from the corner on each axis, so 0 shows nothing and any small value already reveals a piece of
        // arc whatever the radius (from the corner, a 5 px length showed nothing with a 19 px radius).
        expect(body).toContain('--link-accent-r: var(--link-accent-radius, calc(var(--frame-radius-rest) + var(--link-accent-offset)));');
        expect(body).toContain('border-radius: var(--link-accent-r);');
        expect(body).toContain('--link-accent-reach: calc(var(--link-accent-r) * 0.2929 + var(--frame-accent-length));');
        expect(body).toContain('-webkit-mask-size: var(--link-accent-reach) var(--link-accent-reach);');
        expect(body).toContain('mask-size: var(--link-accent-reach) var(--link-accent-reach);');
        expect(body).not.toContain('--link-accent-corner');
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
