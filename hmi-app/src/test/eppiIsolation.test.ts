import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(currentDirectory, '..');
const eppiRoot = path.join(sourceRoot, 'components', 'viewer', 'eppi');

function collectProductionFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectProductionFiles(entryPath);
        }
        return entry.isFile() && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')
            ? [entryPath]
            : [];
    });
}

const visualProductionFiles = [
    ...collectProductionFiles(eppiRoot),
    path.join(sourceRoot, 'components', 'ui', 'DataTable.tsx'),
    path.join(sourceRoot, 'components', 'ui', 'dataTableModel.ts'),
    path.join(sourceRoot, 'domain', 'eppi.types.ts'),
    path.join(sourceRoot, 'mocks', 'eppi.mock.ts'),
];
const productionFiles = [
    ...visualProductionFiles,
    ...collectProductionFiles(path.join(sourceRoot, 'mocks', 'eppi')),
];

function matchingFiles(pattern: RegExp, files = productionFiles): string[] {
    return files.filter((filePath) => pattern.test(fs.readFileSync(filePath, 'utf8')));
}

describe('EPPI self-containment and read-only isolation', () => {
    it('contains no external repository, audit, or parent JSON dependency', () => {
        expect(matchingFiles(/D:[\\/]Proyectos[\\/]eppi|(?:from\s+|import\s*\()\s*['"][^'"]*(?:ui-audit-structural|\.\.[\\/].*\.json)/i)).toEqual([]);
    });

    it('contains no hardcoded color or literal font-family values', () => {
        expect(matchingFiles(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|fontFamily:\s*['"](?!var\()/i, visualProductionFiles)).toEqual([]);
    });

    it('contains no external network or process write integration', () => {
        expect(matchingFiles(/\bfetch\s*\(|axios|XMLHttpRequest|WebSocket|EventSource|sendBeacon|method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i)).toEqual([]);
    });
});
