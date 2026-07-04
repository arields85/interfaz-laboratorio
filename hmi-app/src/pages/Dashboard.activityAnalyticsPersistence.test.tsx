import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { makeDashboard, makeLayout, makeWidget } from '../test/fixtures/dashboard.fixture';
import { dashboardStorage } from '../services/DashboardStorageService';
import { DASHBOARDS_STORAGE_KEY } from '../utils/legacyStorageCleanup';

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const resizeCallbacks = new Map<Element, Set<ResizeObserverCallback>>();

class MockResizeObserver implements ResizeObserver {
    public readonly boxOptions = '';
    private readonly observedElements = new Set<Element>();
    private readonly callback: ResizeObserverCallback;

    public constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }

    public observe(target: Element): void {
        this.observedElements.add(target);
        const callbacks = resizeCallbacks.get(target) ?? new Set<ResizeObserverCallback>();
        callbacks.add(this.callback);
        resizeCallbacks.set(target, callbacks);
    }

    public unobserve(target: Element): void {
        this.observedElements.delete(target);
        const callbacks = resizeCallbacks.get(target);
        callbacks?.delete(this.callback);
        if (callbacks?.size === 0) {
            resizeCallbacks.delete(target);
        }
    }

    public disconnect(): void {
        for (const element of this.observedElements) {
            this.unobserve(element);
        }
    }
}

function emitResize(target: Element, width: number, height: number) {
    const callbacks = resizeCallbacks.get(target);

    if (!callbacks || callbacks.size === 0) {
        throw new Error('No ResizeObserver registered for the target element.');
    }

    const entry = {
        target,
        contentRect: {
            width,
            height,
            top: 0,
            left: 0,
            bottom: height,
            right: width,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        },
    } as ResizeObserverEntry;

    for (const callback of callbacks) {
        callback([entry], {} as ResizeObserver);
    }
}

async function waitForResizeObserver(target: Element) {
    await waitFor(() => {
        expect(resizeCallbacks.get(target)?.size ?? 0).toBeGreaterThan(0);
    });
}

const { hierarchyStorageMock, useDataOverviewMock, useActivitySeriesMock, useTemporalSettingsMock, isDataActivitySeriesEnabledMock } = vi.hoisted(() => ({
    hierarchyStorageMock: {
        getNodes: vi.fn(),
    },
    useDataOverviewMock: vi.fn(),
    useActivitySeriesMock: vi.fn(),
    useTemporalSettingsMock: vi.fn(),
    isDataActivitySeriesEnabledMock: vi.fn(),
}));

vi.mock('../services/HierarchyStorageService', () => ({
    hierarchyStorage: hierarchyStorageMock,
}));

vi.mock('../components/viewer/DashboardHeader', () => ({
    default: () => <div data-testid="dashboard-header-title">Header</div>,
}));

vi.mock('../queries/useDataOverview', () => ({
    useDataOverview: useDataOverviewMock,
}));

vi.mock('../queries/useActivitySeries', () => ({
    useActivitySeries: useActivitySeriesMock,
}));

vi.mock('../hooks/useTemporalSettings', () => ({
    useTemporalSettings: useTemporalSettingsMock,
}));

vi.mock('../config/dataConnection.config', () => ({
    isDataActivitySeriesEnabled: isDataActivitySeriesEnabledMock,
}));

vi.mock('../components/ui/ChartHoverLayer', () => ({
    default: () => <div data-testid="hover-layer" />,
}));

vi.mock('../components/ui/ChartTooltip', () => ({
    default: ({ label }: { label: string }) => <div data-testid="chart-tooltip">{label}</div>,
}));

