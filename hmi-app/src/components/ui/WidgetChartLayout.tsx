import type { ReactNode, SVGProps } from 'react';
import type { WidgetChartLayoutMetrics } from './WidgetChartLayout.shared';

interface WidgetChartLayoutProps {
    layout: WidgetChartLayoutMetrics;
    svgTestId?: string;
    overlaySvgTestId?: string;
    svgProps?: Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'children'> & {
        [key: `data-${string}`]: string | number | undefined;
    };
    renderMain: (layout: WidgetChartLayoutMetrics) => ReactNode;
    renderOverlay?: (layout: WidgetChartLayoutMetrics) => ReactNode;
}

export default function WidgetChartLayout({ layout, svgTestId, overlaySvgTestId, svgProps, renderMain, renderOverlay }: WidgetChartLayoutProps) {
    const overlayContent = renderOverlay?.(layout);

    return (
        <>
            <svg
                {...svgProps}
                data-testid={svgTestId}
                width={layout.dimensions.width}
                height={layout.dimensions.height}
                viewBox={`0 0 ${layout.dimensions.width} ${layout.dimensions.height}`}
            >
                <defs>
                    <clipPath id={layout.plotClipPathId}>
                        <rect
                            x={layout.plotArea.left}
                            y={layout.plotArea.top}
                            width={layout.plotArea.width}
                            height={layout.plotArea.height}
                        />
                    </clipPath>
                </defs>

                {renderMain(layout)}
            </svg>

            {overlayContent ? (
                <svg
                    width={layout.overlay.width}
                    height={layout.overlay.height}
                    viewBox={layout.overlay.viewBox}
                    className="pointer-events-none absolute left-0"
                    style={{ top: `${layout.overlay.top}px`, overflow: 'visible' }}
                    aria-hidden="true"
                    data-testid={overlaySvgTestId}
                >
                    {overlayContent}
                </svg>
            ) : null}
        </>
    );
}
