import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';

const TOOLTIP_OFFSET_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
type MeasuredTooltipPlacement = TooltipPosition | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface TooltipCoordinates {
    top: number;
    left: number;
    transform: string;
}

interface TooltipSize {
    width: number;
    height: number;
}

export interface HoverTooltipProps extends ComponentPropsWithoutRef<'div'> {
    children: ReactNode;
    label: string;
    position: TooltipPosition;
}

const getTooltipCoordinates = (rect: DOMRect, position: TooltipPosition): TooltipCoordinates => {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    switch (position) {
        case 'top':
            return { top: rect.top - TOOLTIP_OFFSET_PX, left: centerX, transform: 'translate(-50%, -100%)' };
        case 'bottom':
            return { top: rect.bottom + TOOLTIP_OFFSET_PX, left: centerX, transform: 'translate(-50%, 0)' };
        case 'left':
            return { top: centerY, left: rect.left - TOOLTIP_OFFSET_PX, transform: 'translate(-100%, -50%)' };
        case 'right':
            return { top: centerY, left: rect.right + TOOLTIP_OFFSET_PX, transform: 'translate(0, -50%)' };
    }
};

const getOppositePosition = (position: TooltipPosition): TooltipPosition => {
    switch (position) {
        case 'top':
            return 'bottom';
        case 'bottom':
            return 'top';
        case 'left':
            return 'right';
        case 'right':
            return 'left';
    }
};

const getTooltipBox = (rect: DOMRect, size: TooltipSize, position: MeasuredTooltipPlacement) => {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    switch (position) {
        case 'top':
            return {
                top: rect.top - TOOLTIP_OFFSET_PX - size.height,
                left: centerX - size.width / 2,
            };
        case 'bottom':
            return {
                top: rect.bottom + TOOLTIP_OFFSET_PX,
                left: centerX - size.width / 2,
            };
        case 'left':
            return {
                top: centerY - size.height / 2,
                left: rect.left - TOOLTIP_OFFSET_PX - size.width,
            };
        case 'right':
            return {
                top: centerY - size.height / 2,
                left: rect.right + TOOLTIP_OFFSET_PX,
            };
        case 'top-left':
            return {
                top: rect.top - TOOLTIP_OFFSET_PX - size.height,
                left: rect.right - size.width,
            };
        case 'top-right':
            return {
                top: rect.top - TOOLTIP_OFFSET_PX - size.height,
                left: rect.right + TOOLTIP_OFFSET_PX,
            };
        case 'bottom-left':
            return {
                top: rect.bottom + TOOLTIP_OFFSET_PX,
                left: rect.right - size.width,
            };
        case 'bottom-right':
            return {
                top: rect.bottom + TOOLTIP_OFFSET_PX,
                left: rect.right + TOOLTIP_OFFSET_PX,
            };
    }
};

const overflowsPrimaryAxis = (rect: DOMRect, size: TooltipSize, position: TooltipPosition) => {
    const box = getTooltipBox(rect, size, position);

    switch (position) {
        case 'top':
            return box.top < VIEWPORT_MARGIN_PX;
        case 'bottom':
            return box.top + size.height > window.innerHeight - VIEWPORT_MARGIN_PX;
        case 'left':
            return box.left < VIEWPORT_MARGIN_PX;
        case 'right':
            return box.left + size.width > window.innerWidth - VIEWPORT_MARGIN_PX;
    }
};

const fitsWithinViewport = (box: { top: number; left: number }, size: TooltipSize) => {
    return (
        box.left >= VIEWPORT_MARGIN_PX &&
        box.top >= VIEWPORT_MARGIN_PX &&
        box.left + size.width <= window.innerWidth - VIEWPORT_MARGIN_PX &&
        box.top + size.height <= window.innerHeight - VIEWPORT_MARGIN_PX
    );
};

