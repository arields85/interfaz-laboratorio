// @vitest-environment node

import { describe, expect, it } from 'vitest';
import configExport from './vite.config';

describe('vite.config', () => {
    it('disables clearScreen so the launcher terminal keeps its pre-Vite messages (T4c)', async () => {
        // Vite clears the terminal on dev server start by default, which would otherwise
        // erase start-local.ps1's own "Prisma could not start: port ... is in use by ..."
        // warning that dev.mjs prints before ever spawning Vite.
        const resolved = typeof configExport === 'function'
            ? await configExport({ mode: 'development', command: 'serve' } as Parameters<typeof configExport>[0])
            : configExport;

        expect(resolved).toMatchObject({ clearScreen: false });
    });
});
