import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { useTabFrameActive } from '../../hooks/useTabFrameActive';
import { useTabFrameGeometry } from '../../hooks/useTabFrameGeometry';
import { useTabFrameHeight } from '../../hooks/useTabFrameHeight';
import { useTabFrameIconPlacement } from '../../hooks/useTabFrameIconPlacement';
import { TabFrameContext, TabFrameReporterContext, type TabFrameAlertState } from '../../hooks/tabFrameContext';
import { TAB_FRAME_GLOW_CLIP_MARGIN_PX, buildTabFrameGlowClipPath, buildTabFramePath } from '../../utils/tabFramePath';

// =============================================================================
// WidgetFrame
//
// The framed root of a dashboard-grid widget. Two renderings, decided in ONE place
// (`useTabFrameActive`):
//
//  - Standard (default, and every widget/context that is not eligible): a single element that
//    carries the frame classes (`glass-panel`...) and the content classes together -- exactly the
//    element the renderers used to build by hand.
//  - Tab ("Forma del marco" = Pestaña): a shell of the same outer size holding, as siblings,
//      1. the PAINTED surface (`frameClassName` + `hmi-tab-frame-surface`): the same glass classes
//         clipped to the tab + body silhouette (the body chamfer may be 0), plus the border stroke;
//      2. the CONTENT element (`className`, padding/flex/refs): unclipped; the header icon is drawn in an icon host of the shell, and
//         every child keeps the position it has in the standard frame;
//      3. the TAB, which receives the header title through `TabFrameContext` (WidgetHeader portals
//         it there).
//    Fill, blur and border colors keep coming from the active preset's `--frame-*` tokens because
//    the surface reuses the same classes; geometry comes from the `--tab-frame-*` tokens.
//
// The silhouette is ONE rounded path (`utils/tabFramePath.ts`, every corner with the frame radius)
// built from the measured shell (`useTabFrameGeometry`, ResizeObserver-driven, no per-frame work):
// it clips the surface (`clip-path: path()`; CSS `polygon()` cannot round corners), and the same
// path is stroked for the rest border and grown for the alert glow. Until the box and the tab are
// measured, the CSS polygon of `index.css` is the fallback.
//
// A title with its own size (`tabTitleFontSize`, the `group` widget) makes the tab as tall as that
// title needs, but never more than the shell can give while keeping a minimal body (`useTabFrameHeight`): the shell publishes the effective height as its own
// `--tab-frame-height` (so the fill, the border clip, the tab and the icon host follow), the
// silhouette and the icon placement use it, and it is reported next to the tab width for the layers
// outside the shell. The tab grows downward into the widget; the outer size never changes.
// =============================================================================

/** Inline style of the tab shell: the radius plus the custom properties computed from the tokens. */
type TabFrameShellStyle = CSSProperties & {
    '--tab-frame-height'?: string;
    '--tab-frame-icon-top'?: string;
    '--tab-frame-icon-reserve'?: string;
};

const ALERT_STATE_PATTERN = /(?:^|\s)widget-state-(warning|critical)(?:\s|$)/;

function resolveAlertState(frameClassName: string): TabFrameAlertState | null {
    const match = ALERT_STATE_PATTERN.exec(frameClassName);

    return match ? (match[1] as TabFrameAlertState) : null;
}

interface WidgetFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> {
    /** Widget type, checked against `supportsTabFrame`. */
    widgetType: string;
    /** Widget title; an empty title keeps the standard frame (nothing to put in the tab). */
    title: string | undefined;
    /** Classes that paint the frame: `glass-panel`, `glass-panel-group`, `widget-state-*`. */
    frameClassName: string;
    /** Content/layout classes of the widget root (padding, flex, `group`...). */
    className?: string;
    /** Classes handed down by the parent (item layout); applied to the outermost element. */
    outerClassName?: string;
    /**
     * Font size (px) of a title with the `text-title` typography (the `group` widget), only used while
     * the frame is the tab shape: the tab grows with it and the header renders its title accordingly.
     */
    tabTitleFontSize?: number;
    /** Element of the content root. */
    as?: 'div' | 'article';
    /** Ref of the content root (the element that has the padding). */
    ref?: Ref<HTMLElement>;
    children: ReactNode;
}

