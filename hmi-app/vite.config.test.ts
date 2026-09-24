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

    it('binds strictly to its configured port instead of silently drifting to another one (T18b)', async () => {
        // Evidence 2026-09-24: after a relaunch, Vite printed "Port 5173 is in use, trying
        // another one..." and started on 5174 instead, while the user's browser stayed on
        // 5173 and got ERR_CONNECTION_REFUSED. strictPort makes Vite fail loudly on a busy
        // port rather than silently choosing a different one.
        const resolved = typeof configExport === 'function'
            ? await configExport({ mode: 'development', command: 'serve' } as Parameters<typeof configExport>[0])
            : configExport;

        expect(resolved.server).toMatchObject({ strictPort: true });
    });
});
