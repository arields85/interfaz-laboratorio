import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// jsdom computes no masks or color-mix: like `index.css.test.ts` this asserts the source contract of the
// icon cutout ("Calado del ícono") and leaves the pixels to the browser check.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, './index.css'), 'utf-8');

function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = indexCss.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*{([\\s\\S]*?)\\n {2}}`));
    expect(match, `${selector} rule not found`).not.toBeNull();

    return match?.[1] ?? '';
}

describe('index.css icon cutout', () => {
    it('defines the tokens with the lab defaults: 6px margin, hard edge, ring on, 1px ring', () => {
        const root = indexCss.match(/:root\s*{([^}]*--icon-cutout-margin[^}]*)}/s)?.[1] ?? '';

        expect(root).toContain('--icon-cutout-margin: 6px;');
        expect(root).toContain('--icon-cutout-feather: 0px;');
        expect(root).toContain('--icon-cutout-ring: 1;');
        expect(root).toContain('--icon-cutout-ring-width: 1px;');
    });

    it('builds the hole as a radial mask centered on the published icon center, radius = half icon + margin', () => {
        const body = rule('[data-icon-cutout]');

        expect(body).toContain('--icon-cutout-radius: calc(var(--icon-cutout-half) + var(--icon-cutout-margin));');
        expect(body).toMatch(/--icon-cutout-hole:\s*radial-gradient\(\s*circle at var\(--icon-cutout-x\) var\(--icon-cutout-y\),\s*transparent calc\(/);
        expect(body).toContain('var(--icon-cutout-feather)');
        expect(body).toContain('var(--icon-cutout-ring)');
        expect(body).toContain('isolation: isolate;');
    });

    it('moves the fill, blur and border of the frame to a ::before, masked with the hole', () => {
        const body = rule('[data-icon-cutout]::before');

        expect(body).toContain("content: '';");
        expect(body).toContain('z-index: -1;');
        expect(body).toContain('pointer-events: none;');
        expect(body).toContain('border-radius: inherit;');
        expect(body).toContain('background-origin: border-box;');
        expect(body).toContain('var(--frame-base-background)');
        expect(body).toMatch(/color-mix\(in srgb, #fff var\(--frame-fill\), transparent\)/);
        expect(body).toMatch(/border:\s*1px solid color-mix\(in srgb, #fff var\(--frame-border\), transparent\);/);
        expect(body).toContain('backdrop-filter: blur(var(--frame-blur));');
        expect(body).toContain('-webkit-backdrop-filter: blur(var(--frame-blur));');
        expect(body).toContain('mask-image: var(--icon-cutout-hole);');
        expect(body).toContain('-webkit-mask-image: var(--icon-cutout-hole);');
    });

    it('draws the ring as the top layer of the ::before, in the frame border color', () => {
        const frame = rule('[data-icon-cutout]');

        expect(frame).toMatch(/--icon-cutout-ring-layer:\s*radial-gradient\(\s*circle at var\(--icon-cutout-x\) var\(--icon-cutout-y\),[\s\S]*var\(--icon-cutout-ring-color\)/);
        expect(frame).toMatch(/--icon-cutout-ring-color:\s*color-mix\(in srgb, #fff var\(--frame-border\), transparent\);/);
        expect(rule('[data-icon-cutout]::before')).toMatch(/background:\s*var\(--icon-cutout-ring-layer\),/);
    });

    it('clears the frame own background, border color and blur, also on hover, so only the ::before paints them', () => {
        const match = indexCss.match(/\[data-icon-cutout\],\s*\n\s*\[data-icon-cutout\]:hover\s*{([\s\S]*?)\n {2}}/);
        expect(match).not.toBeNull();
        const body = match?.[1] ?? '';

        expect(body).toContain('background: none;');
        expect(body).toContain('border-color: transparent;');
        expect(body).toContain('backdrop-filter: none;');
        expect(body).toContain('-webkit-backdrop-filter: none;');
    });

    it('lets the ::before paint over the border area (clip margin on the opt-in frame only)', () => {
        expect(rule('[data-icon-cutout]')).toContain('overflow-clip-margin: 1px;');
    });

    it('intersects the corner accent (::after) with the same hole', () => {
        const body = rule('[data-icon-cutout]::after');

        expect(body).toContain('mask-image: var(--icon-cutout-hole);');
        expect(body).toContain('-webkit-mask-image: var(--icon-cutout-hole);');
    });

    it('moves the alert background and 2px border to the ::before and keeps the state color on ring and hover', () => {
        for (const state of ['warning', 'critical']) {
            const rest = rule(`[data-icon-cutout].widget-state-${state}`);
            expect(rest).toContain(`--icon-cutout-state: var(--color-status-${state});`);
            expect(rest).toContain('--icon-cutout-ring-width: 2px;');
            expect(rest).toContain('overflow-clip-margin: 2px;');
            expect(rest).toMatch(/--icon-cutout-ring-color:\s*color-mix\(in srgb, var\(--icon-cutout-state\) 35%, transparent\);/);

            const before = rule(`[data-icon-cutout].widget-state-${state}::before`);
            expect(before).toContain('inset: -2px;');
            expect(before).toContain('border: 2px solid color-mix(in srgb, var(--icon-cutout-state) 35%, transparent);');
            expect(before).toMatch(/linear-gradient\(\s*135deg,\s*color-mix\(in srgb, var\(--icon-cutout-state\) 12%, transparent\) 0%,\s*color-mix\(in srgb, var\(--icon-cutout-state\) 2%, transparent\) 100%\s*\)/);

            expect(before).toMatch(/background:\s*var\(--icon-cutout-ring-layer\),/);
        }

        const hover = indexCss.match(/\[data-icon-cutout\]\.widget-state-warning:hover,\s*\n\s*\[data-icon-cutout\]\.widget-state-critical:hover\s*{([\s\S]*?)\n {2}}/)?.[1] ?? '';
        expect(hover).toMatch(/--icon-cutout-ring-color:\s*color-mix\(in srgb, var\(--icon-cutout-state\) 55%, transparent\);/);

        const hoverBefore = indexCss.match(/\[data-icon-cutout\]\.widget-state-warning:hover::before,\s*\n\s*\[data-icon-cutout\]\.widget-state-critical:hover::before\s*{([\s\S]*?)\n {2}}/)?.[1] ?? '';
        expect(hoverBefore).toContain('border-color: color-mix(in srgb, var(--icon-cutout-state) 55%, transparent);');
    });

    it('never touches the base .glass-panel rule (dialogs, pages and skeletons)', () => {
        const panel = indexCss.match(/(?<!-)\.glass-panel\s*{([\s\S]*?)\n {2}}/)?.[1] ?? '';

        expect(panel).not.toMatch(/icon-cutout/);
        expect(panel).not.toContain('::before');
        expect(panel).not.toMatch(/overflow-clip-margin/);
        expect(indexCss).not.toMatch(/\.glass-panel[^\n{]*icon-cutout/);
    });

    it('opts in only through the attribute: no cutout selector targets a bare class', () => {
        const selectors = indexCss.match(/[^\n{}]*icon-cutout[^\n{}]*{/g) ?? [];

        expect(selectors.length).toBeGreaterThan(0);
        for (const selector of selectors.filter((line) => !line.trim().startsWith('--') && !line.includes('@property'))) {
            expect(selector, selector).toContain('[data-icon-cutout]');
        }
    });

    it('disables the ::before border transition under prefers-reduced-motion like the other frames', () => {
        const reduced = indexCss.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/)?.[1] ?? '';

        expect(reduced).toContain('[data-icon-cutout]::before');
    });
});
