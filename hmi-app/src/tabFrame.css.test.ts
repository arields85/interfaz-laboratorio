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
        expect(root).toContain('--tab-frame-tab-cut: var(--tab-frame-height);');
        expect(root).toContain('--tab-frame-body-cut: 50px;');
        expect(root).toContain('--tab-frame-fill: #a9aaad;');
        expect(root).toContain('--tab-frame-text: var(--color-industrial-bg);');
        expect(root).toContain('--tab-frame-pad-start: 1.25rem;');
        expect(root).toContain('--tab-frame-pad-end:');
        expect(root).toContain('--tab-frame-icon-shift-x:');
        expect(root).toContain('--tab-frame-icon-shift-y:');
    });

    it('keeps the base .glass-panel rule untouched by the tab shape (opt-in classes only)', () => {
        const base = indexCss.match(/\.glass-panel\s*{([\s\S]*?)\n {2}}/)?.[1] ?? '';

        expect(base).not.toContain('tab-frame');
        expect(base).not.toContain('clip-path');
    });

    it('clips the painted surface to the chamfered body silhouette below the tab strip, keeping the preset radius', () => {
        const body = ruleBody('\\.hmi-tab-frame > \\.hmi-tab-frame-surface');

        expect(body).toContain('position: absolute;');
        expect(body).toContain('inset: 0;');
        expect(body).toContain('pointer-events: none;');
        expect(body).toMatch(
            /clip-path:\s*polygon\(\s*0 var\(--tab-frame-height\),\s*calc\(100% - var\(--tab-frame-body-cut\)\) var\(--tab-frame-height\),\s*100% calc\(var\(--tab-frame-height\) \+ var\(--tab-frame-body-cut\)\),\s*100% 100%,\s*0 100%\s*\);/,
        );
        // Bottom corners keep the preset radius: the surface is still a .glass-panel and this rule never sets a radius.
        expect(body).not.toContain('border-radius');
    });

    it('draws the top edge and the 45deg diagonal border with an overlay band derived from the tokens', () => {
        const body = ruleBody('\\.hmi-tab-frame-surface > \\.hmi-tab-frame-border');

        expect(body).toContain('--tab-frame-band: calc(var(--tab-frame-stroke-width) * 1.4142);');
        expect(body).toContain('inset: calc(-1 * var(--tab-frame-stroke-width));');
        expect(body).toContain('background-color: var(--tab-frame-stroke-color);');
        expect(body).toMatch(/transition:\s*background-color 0\.2s ease;/);
        // Band polygon: top edge (stroke wide) and the diagonal (stroke wide measured perpendicular = width * sqrt(2) vertically).
        expect(body).toMatch(
            /clip-path:\s*polygon\(\s*0 var\(--tab-frame-height\),\s*calc\(100% - var\(--tab-frame-body-cut\)\) var\(--tab-frame-height\),\s*100% calc\(var\(--tab-frame-height\) \+ var\(--tab-frame-body-cut\)\),\s*100% calc\(var\(--tab-frame-height\) \+ var\(--tab-frame-body-cut\) \+ var\(--tab-frame-band\)\),/,
        );
        expect(body).toContain('calc(100% - var(--tab-frame-body-cut) + var(--tab-frame-stroke-width) - var(--tab-frame-band)) calc(var(--tab-frame-height) + var(--tab-frame-stroke-width))');
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
        expect(hoverBody).toContain(`border-color: color-mix(in srgb, var(--color-status-${state}) ${hover}%, transparent);`);
    });

    it('swaps the theme hover tokens on the state surfaces when the shell is hovered', () => {
        const hoverBody = ruleBody('\\.hmi-tab-frame:hover > \\.hmi-tab-frame-surface\\.widget-state-warning');

        expect(hoverBody).toContain('--frame-radius: var(--frame-radius-hover);');
        expect(hoverBody).toContain('--frame-blur: var(--frame-blur-hover);');
    });

    it('draws the tab with the fill and text tokens, its right side cut at 45deg by the tab cut', () => {
        const body = ruleBody('\\.hmi-tab-frame-tab');

        expect(body).toContain('position: absolute;');
        expect(body).toContain('top: 0;');
        expect(body).toContain('left: 0;');
        expect(body).toContain('height: var(--tab-frame-height);');
        expect(body).toContain('max-width: calc(100% - var(--tab-frame-body-cut));');
        expect(body).toContain('padding-left: var(--tab-frame-pad-start);');
        expect(body).toContain('padding-right: calc(var(--tab-frame-tab-cut) + var(--tab-frame-pad-end));');
        expect(body).toContain('background: var(--tab-frame-fill);');
        expect(body).toContain('color: var(--tab-frame-text);');
        expect(body).toMatch(/clip-path:\s*polygon\(0 0,\s*calc\(100% - var\(--tab-frame-tab-cut\)\) 0,\s*100% 100%,\s*0 100%\);/);
    });

    it('moves the header icon into the cut-off corner with the shift tokens', () => {
        const body = ruleBody('\\.hmi-tab-frame-icon');

        expect(body).toContain('transform: translate(var(--tab-frame-icon-shift-x), var(--tab-frame-icon-shift-y));');
    });

    it('does not hardcode colors in the tab rules other than the fill token definition', () => {
        const block = indexCss.slice(indexCss.indexOf('Forma del marco: Pestaña (reglas)'));

        expect(block.length).toBeGreaterThan(0);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!\s*var)/);
    });
});
