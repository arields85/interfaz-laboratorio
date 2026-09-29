import { describe, expect, it } from 'vitest';
import { buildTabFramePath, parseCssLengthPx, type TabFramePathGeometry } from './tabFramePath';

const GEOMETRY: TabFramePathGeometry = {
    width: 300,
    height: 200,
    tabWidth: 120,
    tabHeight: 25,
    tabCut: 25,
    bodyCut: 50,
    radius: 4,
};

describe('buildTabFramePath', () => {
    it('traces the tab, the chamfered body and the rounded bottom corners at inset 0', () => {
        expect(buildTabFramePath(GEOMETRY)).toBe(
            'M 0 0 L 95 0 L 120 25 L 250 25 L 300 75 L 300 196 A 4 4 0 0 1 296 200 L 4 200 A 4 4 0 0 1 0 196 Z',
        );
    });

    it('draws square bottom corners when the radius is zero', () => {
        expect(buildTabFramePath({ ...GEOMETRY, radius: 0 })).toBe(
            'M 0 0 L 95 0 L 120 25 L 250 25 L 300 75 L 300 200 L 0 200 Z',
        );
    });

    it('insets every edge toward the inside, keeping the 45deg diagonals parallel', () => {
        const d = 1;
        const path = buildTabFramePath(GEOMETRY, d);
        const sqrt2 = Math.SQRT2;

        // Top-left corner, top edge shifted down, left edge shifted right.
        expect(path.startsWith('M 1 1 ')).toBe(true);
        // Tab diagonal: x - y = tabWidth - tabCut - d * sqrt2 = 95 - sqrt2.
        const tabDiagonalTopX = 95 - sqrt2 + d;
        expect(path).toContain(`L ${Number(tabDiagonalTopX.toFixed(3))} 1 `);
        // Body top edge sits d below the tab base.
        expect(path).toContain(' 26 ');
        // Radius shrinks by the inset.
        expect(path).toContain('A 3 3 0 0 1');
    });

    it('clamps a tab wider than the body top edge so the diagonals never cross', () => {
        const path = buildTabFramePath({ ...GEOMETRY, tabWidth: 400 });

        // Tab base ends at width - bodyCut (250): the tab meets the body chamfer start.
        expect(path).toContain('L 250 25 L 250 25 L 300 75');
    });

    it('keeps a tab narrower than its own cut from turning inside out', () => {
        const path = buildTabFramePath({ ...GEOMETRY, tabWidth: 10 });

        expect(path.startsWith('M 0 0 L 0 0 L 10 25')).toBe(true);
    });
});

describe('parseCssLengthPx', () => {
    it('reads px and rem lengths', () => {
        expect(parseCssLengthPx('25px', 16)).toBe(25);
        expect(parseCssLengthPx(' 1.5rem ', 16)).toBe(24);
        expect(parseCssLengthPx('0.25rem', 20)).toBe(5);
    });

    it('treats unitless zero as zero', () => {
        expect(parseCssLengthPx('0', 16)).toBe(0);
    });

    it('returns 0 for anything it cannot resolve (calc, var, empty)', () => {
        expect(parseCssLengthPx('calc(var(--x) + 1px)', 16)).toBe(0);
        expect(parseCssLengthPx('', 16)).toBe(0);
        expect(parseCssLengthPx('auto', 16)).toBe(0);
    });
});
