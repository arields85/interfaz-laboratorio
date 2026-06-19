import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package test command guard', () => {
    it('disables test.only in the normal test script', () => {
        const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
            scripts?: Record<string, string>;
        };

        expect(packageJson.scripts?.test).toContain('--allowOnly=false');
    });
});
