import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_CAPTURE_OUTPUT_DIRECTORY,
    getCaptureOutputFileName,
    importProdTrendCapture,
    isTrustedCaptureInputStats,
    validateCaptureInputPath,
} from './import-prod-trend-capture';
import { adaptProdTrendCapture, rehydrateProdTrendCapture } from '../src/adapters/prodTrendCapture.adapter';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'prod-trend-import-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('validateCaptureInputPath', () => {
    it('rejects symlink metadata and non-regular JSON paths', async () => {
        const directory = await createTemporaryDirectory();
        const source = join(directory, 'capture.json');
        const nonRegular = join(directory, 'capture-directory.json');
        await writeFile(source, '{}', 'utf8');
        await mkdir(nonRegular);

        expect(isTrustedCaptureInputStats({ isFile: () => true, isSymbolicLink: () => true }, source)).toBe(false);
        await expect(validateCaptureInputPath(nonRegular)).rejects.toThrow('regular, non-symlink JSON');
    });

    it.each(['requirements.txt', 'CMakeLists.txt'])('rejects build/dependency file %s', async (filename) => {
        const directory = await createTemporaryDirectory();
        const path = join(directory, filename);
        await writeFile(path, '{}', 'utf8');

        await expect(validateCaptureInputPath(path)).rejects.toThrow('regular, non-symlink JSON');
    });

    it.each(['notes.md', 'notes.mdx', 'README.sh'])('rejects executable documentation path %s', async (filename) => {
        const directory = await createTemporaryDirectory();
        const path = join(directory, filename);
        await writeFile(path, '{}', 'utf8');

        await expect(validateCaptureInputPath(path)).rejects.toThrow('regular, non-symlink JSON');
    });
});

