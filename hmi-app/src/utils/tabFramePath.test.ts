import { describe, expect, it } from 'vitest';
import { buildTabFrameGlowClipPath, buildTabFramePath, parseCssLengthPx, type TabFramePathGeometry } from './tabFramePath';

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
    it('rounds EVERY corner of the unified tab + body silhouette with the frame radius (concave junction included)', () => {
        expect(buildTabFramePath(GEOMETRY)).toBe(
            'M 4 0 L 93.343 0 A 4 4 0 0 1 96.172 1.172 L 118.828 23.828 A 4 4 0 0 0 121.657 25 '
            + 'L 248.343 25 A 4 4 0 0 1 251.172 26.172 L 298.828 73.828 A 4 4 0 0 1 300 76.657 '
            + 'L 300 196 A 4 4 0 0 1 296 200 L 4 200 A 4 4 0 0 1 0 196 L 0 4 A 4 4 0 0 1 4 0 Z',
        );
    });

    it('uses one arc per vertex: the junction where the tab diagonal meets the body top curves the other way', () => {
        const arcs = buildTabFramePath(GEOMETRY).match(/A [\d.]+ [\d.]+ 0 0 [01]/g) ?? [];

        expect(arcs).toHaveLength(7);
        expect(arcs.filter((arc) => arc.endsWith(' 0 0 0'))).toHaveLength(1);
        expect(arcs.filter((arc) => arc.endsWith(' 0 0 1'))).toHaveLength(6);
    });

    it('draws straight corners everywhere when the radius is zero', () => {
        expect(buildTabFramePath({ ...GEOMETRY, radius: 0 })).toBe(
            'M 0 0 L 95 0 L 120 25 L 250 25 L 300 75 L 300 200 L 0 200 Z',
        );
    });

    it('insets every edge toward the inside: convex corners shrink, the concave junction grows', () => {
        const path = buildTabFramePath(GEOMETRY, 1);
        const arcs = path.match(/A [\d.]+ [\d.]+ 0 0 [01]/g) ?? [];

        expect(arcs.filter((arc) => arc === 'A 3 3 0 0 1')).toHaveLength(6);
        expect(arcs.filter((arc) => arc === 'A 5 5 0 0 0')).toHaveLength(1);
    });

    it('outsets with a negative inset (glow spread): convex corners grow, the concave junction shrinks', () => {
        const path = buildTabFramePath(GEOMETRY, -2);
        const arcs = path.match(/A [\d.]+ [\d.]+ 0 0 [01]/g) ?? [];

        expect(arcs.filter((arc) => arc === 'A 6 6 0 0 1')).toHaveLength(6);
        expect(arcs.filter((arc) => arc === 'A 2 2 0 0 0')).toHaveLength(1);
        expect(path).toContain('L 302 ');
    });

    it('clamps a tab wider than the body top edge so the diagonals never cross (no junction left to round)', () => {
        const path = buildTabFramePath({ ...GEOMETRY, tabWidth: 400 });
        const arcs = path.match(/A [\d.]+ [\d.]+ 0 0 [01]/g) ?? [];

        expect(path).not.toContain('NaN');
        expect(arcs).toHaveLength(5);
        expect(arcs.every((arc) => arc.endsWith(' 0 0 1'))).toBe(true);
    });

    it('keeps a tab narrower than its own cut from turning inside out', () => {
        const path = buildTabFramePath({ ...GEOMETRY, tabWidth: 10 });

        expect(path).not.toContain('NaN');
        expect(path.endsWith('Z')).toBe(true);
    });

    it('never rounds past the middle of a short edge', () => {
        const path = buildTabFramePath({ ...GEOMETRY, tabWidth: 30, radius: 24 });
        const radii = [...path.matchAll(/A ([\d.]+) /g)].map((match) => Number(match[1]));

        expect(path).not.toContain('NaN');
        expect(radii.length).toBeGreaterThan(0);
        expect(Math.max(...radii)).toBeLessThanOrEqual(24);
    });
});

describe('buildTabFramePath without a body chamfer (bodyCut 0)', () => {
    const NO_CUT: TabFramePathGeometry = { ...GEOMETRY, bodyCut: 0 };

    it('merges the two coincident vertices: one straight body top edge, no zero-length segment', () => {
        expect(buildTabFramePath({ ...NO_CUT, radius: 0 })).toBe(
            'M 0 0 L 95 0 L 120 25 L 300 25 L 300 200 L 0 200 Z',
        );
    });

    it('rounds the remaining six vertices (one concave junction) and never emits NaN', () => {
        const path = buildTabFramePath(NO_CUT);
        const arcs = path.match(/A [\d.]+ [\d.]+ 0 0 [01]/g) ?? [];

        expect(path).not.toContain('NaN');
        expect(arcs).toHaveLength(6);
        expect(arcs.filter((arc) => arc.endsWith(' 0 0 0'))).toHaveLength(1);
        expect(path).not.toMatch(/L (-?[\d.]+) (-?[\d.]+) L \1 \2(?: |$)/);
    });

    it('stays valid when the inset or outset grows the outline', () => {
        for (const inset of [1, -2]) {
            const path = buildTabFramePath(NO_CUT, inset);

            expect(path).not.toContain('NaN');
            expect(path).not.toContain('Infinity');
        }
    });

    it('stays valid when the tab spans the whole width (tab base meets the right edge)', () => {
        const path = buildTabFramePath({ ...NO_CUT, tabWidth: 400 });
        const arcs = path.match(/A [\d.]+ [\d.]+ 0 0 [01]/g) ?? [];

        expect(path).not.toContain('NaN');
        expect(arcs).toHaveLength(5);
    });

    it('builds the glow clip from the same path', () => {
        expect(buildTabFrameGlowClipPath(NO_CUT, 60)).toBe(`M -60 -60 H 360 V 260 H -60 Z ${buildTabFramePath(NO_CUT)}`);
    });
});

describe('buildTabFrameGlowClipPath', () => {
    it('is an even-odd path: a margin rectangle around the frame with the silhouette punched out', () => {
        expect(buildTabFrameGlowClipPath(GEOMETRY, 60)).toBe(
            `M -60 -60 H 360 V 260 H -60 Z ${buildTabFramePath(GEOMETRY)}`,
        );
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
