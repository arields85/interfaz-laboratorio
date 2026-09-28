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
        expect(body).toContain('overflow: hidden;');
        expect(body).toContain('overflow: clip;');
        expect(body).toMatch(/transition:[\s\S]*--frame-radius[\s\S]*;/);
    });

    it('swaps every frame custom property to its hover value on :hover', () => {
        const rule = indexCss.match(/\.glass-panel:hover,\s*\n\s*\.group:hover \.glass-panel,\s*\n\s*\[data-group-hover-target="true"\] \.glass-panel\s*{([\s\S]*?)}/);
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

        const rule = indexCss.match(/\.glass-panel::after,\s*\n\s*\.widget-state-warning::after,\s*\n\s*\.widget-state-critical::after\s*{\s*\n\s*content: '';([\s\S]*?)\n {2}}/);
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

    it('declares overflow: hidden before overflow: clip as a fallback, with no clip-margin bleed', () => {
        const panelRule = indexCss.match(/\.glass-panel\s*{([\s\S]*?)\n {2}}/);
        expect(panelRule).not.toBeNull();
        const panelBody = panelRule?.[1] ?? '';
        expect(panelBody).toMatch(/overflow: hidden;\s*\n\s*overflow: clip;/);
        expect(panelBody).not.toMatch(/overflow-clip-margin/);

        const warningRule = indexCss.match(/\.widget-state-warning\s*{\s*\n\s*--frame-radius: var\(--frame-radius-rest\);([\s\S]*?)\n {2}}/);
        expect(warningRule).not.toBeNull();
        const warningBody = warningRule?.[1] ?? '';
        expect(warningBody).toMatch(/overflow: hidden;\s*\n\s*overflow: clip;/);
        expect(warningBody).not.toMatch(/overflow-clip-margin/);

        const criticalRule = indexCss.match(/\.widget-state-critical\s*{\s*\n\s*--frame-radius: var\(--frame-radius-rest\);([\s\S]*?)\n {2}}/);
        expect(criticalRule).not.toBeNull();
        const criticalBody = criticalRule?.[1] ?? '';
        expect(criticalBody).toMatch(/overflow: hidden;\s*\n\s*overflow: clip;/);
        expect(criticalBody).not.toMatch(/overflow-clip-margin/);
    });

    it('keeps the danger/warning semantic hover intensification untouched by the neutral frame hover swap', () => {
        // `.glass-panel:hover` must only swap the theme custom properties, never
        // declare `background`/`border` directly -- otherwise it could tie in
        // cascade order against `.glass-panel-danger:hover` / `-warning:hover`,
        // which still own the semantic literal intensification below.
        const neutralHoverRule = indexCss.match(/\.glass-panel:hover,\s*\n\s*\.group:hover \.glass-panel,\s*\n\s*\[data-group-hover-target="true"\] \.glass-panel\s*{([\s\S]*?)}/);
        expect(neutralHoverRule).not.toBeNull();
        const neutralHoverBody = neutralHoverRule?.[1] ?? '';
        expect(neutralHoverBody).not.toMatch(/(?<!-)\bbackground:/);
        expect(neutralHoverBody).not.toMatch(/(?<!-)\bborder(-color)?:/);

        const dangerHoverRule = indexCss.match(/\.glass-panel-danger:hover,\s*\n\s*\.group:hover \.glass-panel-danger\s*{([\s\S]*?)}/);
        expect(dangerHoverRule).not.toBeNull();
        const dangerHoverBody = dangerHoverRule?.[1] ?? '';
        expect(dangerHoverBody).toContain('color-mix(in srgb, var(--color-status-critical) 14%, transparent) 0%');
        expect(dangerHoverBody).toContain('color-mix(in srgb, var(--color-status-critical) 4%, transparent) 100%');
        expect(dangerHoverBody).toContain('border-color: color-mix(in srgb, var(--color-status-critical) 50%, transparent);');

        const warningHoverRule = indexCss.match(/\.glass-panel-warning:hover,\s*\n\s*\.group:hover \.glass-panel-warning\s*{([\s\S]*?)}/);
        expect(warningHoverRule).not.toBeNull();
        const warningHoverBody = warningHoverRule?.[1] ?? '';
        expect(warningHoverBody).toContain('color-mix(in srgb, var(--color-status-warning) 14%, transparent) 0%');
        expect(warningHoverBody).toContain('color-mix(in srgb, var(--color-status-warning) 4%, transparent) 100%');
        expect(warningHoverBody).toContain('border-color: color-mix(in srgb, var(--color-status-warning) 50%, transparent);');
    });

    it('disables the frame theme transitions under prefers-reduced-motion', () => {
        const reducedMotionBlock = indexCss.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/);
        expect(reducedMotionBlock).not.toBeNull();
        const body = reducedMotionBlock?.[1] ?? '';

        expect(body).toMatch(/\.glass-panel,[\s\S]*\.widget-state-warning,[\s\S]*\.widget-state-critical,[\s\S]*\.theme-button,[\s\S]*\.admin-accent-ghost\s*{\s*transition: none;\s*}/);
    });
});

