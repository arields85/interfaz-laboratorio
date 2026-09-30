import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source-contract assertions for the tab frame shape ("Forma del marco" = Pestaña), in the same
// style as `index.css.test.ts`: jsdom does not compute clip-path / color-mix, so the CSS text is
// the contract and `npm run build` proves it compiles.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, './index.css'), 'utf-8');

function ruleBody(selectorPattern: string): string {
    // Anchored at the start of a line so a selector list or a comment mention never matches.
    const rule = indexCss.match(new RegExp(`\\n\\s*${selectorPattern}\\s*{([^}]*)}`));
    expect(rule).not.toBeNull();

    return rule?.[1] ?? '';
}

describe('index.css tab frame shape', () => {
    it('defines the geometry and color tokens with the measured defaults next to the frame tokens', () => {
        const root = indexCss.match(/:root\s*{([^}]*--tab-frame-height[^}]*)}/s)?.[1] ?? '';

        expect(root).toContain('--tab-frame-height: 25px;');
        expect(root).toContain('--tab-frame-tab-cut: 19px;');
        expect(root).toContain('--tab-frame-body-cut: 0px;');
        expect(root).toContain('--tab-frame-fill: color-mix(in srgb, #fff 15%, transparent);');
        expect(root).toContain('--tab-frame-text: color-mix(in srgb, #fff 70%, transparent);');
        expect(root).toContain('--tab-frame-text-hover: #fff;');
        expect(root).toContain('--tab-frame-pad-start: 0.625rem;');
        expect(root).toContain('--tab-frame-gap: 0.375rem;');
        expect(root).toContain('--tab-frame-alert-fill-opacity: 40%;');
        expect(root).toContain('--tab-frame-glow-blur: 7px;');
        expect(root).toContain('--tab-frame-glow-blur-hover: 9px;');
        expect(root).toContain('--tab-frame-glow-spread: 2px;');
        expect(root).toContain('--tab-frame-pad-end:');
        expect(root).toContain('--tab-frame-icon-right: 0px;');
        expect(root).toContain('--tab-frame-icon-gap: 4px;');
        expect(root).toContain('--tab-frame-icon-clearance: 3px;');
        expect(root).toContain('--tab-frame-icon-min-top: 0px;');
        expect(root).toContain('--tab-frame-icon-scale: 0.9;');
        expect(root).toContain('--tab-frame-icon-tab-gap: 8px;');
        expect(root).not.toContain('--tab-frame-icon-shift');
        // Breathing space above and below a title that has its own size (group): the standard tab's
        // 25 px around the 11 px x 1.5 line box of the standard title = 4.25 px.
        expect(root).toContain('--tab-frame-title-pad-y: 4.25px;');
    });

    it('keeps the base .glass-panel rule untouched by the tab shape (opt-in classes only)', () => {
        const base = indexCss.match(/\.glass-panel\s*{([\s\S]*?)\n {2}}/)?.[1] ?? '';

        expect(base).not.toContain('tab-frame');
        expect(base).not.toContain('clip-path');
    });

    it('falls back to the chamfered polygon (measured path takes over inline), with no CSS border or shadow of its own', () => {
        const body = ruleBody('\\.hmi-tab-frame > \\.hmi-tab-frame-surface');

        expect(body).toContain('position: absolute;');
        expect(body).toContain('inset: 0;');
        expect(body).toContain('pointer-events: none;');
        // The border is the SVG stroke and the glow its own layer: a CSS border/shadow would draw on the tab and be clipped.
        expect(body).toContain('border: none;');
        expect(body).toContain('box-shadow: none;');
        expect(body).toMatch(
            /clip-path:\s*polygon\(\s*0 0,\s*calc\(100% - var\(--tab-frame-body-cut\)\) 0,\s*100% var\(--tab-frame-body-cut\),\s*100% 100%,\s*0 100%\s*\);/,
        );
        expect(body).not.toContain('border-radius');
    });

    it('paints the tab fill as a strip inside the clipped surface, so the tab takes the unified silhouette', () => {
        const body = ruleBody('\\.hmi-tab-frame-fill');

        expect(body).toContain('position: absolute;');
        expect(body).toContain('height: var(--tab-frame-height);');
        expect(body).toContain('background: var(--tab-frame-fill);');
    });

    it('strokes the SVG border path at twice the stroke width (the surface clip keeps the inner half) and skips the tab strip', () => {
        const svg = ruleBody('\\.hmi-tab-frame-border');
        expect(svg).toContain('position: absolute;');
        expect(svg).toContain('inset: 0;');
        // The rest border follows the body only: the tab strip has no border.
        expect(svg).toContain('clip-path: inset(var(--tab-frame-height) 0 0 0);');

        const stroke = ruleBody('\\.hmi-tab-frame-border > path');
        expect(stroke).toContain('fill: none;');
        expect(stroke).toContain('stroke: var(--tab-frame-stroke-color);');
        expect(stroke).toContain('stroke-width: calc(var(--tab-frame-stroke-width) * 2);');
        expect(stroke).toMatch(/transition:\s*stroke 0\.2s ease;/);
    });

    it('takes the overlay color from the preset border token at rest and hover', () => {
        const surface = ruleBody('\\.hmi-tab-frame-surface');

        expect(surface).toContain('--tab-frame-stroke-width: 1px;');
        expect(surface).toContain('--tab-frame-stroke-color: color-mix(in srgb, #fff var(--frame-border), transparent);');
    });

    it.each([
        ['warning', 35, 55],
        ['critical', 35, 55],
    ])('follows the %s state border color (2px, %i%% at rest, %i%% on hover)', (state, rest, hover) => {
        const restBody = ruleBody(`\\.hmi-tab-frame-surface\\.widget-state-${state}`);
        expect(restBody).toContain('--tab-frame-stroke-width: 2px;');
        expect(restBody).toContain(`--tab-frame-stroke-color: color-mix(in srgb, var(--color-status-${state}) ${rest}%, transparent);`);

        const hoverBody = ruleBody(`\\.hmi-tab-frame:hover > \\.hmi-tab-frame-surface\\.widget-state-${state}`);
        expect(hoverBody).toContain(`--tab-frame-stroke-color: color-mix(in srgb, var(--color-status-${state}) ${hover}%, transparent);`);
        // The glow is its own layer now: the surface never carries a shadow or a CSS border color.
        expect(hoverBody).not.toContain('box-shadow');
        expect(hoverBody).not.toContain('border-color');
    });

    it('swaps the theme hover tokens on the state surfaces when the shell is hovered', () => {
        const hoverBody = ruleBody('\\.hmi-tab-frame:hover > \\.hmi-tab-frame-surface\\.widget-state-warning');

        expect(hoverBody).toContain('--frame-radius: var(--frame-radius-hover);');
        expect(hoverBody).toContain('--frame-blur: var(--frame-blur-hover);');
    });

    it.each(['warning', 'critical'])('fills the tab with the %s color at the alert fill opacity when the widget is in that state', (state) => {
        const body = ruleBody(`\\.hmi-tab-frame\\[data-alert-state='${state}'\\]`);

        expect(body).toContain(`--tab-frame-fill: color-mix(in srgb, var(--color-status-${state}) var(--tab-frame-alert-fill-opacity), transparent);`);
    });

    it.each([
        ['warning', 20, 28],
        ['critical', 20, 28],
    ])('recovers the %s glow of the standard frame (same color, %i%% at rest, blur grows with %i%% on hover), outside the silhouette only', (state, rest, hover) => {
        const layer = ruleBody('\\.hmi-tab-frame-glow');
        expect(layer).toContain('position: absolute;');
        expect(layer).toContain('inset: 0;');
        expect(layer).toContain('pointer-events: none;');
        expect(layer).toContain('filter: blur(var(--tab-frame-glow-blur));');
        expect(layer).toMatch(/transition:\s*filter 0\.2s ease;/);

        const shape = ruleBody(`\\.hmi-tab-frame-glow\\[data-alert-state='${state}'\\] > \\.hmi-tab-frame-glow-shape`);
        expect(shape).toContain(`background-color: color-mix(in srgb, var(--color-status-${state}) ${rest}%, transparent);`);

        const hoverLayer = ruleBody('\\.hmi-tab-frame:hover > \\.hmi-tab-frame-glow');
        expect(hoverLayer).toContain('filter: blur(var(--tab-frame-glow-blur-hover));');

        const hoverShape = ruleBody(`\\.hmi-tab-frame:hover > \\.hmi-tab-frame-glow\\[data-alert-state='${state}'\\] > \\.hmi-tab-frame-glow-shape`);
        expect(hoverShape).toContain(`background-color: color-mix(in srgb, var(--color-status-${state}) ${hover}%, transparent);`);
    });

    it('lays the tab out with the start padding and gap tokens; its fill lives in the surface strip, not on the tab', () => {
        const body = ruleBody('\\.hmi-tab-frame-tab');

        expect(body).toContain('position: absolute;');
        expect(body).toContain('top: 0;');
        expect(body).toContain('left: 0;');
        expect(body).toContain('height: var(--tab-frame-height);');
        expect(body).toContain('max-width: calc(100% - var(--tab-frame-tab-reserve, var(--tab-frame-body-cut)));');
        expect(body).toContain('gap: var(--tab-frame-gap);');
        expect(body).toContain('padding-left: var(--tab-frame-pad-start);');
        expect(body).toContain('padding-right: calc(var(--tab-frame-tab-cut) + var(--tab-frame-pad-end));');
        expect(body).toContain('color: var(--tab-frame-text);');
        // A capped tab on a short widget clips its title instead of letting it spill over the body.
        expect(body).toContain('overflow: hidden;');
        expect(body).not.toContain('background');
        expect(body).not.toContain('clip-path');
    });

    it('places the header icon in its own host: fixed right distance, top from the measured placement', () => {
        const body = ruleBody('\\.hmi-tab-frame-icon-host');

        expect(body).toContain('position: absolute;');
        expect(body).toContain('top: var(--tab-frame-icon-top, var(--tab-frame-icon-min-top));');
        expect(body).toContain('right: var(--tab-frame-icon-right);');
        // Scaled toward the top-right corner, so a zero margin keeps it flush with that corner.
        expect(body).toContain('transform: scale(var(--tab-frame-icon-scale));');
        expect(body).toContain('transform-origin: top right;');
        expect(indexCss).not.toContain('--tab-frame-icon-shift');
    });

    it('makes the tab stop before the icon only when the frame holds an icon', () => {
        const body = ruleBody('\\.hmi-tab-frame:has\\(> \\.hmi-tab-frame-icon-host > \\*\\)');

        expect(body).toContain('--tab-frame-tab-reserve: var(--tab-frame-icon-reserve, var(--tab-frame-body-cut));');
    });

    it('does not hardcode colors in the tab rules other than the fill token definition', () => {
        const block = indexCss.slice(indexCss.indexOf('Forma del marco: Pestaña (reglas)'));

        expect(block.length).toBeGreaterThan(0);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!\s*var)/);
    });

    it('leaves the viewer entrance flash clip to the inline path: no polygon rule for the tab flash remains', () => {
        expect(indexCss).not.toContain('hmi-viewer-entrance-flash-tab');
        expect(indexCss).not.toContain('--tab-frame-tab-width');
        expect(indexCss).not.toContain('--tab-frame-tab-base');
    });

    it('reserves the frame border width on the content element so nothing moves (the border now lives on the surface)', () => {
        const rest = ruleBody('\\.hmi-tab-frame > \\.hmi-tab-frame-surface \\+ \\*');
        expect(rest).toContain('border: 1px solid transparent;');

        const state = indexCss.match(
            /\.hmi-tab-frame > \.hmi-tab-frame-surface\.widget-state-warning \+ \*,\s*\n\s*\.hmi-tab-frame > \.hmi-tab-frame-surface\.widget-state-critical \+ \*\s*{([^}]*)}/,
        );
        expect(state).not.toBeNull();
        expect(state?.[1]).toContain('border-width: 2px;');
    });
});
