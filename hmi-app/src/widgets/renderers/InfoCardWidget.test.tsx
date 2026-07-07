import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InfoCardWidgetConfig } from '../../domain/admin.types';
import { DEFAULT_INFO_CARD_VALUE_FONT_SIZE } from '../../utils/infoCardDisplayOptions';
import InfoCardWidget from './InfoCardWidget';

type RegionName = 'info-card-card' | 'info-card-header' | 'info-card-content-scroller' | 'info-card-content-stack';

type MeasurementProfile = {
    clientHeight?: number;
    scrollHeight?: number;
};

function parseTranslateYOffset(transform: string): number {
    const match = /translateY\(-([\d.]+)px\)/.exec(transform);

    return match ? Number(match[1]) : 0;
}

class MockResizeObserver implements ResizeObserver {
    static instances: MockResizeObserver[] = [];

    readonly observedElements = new Set<Element>();

    constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    observe = (target: Element) => {
        this.observedElements.add(target);
    };

    unobserve = (target: Element) => {
        this.observedElements.delete(target);
    };

    disconnect = () => {
        this.observedElements.clear();
    };

    trigger() {
        this.callback([], this);
    }

    static triggerAll() {
        for (const instance of MockResizeObserver.instances) {
            instance.trigger();
        }
    }

    static reset() {
        MockResizeObserver.instances = [];
    }
}

const originalResizeObserver = globalThis.ResizeObserver;
const measurementProfiles = new Map<RegionName, MeasurementProfile>();

function setMeasurementProfile(region: RegionName, profile: MeasurementProfile) {
    measurementProfiles.set(region, profile);
}

function getRegionName(element: Element): RegionName | null {
    const testId = element.getAttribute('data-testid');

    if (testId === 'info-card-content-scroller' || testId === 'info-card-content-stack') {
        return testId;
    }

    if (testId === 'info-card-header') {
        return 'info-card-header';
    }

    if (element.tagName === 'ARTICLE' && element.classList.contains('glass-panel')) {
        return 'info-card-card';
    }

    return null;
}

beforeEach(() => {
    measurementProfiles.clear();
    MockResizeObserver.reset();
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    setMeasurementProfile('info-card-card', { clientHeight: 320 });
    setMeasurementProfile('info-card-header', { clientHeight: 40 });
    setMeasurementProfile('info-card-content-scroller', { clientHeight: 180 });
    setMeasurementProfile('info-card-content-stack', { scrollHeight: 90 });

    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeightMock(this: HTMLElement) {
        const region = getRegionName(this);
        return region ? measurementProfiles.get(region)?.clientHeight ?? 0 : 0;
    });

    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function scrollHeightMock(this: HTMLElement) {
        const region = getRegionName(this);
        return region ? measurementProfiles.get(region)?.scrollHeight ?? 0 : 0;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
});

function makeWidget(overrides?: Partial<InfoCardWidgetConfig>): InfoCardWidgetConfig {
    return {
        id: 'info-card-1',
        type: 'info-card',
        title: 'Line Overview',
        position: { x: 0, y: 0 },
        size: { w: 6, h: 5 },
        displayOptions: {
            subtitle: 'Shift summary',
            helpText: 'Static information only',
            fields: [
                { id: 'batch', label: 'Batch', value: 'B-204' },
                { id: 'operator', label: 'Operator', value: 'Lab Team' },
            ],
        },
        ...overrides,
    };
}