const getMeasuredPlacementCandidates = (preferredPosition: TooltipPosition): MeasuredTooltipPlacement[] => {
    switch (preferredPosition) {
        case 'left':
            return ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'];
        case 'right':
            return ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'right', 'left'];
        case 'top':
            return ['top', 'bottom'];
        case 'bottom':
            return ['bottom', 'top'];
    }
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getMeasuredTooltipCoordinates = (
    rect: DOMRect,
    size: TooltipSize,
    preferredPosition: TooltipPosition,
): TooltipCoordinates => {
    const fallbackPosition = getOppositePosition(preferredPosition);
    const defaultPosition = overflowsPrimaryAxis(rect, size, preferredPosition) ? fallbackPosition : preferredPosition;
    const finalPosition =
        getMeasuredPlacementCandidates(preferredPosition).find((candidate) =>
            fitsWithinViewport(getTooltipBox(rect, size, candidate), size),
        ) ?? defaultPosition;
    const tooltipBox = getTooltipBox(rect, size, finalPosition);
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - VIEWPORT_MARGIN_PX - size.width);
    const maxTop = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - VIEWPORT_MARGIN_PX - size.height);
    const clampedLeft = clamp(tooltipBox.left, VIEWPORT_MARGIN_PX, maxLeft);
    const clampedTop = clamp(tooltipBox.top, VIEWPORT_MARGIN_PX, maxTop);

    switch (finalPosition) {
        case 'top':
            return {
                top: clampedTop + size.height,
                left: clampedLeft + size.width / 2,
                transform: 'translate(-50%, -100%)',
            };
        case 'bottom':
            return {
                top: clampedTop,
                left: clampedLeft + size.width / 2,
                transform: 'translate(-50%, 0)',
            };
        case 'left':
            return {
                top: clampedTop + size.height / 2,
                left: clampedLeft + size.width,
                transform: 'translate(-100%, -50%)',
            };
        case 'right':
            return {
                top: clampedTop + size.height / 2,
                left: clampedLeft,
                transform: 'translate(0, -50%)',
            };
        case 'top-left':
        case 'top-right':
        case 'bottom-left':
        case 'bottom-right':
            return {
                top: clampedTop,
                left: clampedLeft,
                transform: 'none',
            };
    }
};

export default function HoverTooltip({
    children,
    label,
    position,
    className,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    ...rest
}: HoverTooltipProps) {
    const triggerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLSpanElement>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [coordinates, setCoordinates] = useState<TooltipCoordinates | null>(null);

    const updatePosition = useCallback(() => {
        if (!triggerRef.current) {
            return;
        }

        const triggerRect = triggerRef.current.getBoundingClientRect();
        const tooltipRect = tooltipRef.current?.getBoundingClientRect();

        if (!tooltipRect || tooltipRect.width === 0 || tooltipRect.height === 0) {
            setCoordinates(getTooltipCoordinates(triggerRect, position));
            return;
        }

        setCoordinates(
            getMeasuredTooltipCoordinates(triggerRect, { width: tooltipRect.width, height: tooltipRect.height }, position),
        );
    }, [position]);

    const showTooltip = useCallback(() => {
        updatePosition();
        setIsVisible(true);
    }, [updatePosition]);

    const hideTooltip = useCallback(() => {
        setIsVisible(false);
    }, []);

    useEffect(() => {
        if (!isVisible) {
            return;
        }

        const handleViewportChange = () => updatePosition();

        window.addEventListener('scroll', handleViewportChange, true);
        window.addEventListener('resize', handleViewportChange);

        return () => {
            window.removeEventListener('scroll', handleViewportChange, true);
            window.removeEventListener('resize', handleViewportChange);
        };
    }, [isVisible, updatePosition]);

    useLayoutEffect(() => {
        if (!isVisible) {
            return;
        }

        updatePosition();
    }, [isVisible, updatePosition]);

    return (
        <div
            ref={triggerRef}
            className={className}
            onMouseEnter={(event) => {
                showTooltip();
                onMouseEnter?.(event);
            }}
            onMouseLeave={(event) => {
                hideTooltip();
                onMouseLeave?.(event);
            }}
            onFocus={(event) => {
                showTooltip();
                onFocus?.(event);
            }}
            onBlur={(event) => {
                hideTooltip();
                onBlur?.(event);
            }}
            {...rest}
        >
            {children}
            {isVisible && coordinates ? (
                <span
                    ref={tooltipRef}
                    role="tooltip"
                    className="pointer-events-none fixed z-50 whitespace-nowrap rounded border border-white bg-industrial-surface/90 px-2 py-1 text-white"
                    style={coordinates}
                >
                    {label}
                </span>
            ) : null}
        </div>
    );
}