describe('index.css button theme engine', () => {
    it('registers the animatable button custom properties with @property, including --button-base-strength', () => {
        expect(indexCss).toMatch(/@property --button-radius\s*{\s*syntax:\s*'<length>';/);
        expect(indexCss).toMatch(/@property --button-fill\s*{\s*syntax:\s*'<percentage>';/);
        expect(indexCss).toMatch(/@property --button-border\s*{\s*syntax:\s*'<percentage>';/);
        expect(indexCss).toMatch(/@property --button-accent-length\s*{\s*syntax:\s*'<length>';/);
        expect(indexCss).toMatch(/@property --button-accent-thickness\s*{\s*syntax:\s*'<length>';/);
        expect(indexCss).toMatch(/@property --button-accent-color\s*{\s*syntax:\s*'<color>';/);
        expect(indexCss).toMatch(/@property --button-accent-opacity\s*{\s*syntax:\s*'<percentage>';/);
        expect(indexCss).toMatch(/@property --button-base-strength\s*{\s*syntax:\s*'<percentage>';\s*\n\s*inherits: true;\s*\n\s*initial-value: 100%;/);
    });

    it('defaults reproduce today\'s look exactly: 0%/0% overlay at full (100%) own-color strength, rounded-md radius', () => {
        const rootBlock = indexCss.match(/:root\s*{([^}]*--button-radius-rest[^}]*)}/s);
        expect(rootBlock).not.toBeNull();
        const root = rootBlock?.[1] ?? '';

        expect(root).toContain('--button-radius-rest: 0.375rem;');
        expect(root).toContain('--button-radius-hover: 0.375rem;');
        expect(root).toContain('--button-fill-rest: 0%;');
        expect(root).toContain('--button-fill-hover: 0%;');
        expect(root).toContain('--button-border-rest: 0%;');
        expect(root).toContain('--button-border-hover: 0%;');
        expect(root).toContain('--button-base-strength: 100%;');
    });

    it('drives .theme-button radius/accent shape from the live theme tokens, without touching color', () => {
        const rule = indexCss.match(/\.theme-button\s*{([\s\S]*?)\n {2}}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('border-radius: var(--button-radius);');
        expect(body).not.toMatch(/(?<!-)\bbackground:/);
        expect(body).not.toMatch(/(?<!-)\bborder(-color)?:/);
        expect(body).toContain('overflow: hidden;');
        expect(body).toContain('overflow: clip;');
        expect(body).toMatch(/transition:[\s\S]*--button-radius[\s\S]*;/);
    });

    it('swaps the button shape tokens to their hover value on :hover, guarded against :disabled', () => {
        const rule = indexCss.match(/\.theme-button:hover:not\(:disabled\)\s*{([\s\S]*?)\n {2}}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('--button-radius: var(--button-radius-hover);');
        expect(body).toContain('--button-accent-opacity: var(--button-accent-opacity-hover);');
    });

    it('paints the button corner accent from an ::after masked to the four corners, reusing the frame technique', () => {
        const rule = indexCss.match(/\.theme-button::after\s*{\s*\n\s*content: '';([\s\S]*?)\n {2}}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toContain('--button-accent-tint: color-mix(in srgb, var(--button-accent-color) var(--button-accent-opacity), transparent);');
        expect(body).toContain('background-position: top left, top left, top right, top right, bottom left, bottom left, bottom right, bottom right;');
    });

    it('reproduces admin-accent-ghost\'s current 20%/30% rest and 35%/45% hover exactly through --button-base-strength', () => {
        const restRule = indexCss.match(/\.admin-accent-ghost\s*{\s*\n\s*--button-fill:([\s\S]*?)\n {2}}/);
        expect(restRule).not.toBeNull();
        const restBody = restRule?.[1] ?? '';
        expect(restBody).toContain('color-mix(in srgb, var(--color-admin-accent) 20%, transparent) var(--button-base-strength)');
        expect(restBody).toContain('color-mix(in srgb, var(--color-admin-accent) 30%, transparent) var(--button-base-strength)');

        const hoverRule = indexCss.match(/\.admin-accent-ghost:hover\s*{\s*\n\s*--button-fill:([\s\S]*?)\n {2}}/);
        expect(hoverRule).not.toBeNull();
        const hoverBody = hoverRule?.[1] ?? '';
        expect(hoverBody).toContain('color-mix(in srgb, var(--color-admin-accent) 35%, transparent) var(--button-base-strength)');
        expect(hoverBody).toContain('color-mix(in srgb, var(--color-admin-accent) 45%, transparent) var(--button-base-strength)');
    });

    it('reproduces the neutral secondary\'s current white/5-white/10 rest and white/10-white/20 hover exactly', () => {
        const restRule = indexCss.match(/\.theme-button-neutral\s*{([\s\S]*?)\n {2}}/);
        expect(restRule).not.toBeNull();
        const restBody = restRule?.[1] ?? '';
        expect(restBody).toContain('rgba(255, 255, 255, 0.05) var(--button-base-strength)');
        expect(restBody).toContain('rgba(255, 255, 255, 0.1) var(--button-base-strength)');

        const hoverRule = indexCss.match(/\.theme-button-neutral:hover:not\(:disabled\)\s*{([\s\S]*?)\n {2}}/);
        expect(hoverRule).not.toBeNull();
        const hoverBody = hoverRule?.[1] ?? '';
        expect(hoverBody).toContain('rgba(255, 255, 255, 0.1) var(--button-base-strength)');
        expect(hoverBody).toContain('rgba(255, 255, 255, 0.2) var(--button-base-strength)');
    });

    it('reproduces the critical/danger variant\'s current 10%/40% rest and 20%/60% hover exactly, mixed toward status-critical', () => {
        const restRule = indexCss.match(/\.theme-button-critical\s*{([\s\S]*?)\n {2}}/);
        expect(restRule).not.toBeNull();
        const restBody = restRule?.[1] ?? '';
        expect(restBody).toContain('color-mix(in srgb, var(--color-status-critical) var(--button-fill)');
        expect(restBody).toContain('color-mix(in srgb, var(--color-status-critical) 10%, transparent) var(--button-base-strength)');
        expect(restBody).toContain('color-mix(in srgb, var(--color-status-critical) 40%, transparent) var(--button-base-strength)');

        const hoverRule = indexCss.match(/\.theme-button-critical:hover:not\(:disabled\)\s*{([\s\S]*?)\n {2}}/);
        expect(hoverRule).not.toBeNull();
        const hoverBody = hoverRule?.[1] ?? '';
        expect(hoverBody).toContain('color-mix(in srgb, var(--color-status-critical) 20%, transparent) var(--button-base-strength)');
        expect(hoverBody).toContain('color-mix(in srgb, var(--color-status-critical) 60%, transparent) var(--button-base-strength)');
    });

    it('merges shape and color transitions onto .theme-button so no combined variant class can drop the other in the cascade', () => {
        const rule = indexCss.match(/\.theme-button\s*{([\s\S]*?)\n {2}}/);
        expect(rule).not.toBeNull();
        const body = rule?.[1] ?? '';

        expect(body).toMatch(/transition:[\s\S]*--button-radius[\s\S]*--button-fill[\s\S]*--button-border[\s\S]*--button-accent-length[\s\S]*--button-accent-thickness[\s\S]*--button-accent-color[\s\S]*--button-accent-opacity[\s\S]*background[\s\S]*border-color[\s\S]*color[\s\S]*;/);

        // A variant class combined with `.theme-button` on the same element must
        // not declare its own `transition`: same specificity + later source
        // order means it would win the cascade wholesale and silently drop
        // `.theme-button`'s shape/accent transitions (see TH4a advisory
        // R3-button-transition-cascade-collision).
        for (const variantSelector of [
            '.theme-button-neutral',
            '.theme-button-icon-neutral',
            '.theme-button-hmi-secondary',
            '.theme-button-critical',
            '.theme-button-segment-active',
            '.theme-button-bare',
        ]) {
            const escaped = variantSelector.replace(/[.]/g, '\\.');
            const variantRule = indexCss.match(new RegExp(`${escaped}\\s*{([\\s\\S]*?)\\n {2}}`));
            expect(variantRule, `${variantSelector} rest rule not found`).not.toBeNull();
            expect(
                variantRule?.[1] ?? '',
                `${variantSelector} must not declare its own transition`,
            ).not.toMatch(/(?<!-)\btransition:/);
        }
    });

    it('keeps the icon-toolbar variant borderless today and the segmented inactive variant boxless today (fully transparent own base)', () => {
        const iconRule = indexCss.match(/\.theme-button-icon-neutral\s*{([\s\S]*?)\n {2}}/);
        expect(iconRule).not.toBeNull();
        expect(iconRule?.[1] ?? '').toContain('border: 1px solid color-mix(in srgb, #fff var(--button-border), transparent);');

        const bareRule = indexCss.match(/\.theme-button-bare\s*{([\s\S]*?)\n {2}}/);
        expect(bareRule).not.toBeNull();
        const bareBody = bareRule?.[1] ?? '';
        expect(bareBody).toContain('background: color-mix(in srgb, #fff var(--button-fill), transparent);');
        expect(bareBody).toContain('border: 1px solid color-mix(in srgb, #fff var(--button-border), transparent);');
    });
});