describe('InfoCardWidget', () => {
    it('renders configured title, right-side canonical header icon, subtitle, grouped text/subtext rows, and migrates legacy help text into the first field label', () => {
        render(<InfoCardWidget widget={makeWidget()} />);

        expect(screen.getByText('Line Overview')).toBeInTheDocument();
        expect(screen.getByTestId('info-card-header-icon')).toBeInTheDocument();
        expect(screen.getByText('Shift summary')).toBeInTheDocument();
        expect(screen.getByText('Static information only')).toBeInTheDocument();
        expect(screen.getByText('Batch')).toBeInTheDocument();
        expect(screen.getByText('B-204')).toBeInTheDocument();
        expect(screen.getByText('Operator')).toBeInTheDocument();
        expect(screen.getByText('Lab Team')).toBeInTheDocument();
    });

    it('renders field-level labels after the subtext for each group', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [
                            { id: 'batch', label: 'Batch', value: 'B-204', helpText: 'Reviewed by QA' },
                            { id: 'operator', label: 'Operator', value: 'Ada', helpText: 'Current owner' },
                        ],
                    },
                })}
            />,
        );

        const batchValue = screen.getByText('B-204');
        const batchSubtext = screen.getByText('Batch');
        const batchLabel = screen.getByText('Reviewed by QA');

        expect(batchValue.compareDocumentPosition(batchSubtext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(batchSubtext.compareDocumentPosition(batchLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Current owner')).toBeInTheDocument();
    });

    it('keeps missing values display-only with a safe fallback', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [
                            { id: 'recipe', label: 'Recipe' },
                            { id: 'state', label: 'State', value: '' },
                        ],
                    },
                })}
            />,
        );

        expect(screen.getByText('Recipe')).toBeInTheDocument();
        expect(screen.getByText('State')).toBeInTheDocument();
        expect(screen.getAllByText('—')).toHaveLength(2);
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('uses dashboard-title typography variables for values with a configurable font size', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18' }],
                        valueFontSize: 48,
                    },
                })}
            />,
        );

        expect(screen.getByText('L-18')).toHaveStyle({
            fontFamily: 'var(--font-dashboard-title)',
            fontSize: '48px',
        });
    });

    it('applies configured text alignment only to the grouped content and keeps centered fallback compatibility', () => {
        const { rerender } = render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18', helpText: 'Read only' }],
                    },
                })}
            />,
        );

        expect(screen.getByText('L-18')).toHaveStyle({ textAlign: 'center' });
        expect(screen.getByText('Lot')).toHaveStyle({ textAlign: 'center' });

        rerender(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        textAlign: 'right',
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18', helpText: 'Read only' }],
                    },
                })}
            />,
        );

        expect(screen.getByText('L-18')).toHaveStyle({ textAlign: 'right' });
        expect(screen.getByText('Lot')).toHaveStyle({ textAlign: 'right' });
        expect(screen.getByText('Read only')).toHaveStyle({ textAlign: 'right' });
    });

    it('keeps text and subtext visually tighter without collapsing the optional tag spacing', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18', helpText: 'Read only' }],
                    },
                })}
            />,
        );

        expect(screen.getByText('Read only')).toHaveClass('pt-1');
        expect(screen.getByText('L-18').closest('section')).toHaveClass('gap-0.5');
    });

    it('keeps the normal centered layout with no optical offset when the body is comfortably spacious', async () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18', helpText: 'Read only' }],
                    },
                })}
            />,
        );

        expect(screen.getByText('Line Overview').closest('article')).toHaveClass('gap-0');

        const scroller = screen.getByTestId('info-card-content-scroller');
        const stack = screen.getByTestId('info-card-content-stack');

        await waitFor(() => expect(scroller).toHaveClass('justify-center'));

        expect(scroller).toHaveClass('overflow-y-auto');
        expect(scroller).not.toHaveClass('justify-start');
        expect(stack).toHaveClass('gap-3');
        expect(stack).not.toHaveClass('min-h-full');
        expect(stack).not.toHaveClass('justify-center');
        expect(stack.style.transform).toBe('');
    });

    it('switches to compact top alignment only when the content truly overflows the available post-header body area', async () => {
        setMeasurementProfile('info-card-content-scroller', { clientHeight: 80 });
        setMeasurementProfile('info-card-content-stack', { scrollHeight: 120 });

        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18', helpText: 'Read only' }],
                    },
                })}
            />,
        );

        const scroller = screen.getByTestId('info-card-content-scroller');
        const article = screen.getByText('Line Overview').closest('article');

        await waitFor(() => {
            expect(scroller).toHaveClass('justify-start');
            expect(scroller).not.toHaveClass('justify-center');
            expect(article).toHaveClass('gap-0');
        });
    });

    it('applies a stronger measured upward optical offset while still preserving a safety top gap', async () => {
        setMeasurementProfile('info-card-content-scroller', { clientHeight: 99 });
        setMeasurementProfile('info-card-content-stack', { scrollHeight: 74 });

        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18', helpText: 'Read only' }],
                    },
                })}
            />,
        );

        const scroller = screen.getByTestId('info-card-content-scroller');
        const stack = screen.getByTestId('info-card-content-stack');

        await waitFor(() => expect(scroller).toHaveClass('justify-center'));

        const offsetPx = parseTranslateYOffset(stack.style.transform);

        expect(scroller).not.toHaveClass('justify-start');
        expect(offsetPx).toBeGreaterThan(7);
        expect(offsetPx).toBeLessThan(8.5);
    });

    it('returns to centered mode after a resize gives the content enough room again', async () => {
        setMeasurementProfile('info-card-content-scroller', { clientHeight: 80 });
        setMeasurementProfile('info-card-content-stack', { scrollHeight: 120 });

        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: [{ id: 'lot', label: 'Lot', value: 'L-18', helpText: 'Read only' }],
                    },
                })}
            />,
        );

        const scroller = screen.getByTestId('info-card-content-scroller');
        const stack = screen.getByTestId('info-card-content-stack');

        await waitFor(() => {
            expect(scroller).toHaveClass('justify-start');
            expect(stack.style.transform).toBe('');
        });

        setMeasurementProfile('info-card-content-scroller', { clientHeight: 160 });
        act(() => {
            MockResizeObserver.triggerAll();
        });

        await waitFor(() => {
            expect(scroller).toHaveClass('justify-center');
            expect(scroller).not.toHaveClass('justify-start');
            expect(stack.style.transform).toBe('');
        });
    });

    it('falls back to the default info-card value size when no value size is configured', () => {
        render(<InfoCardWidget widget={makeWidget()} />);

        expect(screen.getByText('B-204')).toHaveStyle({
            fontSize: `${DEFAULT_INFO_CARD_VALUE_FONT_SIZE}px`,
        });
    });

    it('renders an empty static field state without runtime controls or actions', () => {
        render(<InfoCardWidget widget={makeWidget({ displayOptions: { fields: [] } })} />);

        expect(screen.getByText('No static fields configured')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('treats malformed persisted fields as empty instead of crashing during boot render', () => {
        render(
            <InfoCardWidget
                widget={makeWidget({
                    displayOptions: {
                        fields: 'legacy-bad-shape',
                    } as unknown as InfoCardWidgetConfig['displayOptions'],
                })}
            />,
        );

        expect(screen.getByText('No static fields configured')).toBeInTheDocument();
    });
});
