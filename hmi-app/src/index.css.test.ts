import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// jsdom does not compute CSS (backdrop-filter, color-mix, @property, custom-property
// transitions are not observable via getComputedStyle in tests). This suite instead
// asserts the source contract for the widget frame theme engine, following the same
// technique already used by HeaderWidgetCanvas.test.tsx / BuilderCanvas.test.tsx for
// the reduced-motion rule. `npx vite build` (see task verification) proves the CSS
// actually compiles.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, './index.css'), 'utf-8');

describe('index.css widget frame theme engine', () => {
    it('registers the animatable frame custom properties with @property', () => {
        expect(indexCss).toMatch(/@property --frame-radius\s*{\s*syntax:\s*'<length>';/);
        expect(indexCss).toMatch(/@property --frame-fill\s*{\s*syntax:\s*'<percentage>';/);
        expect(indexCss).toMatch(/@property --frame-border\s*{\s*syntax:\s*'<percentage>';/);
        expect(indexCss).toMatch(/@property --frame-blur\s*{\s*syntax:\s*'<length>';/);
        expect(indexCss).toMatch(/@property --frame-accent-length\s*{\s*syntax:\s*'<length>';/);
        expect(indexCss).toMatch(/@property --frame-accent-thickness\s*{\s*syntax:\s*'<length>';/);
        expect(indexCss).toMatch(/@property --frame-accent-color\s*{\s*syntax:\s*'<color>';/);
        expect(indexCss).toMatch(/@property --frame-accent-opacity\s*{\s*syntax:\s*'<percentage>';/);
    });

    it('defaults reproduce today\'s Clasico look exactly (rest/hover pairs)', () => {
        const rootBlock = indexCss.match(/:root\s*{([^}]*--frame-radius-rest[^}]*)}/s);
        expect(rootBlock).not.toBeNull();
        const root = rootBlock?.[1] ?? '';

        expect(root).toContain('--frame-radius-rest: 1.5rem;');
        expect(root).toContain('--frame-radius-hover: 1.5rem;');
        expect(root).toContain('--frame-blur-rest: 12px;');
        expect(root).toContain('--frame-blur-hover: 12px;');
        expect(root).toContain('--frame-accent-opacity-rest: 0%;');
        expect(root).toContain('--frame-accent-opacity-hover: 0%;');
        expect(root).toMatch(/--frame-base-background:\s*linear-gradient\(\s*135deg,\s*rgba\(255, 255, 255, 0\.05\) 0%,\s*rgba\(255, 255, 255, 0\.01\) 100%\s*\);/);
    });

    it('drives .glass-panel radius/fill/border/blur from the live theme custom properties', () => {
        const rule = indexCss.match(/\.glass-panel\s*{([\s\S]*?)\n {2}}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('border-radius: var(--frame-radius);');
        expect(body).toContain('backdrop-filter: blur(var(--frame-blur));');
        expect(body).toMatch(/border:\s*1px solid color-mix\(in srgb, #fff var\(--frame-border\), transparent\);/);
        expect(body).toMatch(/color-mix\(in srgb, #fff var\(--frame-fill\), transparent\)/);
        expect(body).toContain('var(--frame-base-background)');
        expect(body).toContain('overflow: clip;');
        expect(body).toContain('overflow-clip-margin:');
        expect(body).toMatch(/transition:[\s\S]*--frame-radius[\s\S]*;/);
    });

    it('swaps every frame custom property to its hover value on :hover', () => {
        const rule = indexCss.match(/\.glass-panel:hover,\s*\n\s*\.group:hover \.glass-panel\s*{([\s\S]*?)}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('--frame-radius: var(--frame-radius-hover);');
        expect(body).toContain('--frame-fill: var(--frame-fill-hover);');
        expect(body).toContain('--frame-border: var(--frame-border-hover);');
        expect(body).toContain('--frame-blur: var(--frame-blur-hover);');
        expect(body).toContain('--frame-accent-length: var(--frame-accent-length-hover);');
        expect(body).toContain('--frame-accent-opacity: var(--frame-accent-opacity-hover);');
    });

    it('paints the corner accent from an ::after masked to the four corners, without a hardcoded accent on glass-panel-danger/warning', () => {
        expect(indexCss).toMatch(/\.glass-panel::after,/);
        expect(indexCss).not.toMatch(/\.glass-panel-danger::(before|after)/);
        expect(indexCss).not.toMatch(/\.glass-panel-warning::(before|after)/);

        const rule = indexCss.match(/\.glass-panel::after,[\s\S]*?{\s*\n\s*content: '';([\s\S]*?)\n {2}}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('--frame-accent-tint: color-mix(in srgb, var(--frame-accent-color) var(--frame-accent-opacity), transparent);');
        expect(body).toContain('background-position: top left, top left, top right, top right, bottom left, bottom left, bottom right, bottom right;');
    });

    it('drives .widget-state-warning/-critical radius and blur from the theme without touching their semantic colors', () => {
        const warningRule = indexCss.match(/\.widget-state-warning\s*{\s*\n\s*--frame-radius: var\(--frame-radius-rest\);([\s\S]*?)\n {2}}/);
        expect(warningRule).not.toBeNull();
        const warningBody = warningRule?.[1] ?? '';

        expect(warningBody).toContain('border-radius: var(--frame-radius);');
        expect(warningBody).toContain('backdrop-filter: blur(var(--frame-blur));');
        expect(warningBody).toMatch(/color-mix\(in srgb, var\(--color-status-warning\)/);
        expect(warningBody).toContain('overflow: clip;');

        const criticalRule = indexCss.match(/\.widget-state-critical\s*{\s*\n\s*--frame-radius: var\(--frame-radius-rest\);([\s\S]*?)\n {2}}/);
        expect(criticalRule).not.toBeNull();
        const criticalBody = criticalRule?.[1] ?? '';

        expect(criticalBody).toContain('border-radius: var(--frame-radius);');
        expect(criticalBody).toContain('backdrop-filter: blur(var(--frame-blur));');
        expect(criticalBody).toMatch(/color-mix\(in srgb, var\(--color-status-critical\)/);
    });

    it('disables the frame theme transitions under prefers-reduced-motion', () => {
        const reducedMotionBlock = indexCss.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/);
        expect(reducedMotionBlock).not.toBeNull();
        const body = reducedMotionBlock?.[1] ?? '';

        expect(body).toMatch(/\.glass-panel,[\s\S]*\.widget-state-warning,[\s\S]*\.widget-state-critical\s*{\s*transition: none;\s*}/);
    });
});
