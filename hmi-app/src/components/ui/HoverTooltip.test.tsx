import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HoverTooltip from './HoverTooltip';

const createRect = ({
    x,
    y,
    width,
    height,
}: {
    x: number;
    y: number;
    width: number;
    height: number;
}) => ({
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('HoverTooltip', () => {
    it('renders the tooltip on hover with the shared fixed-position tokens', () => {
        render(
            <HoverTooltip label="Duplicar widget" position="bottom">
                <button type="button">Duplicar</button>
            </HoverTooltip>,
        );

        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

        const trigger = screen.getByRole('button', { name: 'Duplicar' });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 100, y: 200, width: 48, height: 24 }),
        );

        fireEvent.mouseEnter(trigger);

        const tooltip = screen.getByRole('tooltip');

        expect(tooltip).toBeInTheDocument();
        expect(tooltip).toHaveClass(
            'pointer-events-none',
            'fixed',
            'z-50',
            'rounded',
            'border',
            'border-white',
            'bg-industrial-surface/90',
            'px-2',
            'py-1',
            'text-white',
            'whitespace-nowrap',
        );
        expect(tooltip).toHaveStyle({ top: '230px', left: '124px' });
    });

    it.each([
        ['top', { top: '194px', left: '124px', transform: 'translate(-50%, -100%)' }],
        ['bottom', { top: '230px', left: '124px', transform: 'translate(-50%, 0)' }],
        ['left', { top: '212px', left: '94px', transform: 'translate(-100%, -50%)' }],
        ['right', { top: '212px', left: '154px', transform: 'translate(0, -50%)' }],
    ] as const)('positions the tooltip correctly for %s', (position, expectedStyles) => {
        render(
            <HoverTooltip label={`Tooltip ${position}`} position={position}>
                <button type="button">Trigger {position}</button>
            </HoverTooltip>,
        );

        const trigger = screen.getByRole('button', { name: `Trigger ${position}` });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 100, y: 200, width: 48, height: 24 }),
        );

        fireEvent.mouseEnter(trigger);

        expect(screen.getByRole('tooltip')).toHaveStyle(expectedStyles);
    });

    it('hides the tooltip when the pointer leaves the trigger', () => {
        render(
            <HoverTooltip label="Eliminar" position="right">
                <button type="button">Eliminar</button>
            </HoverTooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'Eliminar' });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 20, y: 30, width: 40, height: 20 }),
        );

        fireEvent.mouseEnter(trigger);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();

        fireEvent.mouseLeave(trigger);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('prefers an above-left diagonal placement for right-positioned row actions near the viewport edge when top space is available', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });

        vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 0, y: 0, width: 120, height: 32 }),
        );

        render(
            <HoverTooltip label="Exportar dashboard" position="right">
                <button type="button">Export</button>
            </HoverTooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'Export' });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 280, y: 100, width: 24, height: 24 }),
        );

        fireEvent.mouseEnter(trigger);

        await waitFor(() => {
            expect(screen.getByRole('tooltip')).toHaveStyle({
                top: '62px',
                left: '184px',
                transform: 'none',
            });
        });
    });

    it('prefers an above-right diagonal placement for right-positioned row actions when there is room', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });

        vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 0, y: 0, width: 120, height: 32 }),
        );

        render(
            <HoverTooltip label="Export dashboard" position="right">
                <button type="button">Export</button>
            </HoverTooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'Export' });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 320, y: 120, width: 24, height: 24 }),
        );

        fireEvent.mouseEnter(trigger);

        await waitFor(() => {
            expect(screen.getByRole('tooltip')).toHaveStyle({
                top: '82px',
                left: '350px',
                transform: 'none',
            });
        });
    });

    it('prefers an above-left diagonal placement for right-positioned row actions near the viewport edge', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });

        vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 0, y: 0, width: 120, height: 32 }),
        );

        render(
            <HoverTooltip label="Export dashboard" position="right">
                <button type="button">Export</button>
            </HoverTooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'Export' });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 280, y: 100, width: 24, height: 24 }),
        );

        fireEvent.mouseEnter(trigger);

        await waitFor(() => {
            expect(screen.getByRole('tooltip')).toHaveStyle({
                top: '62px',
                left: '184px',
                transform: 'none',
            });
        });
    });

    it('uses a bottom-left diagonal placement when top lacks room but bottom space is available', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });

        vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 0, y: 0, width: 120, height: 48 }),
        );

        render(
            <HoverTooltip label="Very long tooltip label" position="right">
                <button type="button">Edge trigger</button>
            </HoverTooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'Edge trigger' });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 280, y: 0, width: 24, height: 24 }),
        );

        fireEvent.mouseEnter(trigger);

        await waitFor(() => {
            expect(screen.getByRole('tooltip')).toHaveStyle({
                top: '30px',
                left: '184px',
                transform: 'none',
            });
        });
    });

    it('renders the tooltip through document.body so transformed parents do not shift viewport positioning', () => {
        render(
            <div data-testid="transformed-parent" style={{ transform: 'translate3d(0, 0, 0)' }}>
                <HoverTooltip label="Header view" position="bottom">
                    <button type="button">Header trigger</button>
                </HoverTooltip>
            </div>,
        );

        const trigger = screen.getByRole('button', { name: 'Header trigger' });
        vi.spyOn(trigger.parentElement as HTMLDivElement, 'getBoundingClientRect').mockReturnValue(
            createRect({ x: 240, y: 16, width: 36, height: 36 }),
        );

        fireEvent.mouseEnter(trigger);

        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.parentElement).toBe(document.body);
        expect(screen.getByTestId('transformed-parent')).not.toContainElement(tooltip);
    });
});