export default function WidgetFrame({
    widgetType,
    title,
    frameClassName,
    className = '',
    outerClassName = '',
    tabTitleFontSize,
    as: Tag = 'div',
    ref,
    children,
    ...rest
}: WidgetFrameProps) {
    const tabActive = useTabFrameActive(widgetType, title);
    const shellRef = useRef<HTMLDivElement>(null);
    const [titleHost, setTitleHost] = useState<HTMLElement | null>(null);
    const [iconHost, setIconHost] = useState<HTMLElement | null>(null);
    const [tabWidth, setTabWidth] = useState(0);
    const alertState = resolveAlertState(frameClassName);
    const titleFontSize = tabActive ? (tabTitleFontSize ?? null) : null;
    const tabContext = useMemo(
        () => ({ titleHost, iconHost, alertState, titleFontSize }),
        [titleHost, iconHost, alertState, titleFontSize],
    );
    const reportTabWidth = useContext(TabFrameReporterContext);
    // Effective tab height of a title with its own size, capped so the body keeps room; null keeps the `--tab-frame-height` token.
    const ownTabHeight = useTabFrameHeight(titleFontSize, shellRef);
    const tabHeight = ownTabHeight ?? undefined;
    const geometry = useTabFrameGeometry(shellRef, tabActive ? tabWidth : null, tabHeight);
    const silhouette = geometry ? buildTabFramePath(geometry) : null;
    const iconPlacement = useTabFrameIconPlacement(shellRef, tabActive, tabHeight);
    // Tab height, icon top and the space the tab leaves free for it (index.css, `.hmi-tab-frame-icon-host`).
    const shellStyle: TabFrameShellStyle = { borderRadius: 'var(--frame-radius-rest)' };

    if (ownTabHeight !== null) {
        shellStyle['--tab-frame-height'] = `${ownTabHeight}px`;
    }

    if (iconPlacement) {
        shellStyle['--tab-frame-icon-top'] = `${iconPlacement.top}px`;
        shellStyle['--tab-frame-icon-reserve'] = `${iconPlacement.reserve}px`;
    }

    // Publish the tab width (it follows the title) for the layers that trace the silhouette. It is
    // published from the very first layout pass: 0 means "tab shape, width not measured yet" so those
    // layers wait for the silhouette instead of showing a rectangle; `null` only when the frame is not
    // the tab shape (or unmounts).
    useLayoutEffect(() => {
        if (!tabActive) {
            return undefined;
        }

        const publish = () => {
            const measured = titleHost && titleHost.offsetWidth > 0 ? titleHost.offsetWidth : 0;
            setTabWidth(measured);

            if (tabHeight === undefined) {
                reportTabWidth?.(measured);
            } else {
                reportTabWidth?.(measured, tabHeight);
            }
        };
        publish();

        if (!titleHost || typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const resizeObserver = new ResizeObserver(publish);
        resizeObserver.observe(titleHost);

        return () => resizeObserver.disconnect();
    }, [tabActive, titleHost, reportTabWidth, tabHeight]);

    // Leaving the tab shape (or unmounting) is the only thing that reports the standard shape.
    useLayoutEffect(() => {
        if (!tabActive) {
            return undefined;
        }

        return () => reportTabWidth?.(null);
    }, [tabActive, reportTabWidth]);

    // `Tag` is a `div` or an `article`: a `Ref<HTMLElement>` type-checks on neither intrinsic
    // element type, so the ref is narrowed to `never` at the JSX boundary (runtime is unaffected).
    if (!tabActive) {
        return (
            <Tag
                ref={ref as Ref<never>}
                className={[frameClassName, className, outerClassName].filter(Boolean).join(' ')}
                {...rest}
            >
                {children}
            </Tag>
        );
    }

    return (
        <div
            ref={shellRef}
            data-widget-frame-shape="tab"
            data-alert-state={alertState ?? undefined}
            style={shellStyle}
            className={['hmi-tab-frame group relative w-full h-full min-h-0', outerClassName].filter(Boolean).join(' ')}
        >
            {alertState && (
                <div
                    data-testid="tab-frame-glow"
                    aria-hidden="true"
                    data-alert-state={alertState}
                    className="hmi-tab-frame-glow"
                    style={geometry ? { clipPath: `path(evenodd, '${buildTabFrameGlowClipPath(geometry, TAB_FRAME_GLOW_CLIP_MARGIN_PX)}')` } : { display: 'none' }}
                >
                    <div
                        data-testid="tab-frame-glow-shape"
                        className="hmi-tab-frame-glow-shape"
                        style={geometry ? { clipPath: `path('${buildTabFramePath(geometry, -(geometry.glowSpread ?? 0))}')` } : undefined}
                    />
                </div>
            )}
            <div
                data-testid="tab-frame-surface"
                aria-hidden="true"
                className={`${frameClassName} hmi-tab-frame-surface`}
                style={silhouette ? { clipPath: `path('${silhouette}')` } : undefined}
            >
                <span data-testid="tab-frame-fill" className="hmi-tab-frame-fill" />
                <svg data-testid="tab-frame-border" className="hmi-tab-frame-border">
                    {silhouette && <path d={silhouette} />}
                </svg>
            </div>
            <Tag
                ref={ref as Ref<never>}
                className={['relative', className].filter(Boolean).join(' ')}
                {...rest}
            >
                <TabFrameContext.Provider value={tabContext}>{children}</TabFrameContext.Provider>
            </Tag>
            <div ref={setTitleHost} data-testid="tab-frame-tab" className="hmi-tab-frame-tab" />
            <div ref={setIconHost} data-testid="tab-frame-icon-host" className="hmi-tab-frame-icon-host" />
        </div>
    );
}
