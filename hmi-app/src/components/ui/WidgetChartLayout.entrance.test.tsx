import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WidgetChartLayout from './WidgetChartLayout';
import { resolveWidgetChartLayoutMetrics } from './WidgetChartLayout.shared';

// jsdom cannot run CSS animations: this suite asserts the hook (class) the viewer entrance uses
// to draw the shared chart layout in, and the source contract of the entrance CSS in index.css.
// trend-chart, trend-chart-v2, prod-history and prod-trend all render through WidgetChartLayout,
// so one hook here covers the four of them.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, '../../index.css'), 'utf-8');

const layout = resolveWidgetChartLayoutMetrics({
    width: 320,
    height: 180,
    hasTopAdornments: true,
    firstXAxisLabel: '12:00',
    lastXAxisLabel: '14:00',
    yAxisTickLabels: ['53', '51', '49', '47', '45'],
    idPrefix: 'chart-entrance-test',
    font: '400 12px monospace',
    letterSpacing: 0,
});

describe('WidgetChartLayout entrance hook', () => {
    it('tags the main and overlay svgs for the left-to-right draw-in', () => {
        render(
            <WidgetChartLayout
                layout={layout}
                svgTestId="chart-main"
                overlaySvgTestId="chart-overlay"
                renderMain={() => <g />}
                renderOverlay={() => <circle cx="1" cy="1" r="1" />}
            />,
        );

        expect(screen.getByTestId('chart-main')).toHaveClass('hmi-viewer-chart-reveal');
        expect(screen.getByTestId('chart-overlay')).toHaveClass(
            'hmi-viewer-chart-reveal',
            'pointer-events-none',
            'absolute',
            'left-0',
        );
    });

    it('keeps a caller className on the main svg next to the entrance hook', () => {
        render(
            <WidgetChartLayout
                layout={layout}
                svgTestId="chart-main"
                svgProps={{ className: 'custom-chart' }}
                renderMain={() => <g />}
            />,
        );

        expect(screen.getByTestId('chart-main')).toHaveClass('hmi-viewer-chart-reveal', 'custom-chart');
    });
});

describe('chart entrance CSS contract (index.css)', () => {
    it('reveals the chart left to right under the viewer scope with the value tokens', () => {
        const keyframes = indexCss.match(/@keyframes hmi-viewer-chart-reveal\s*{([\s\S]*?)\r?\n}/);
        const rule = indexCss.match(/\[data-viewer-entrance='true'\] \.hmi-viewer-chart-reveal\s*{([\s\S]*?)}/);

        // Both ends are explicit insets: `clip-path: none` is not interpolable with a basic shape.
        expect(keyframes?.[1]).toMatch(/from\s*{\s*clip-path:\s*inset\(-100% 100% -100% 0\);\s*}/);
        expect(keyframes?.[1]).toMatch(/to\s*{\s*clip-path:\s*inset\(-100% -100% -100% 0\);\s*}/);
        expect(rule?.[1]).toContain('animation-name: hmi-viewer-chart-reveal;');
        expect(rule?.[1]).toContain('animation-duration: var(--viewer-entrance-value-duration);');
        expect(rule?.[1]).toContain('animation-timing-function: var(--viewer-entrance-ease);');
        expect(rule?.[1]).toContain(
            'animation-delay: calc(var(--viewer-entrance-item-delay, 0ms) + var(--viewer-entrance-value-offset));',
        );
        expect(rule?.[1]).toContain('animation-fill-mode: backwards;');
    });

    it('turns the chart entrance off for reduced motion', () => {
        const reduced = [...indexCss.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\r?\n}\r?\n/g)]
            .map((match) => match[1])
            .join('\n');

        expect(reduced).toMatch(/\.hmi-viewer-chart-reveal[\s\S]*?animation: none;/);
    });
});
