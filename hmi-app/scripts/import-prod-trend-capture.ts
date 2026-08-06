import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import {
    adaptRawProdTrendCaptureResponse,
    createProdTrendCaptureChecksum,
    PROD_TREND_CAPTURE_SCHEMA_VERSION,
    type ProdTrendCapture,
} from '../src/adapters/prodTrendCapture.adapter';
import type { ProdTrendActivitySeriesIdentity } from '../src/domain/prodTrendDataMode.types';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CAPTURE_OUTPUT_DIRECTORY = resolve(SCRIPT_DIRECTORY, '../src/assets/prod-trend-captures');
export type CaptureOutputFileSystem = Pick<typeof import('node:fs/promises'), 'mkdir' | 'writeFile'>;
const DEFAULT_CAPTURE_FILE_SYSTEM: CaptureOutputFileSystem = { mkdir, writeFile };

export interface ProdTrendCaptureImportOptions {
    fileSystem?: CaptureOutputFileSystem;
    now?: () => Date;
}

export async function validateCaptureInputPath(inputPath: string): Promise<void> {
    let stats;
    try {
        stats = await lstat(inputPath);
    } catch {
        throw new Error('Capture input must be a regular, non-symlink JSON file');
    }

    if (!isTrustedCaptureInputStats(stats, inputPath)) {
        throw new Error('Capture input must be a regular, non-symlink JSON file');
    }
}

export function isTrustedCaptureInputStats(
    stats: Pick<Awaited<ReturnType<typeof lstat>>, 'isFile' | 'isSymbolicLink'>,
    inputPath: string,
): boolean {
    return stats.isFile() && !stats.isSymbolicLink() && extname(inputPath).toLowerCase() === '.json';
}

export function getCaptureOutputFileName(identity: ProdTrendActivitySeriesIdentity): string {
    const customWindow = identity.range === 'custom'
        ? `-${compactTimestamp(identity.start)}-${compactTimestamp(identity.end)}`
        : '';
    return `capture-${identity.machineId}-${identity.range}${customWindow}.json`;
}

export async function importProdTrendCapture(
    inputPath: string,
    options: ProdTrendCaptureImportOptions = {},
): Promise<{ capture: ProdTrendCapture; outputPath: string }> {
    await validateCaptureInputPath(inputPath);
    const raw = await readJson(inputPath);
    const adaptedCapture = adaptRawProdTrendCaptureResponse(raw, {
        schemaVersion: PROD_TREND_CAPTURE_SCHEMA_VERSION,
        capturedAt: (options.now?.() ?? new Date()).toISOString(),
    });
    const capture: ProdTrendCapture = {
        ...adaptedCapture,
        checksum: await createProdTrendCaptureChecksum(adaptedCapture),
    };
    const outputPath = join(DEFAULT_CAPTURE_OUTPUT_DIRECTORY, getCaptureOutputFileName(capture.identity));

    const fileSystem = options.fileSystem ?? DEFAULT_CAPTURE_FILE_SYSTEM;
    await fileSystem.mkdir(DEFAULT_CAPTURE_OUTPUT_DIRECTORY, { recursive: true });
    await fileSystem.writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
    return { capture, outputPath };
}

async function readJson(inputPath: string): Promise<unknown> {
    let text: string;
    try {
        text = await readFile(inputPath, 'utf8');
    } catch {
        throw new Error('Capture input could not be read');
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error('Capture input JSON is invalid');
    }
}

function compactTimestamp(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, '');
}

async function runFromCommandLine(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !args[0]) {
        throw new Error('Usage: npm run renew:prod-trend-capture -- <history-or-activity-series-response.json>');
    }

    const result = await importProdTrendCapture(args[0]);
    process.stdout.write(`Imported ${result.outputPath}\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    runFromCommandLine().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'Capture import failed'}\n`);
        process.exitCode = 1;
    });
}