describe('Dashboard activity-analytics viewer persistence', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        localStorage.clear();
        hierarchyStorageMock.getNodes.mockResolvedValue([]);
        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'online', lastSuccess: '2026-06-24T10:00:00.000Z', ageMs: 0 },
            machines: [{
                unitId: 101,
                name: 'Extrusora 101',
                status: 'online',
                lastSuccess: '2026-06-24T10:00:00.000Z',
                ageMs: 0,
                values: {},
            }],
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 0,
            isEnabled: true,
        });
        useTemporalSettingsMock.mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        isDataActivitySeriesEnabledMock.mockReturnValue(true);
        useActivitySeriesMock.mockImplementation(({ range, start, end }: { range: string; start?: string; end?: string }) => ({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range,
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: start ?? '2026-06-24T08:00:00.000Z',
                    end: end ?? '2026-06-24T10:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [
                    {
                        timestamp: '2026-06-24T08:00:00.000Z',
                        timestampMs: Date.parse('2026-06-24T08:00:00.000Z'),
                        value: 0.3,
                    },
                    {
                        timestamp: '2026-06-24T09:00:00.000Z',
                        timestampMs: Date.parse('2026-06-24T09:00:00.000Z'),
                        value: 0.2,
                    },
                ],
                summary: { hidden: true },
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            font: '',
            measureText: (text: string) => ({ width: text.length * 8 }),
        } as unknown as CanvasRenderingContext2D);
    });

    afterEach(() => {
        resizeCallbacks.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('persists a clicked viewer range through dashboard storage and restores it on reload', async () => {
        const persistedDashboard = makeDashboard({
            id: 'dashboard-activity-analytics',
            name: 'Published activity analytics',
            status: 'published',
            ownerNodeId: 'node-1',
            widgets: [makeWidget({
                id: 'activity-widget',
                type: 'activity-analytics',
                title: 'Activity analytics',
                binding: {
                    mode: 'real_variable',
                    bindingVersion: 'node-red-v1',
                    machineId: 101,
                },
                displayOptions: {
                    range: '24h',
                    groupBy: 'day',
                    setupThresholdKw: 0.15,
                    prodThresholdKw: 0.25,
                    displayMode: 'kpis-and-bars',
                },
            } as never)],
            layout: [makeLayout({ widgetId: 'activity-widget', x: 0, y: 0, w: 11, h: 9 })],
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                widgets: [makeWidget({
                    id: 'activity-widget',
                    type: 'activity-analytics',
                    title: 'Activity analytics',
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 101,
                    },
                    displayOptions: {
                        range: '24h',
                        groupBy: 'day',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                } as never)],
                layout: [makeLayout({ widgetId: 'activity-widget', x: 0, y: 0, w: 11, h: 9 })],
                publishedAt: '2026-06-24T10:00:00.000Z',
            },
        });

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([persistedDashboard]));

        const persistSpy = vi.spyOn(dashboardStorage, 'persistPublishedWidgetDisplayOptions');
        const user = userEvent.setup();

        const renderDashboard = () => render(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route
                        path="/"
                        element={(
                            <div style={{ width: '1280px', height: '800px' }}>
                                <Dashboard />
                            </div>
                        )}
                    />
                </Routes>
            </MemoryRouter>,
        );

        const measureViewer = async (expectedActiveRange: '7d' | '30d') => {
            await waitFor(() => {
                expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
            });

            const viewerRoot = screen.getByTestId('dashboard-viewer-root');
            await waitForResizeObserver(viewerRoot);

            act(() => {
                emitResize(viewerRoot, 1280, 800);
            });

            await waitFor(() => {
                expect(screen.getByRole('button', { name: expectedActiveRange })).toHaveAttribute('aria-pressed', 'true');
            });
        };

        const initialRender = renderDashboard();
        await measureViewer('7d');

        expect(screen.queryByRole('button', { name: '24h' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '30d' }));

        await waitFor(() => {
            expect(persistSpy).toHaveBeenCalledWith('dashboard-activity-analytics', 'activity-widget', {
                range: '30d',
                start: undefined,
                end: undefined,
            });
        });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
        });

        await waitFor(() => {
            const storedDashboards = JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]');
            expect(storedDashboards[0]?.publishedSnapshot?.widgets[0]?.displayOptions?.range).toBe('30d');
        });

        initialRender.unmount();

        renderDashboard();
        await measureViewer('30d');

        expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
    });
});