describe('importProdTrendCapture', () => {
    it('imports a raw history response with explicit endpoint provenance and exact sequence preservation', async () => {
        const directory = await createTemporaryDirectory();
        const inputPath = join(directory, 'history.json');
        const input = {
            contractVersion: '1.1',
            machineId: 11,
            variableKey: 'Total kW',
            range: '24h',
            unit: 'kW',
            window: {
                start: '2026-08-05T10:00:00.000Z',
                end: '2026-08-06T10:00:00.000Z',
                bucket: '1m',
                bucketMs: 60000,
                timezone: 'America/Argentina/Buenos_Aires',
            },
            series: [
                { timestamp: '2026-08-05T10:00:30.000Z', value: 0 },
                { timestamp: '2026-08-05T10:01:40.000Z', value: 1.284 },
                { timestamp: '2026-08-06T10:00:00.000Z', value: -0.003 },
            ],
            summary: { last: 999, min: 999, max: 999, avg: 999 },
        };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');
        const writeFileMock = vi.fn(async () => undefined);

        const result = await importProdTrendCapture(inputPath, {
            fileSystem: {
                mkdir: vi.fn(async () => undefined),
                writeFile: writeFileMock,
            },
            now: () => new Date('2026-08-06T12:30:00.000Z'),
        });

        expect(result.outputPath).toBe(join(DEFAULT_CAPTURE_OUTPUT_DIRECTORY, 'capture-11-24h.json'));
        expect(result.capture.provenance).toEqual({
            purpose: 'history',
            endpoint: '/api/hmi-data/history',
            variableKey: 'Total kW',
            contractVersion: '1.1',
            capturedAt: '2026-08-06T12:30:00.000Z',
        });
        expect(result.capture.points).toEqual([
            { offsetMs: 30000, value: 0 },
            { offsetMs: 100000, value: 1.284 },
            { offsetMs: 86400000, value: -0.003 },
        ]);
        expect(writeFileMock).toHaveBeenCalledOnce();
    });

    it('imports a raw Activity-Series response and derives canonical metadata and identity', async () => {
        const directory = await createTemporaryDirectory();
        const inputPath = join(directory, 'capture.json');
        const identity = { machineId: 7, range: '24h' as const };
        const input = {
            purpose: 'activity-analytics',
            contractVersion: '1.0.0',
            machineId: identity.machineId,
            range: identity.range,
            window: {
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-19T10:00:00.000Z',
                bucket: '1h',
                bucketMs: 3600000,
            },
            variableKey: 'must-not-be-used',
            series: Array.from({ length: 24 }, (_, index) => ({
                timestamp: new Date(Date.parse('2026-06-18T10:00:00.000Z') + index * 3600000).toISOString(),
                value: index === 2 ? null : index,
            })),
        };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');

        const mkdirMock = vi.fn(async () => undefined);
        const writeFileMock = vi.fn(async () => undefined);
        const result = await importProdTrendCapture(inputPath, {
            fileSystem: {
                mkdir: mkdirMock,
                writeFile: writeFileMock,
            },
            now: () => new Date('2026-06-19T10:00:00.000Z'),
        });
        const output = result.capture as unknown as Record<string, unknown>;

        expect(result.outputPath).toBe(join(DEFAULT_CAPTURE_OUTPUT_DIRECTORY, 'capture-7-24h.json'));
        expect(mkdirMock).toHaveBeenCalledWith(DEFAULT_CAPTURE_OUTPUT_DIRECTORY, { recursive: true });
        expect(writeFileMock).toHaveBeenCalledWith(
            result.outputPath,
            expect.stringContaining('"value": null'),
            'utf8',
        );
        expect(output).toMatchObject({
            schemaVersion: '2',
            identity,
            provenance: {
                purpose: 'activity-analytics',
                contractVersion: '1.0.0',
                capturedAt: '2026-06-19T10:00:00.000Z',
            },
        });
        expect(output).not.toHaveProperty('variableKey');
        expect(output.points).toHaveLength(24);
        expect((output.points as Array<Record<string, unknown>>).slice(0, 3)).toEqual([
            { offsetMs: 0, value: 0 },
            { offsetMs: 3600000, value: 1 },
            { offsetMs: 7200000, value: null },
        ]);
    });

    it('round-trips the exact canonical bytes through packaged validation and rehydration', async () => {
        const directory = await createTemporaryDirectory();
        const inputPath = join(directory, 'capture.json');
        const identity = {
            machineId: 7,
            range: 'custom' as const,
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T10:02:00.000Z',
        };
        const input = {
            purpose: 'activity-analytics',
            contractVersion: '1.0.0',
            machineId: identity.machineId,
            range: identity.range,
            window: { ...identity, bucket: '1m', bucketMs: 60000 },
            variableKey: 'ignored-by-canonical-contract',
            summary: { fabricated: true },
            series: [
                { timestamp: '2026-06-18T10:01:00.000Z', value: null },
                { timestamp: '2026-06-18T10:00:00.000Z', value: 20 },
            ],
        };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');

        const writeFileMock = vi.fn(async () => undefined);
        await importProdTrendCapture(inputPath, {
            fileSystem: {
                mkdir: vi.fn(async () => undefined),
                writeFile: writeFileMock,
            },
            now: () => new Date('2026-06-19T10:00:00.000Z'),
        });

        const writtenBytes = writeFileMock.mock.calls[0]?.[1];
        expect(typeof writtenBytes).toBe('string');
        const writtenCapture = JSON.parse(writtenBytes as string) as Record<string, unknown>;
        const packaged = await adaptProdTrendCapture(writtenCapture, identity);
        const rehydrated = rehydrateProdTrendCapture(packaged, {
            window: {
                start: '2026-06-19T11:00:00.000Z',
                end: '2026-06-19T11:02:00.000Z',
                bucket: '1m',
                bucketMs: 60000,
            },
            thresholds: { setupKw: 5, prodKw: 15 },
            groupBy: 'shift',
            shifts: [],
            timezone: 'UTC',
        });

        expect(packaged.checksum).toBe(writtenCapture.checksum);
        expect(packaged.provenance).toEqual({
            purpose: 'activity-analytics',
            contractVersion: '1.0.0',
            capturedAt: '2026-06-19T10:00:00.000Z',
        });
        expect(packaged.identity).toEqual(identity);
        expect(packaged.points).toEqual([
            { offsetMs: 0, value: 20 },
            { offsetMs: 60000, value: null },
        ]);
        expect(rehydrated.response.series).toEqual([
            { timestamp: '2026-06-19T11:00:00.000Z', timestampMs: Date.parse('2026-06-19T11:00:00.000Z'), value: 20 },
            { timestamp: '2026-06-19T11:01:00.000Z', timestampMs: Date.parse('2026-06-19T11:01:00.000Z'), value: null },
        ]);
        expect(rehydrated.response.summary).toMatchObject({
            durationsMs: { prod: 60000, setup: 0, stopped: 0, noData: 90000 },
            stopCount: 0,
            estimatedKwh: 20 / 60,
            utilizationRatio: 1,
            coverageRatio: 0.4,
        });
    });

    it('derives a Windows-safe custom output name from the raw response identity', async () => {
        const directory = await createTemporaryDirectory();
        const inputPath = join(directory, 'capture.json');
        const identity = {
            machineId: 7,
            range: 'custom' as const,
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T10:02:00.000Z',
        };
        const input = {
            purpose: 'activity-analytics',
            contractVersion: '1.0.0',
            machineId: 7,
            range: 'custom',
            window: { ...identity, bucket: '1m', bucketMs: 60000 },
            series: [
                { timestamp: '2026-06-18T10:00:00.000Z', value: 1 },
                { timestamp: '2026-06-18T10:01:00.000Z', value: 2 },
            ],
        };
        await writeFile(inputPath, JSON.stringify(input), 'utf8');

        expect(getCaptureOutputFileName(identity)).toBe('capture-7-custom-20260618T100000000Z-20260618T100200000Z.json');
        const mkdirMock = vi.fn(async () => undefined);
        const writeFileMock = vi.fn(async () => undefined);
        await expect(importProdTrendCapture(inputPath, {
            fileSystem: { mkdir: mkdirMock, writeFile: writeFileMock },
            now: () => new Date('2026-06-19T10:00:00.000Z'),
        })).resolves.toMatchObject({
            outputPath: join(DEFAULT_CAPTURE_OUTPUT_DIRECTORY, 'capture-7-custom-20260618T100000000Z-20260618T100200000Z.json'),
        });
    });
});
