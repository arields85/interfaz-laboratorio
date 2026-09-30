import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { useIconCutoutActive } from '../../hooks/useIconCutoutActive';
import { useIconCutoutGeometry } from '../../hooks/useIconCutoutGeometry';
import { useTabFrameActive } from '../../hooks/useTabFrameActive';
import { useTabFrameGeometry } from '../../hooks/useTabFrameGeometry';
import { useTabFrameHeight } from '../../hooks/useTabFrameHeight';
import { useTabFrameIconPlacement } from '../../hooks/useTabFrameIconPlacement';
import { useTabFrameStrip } from '../../hooks/useTabFrameStrip';
import { TabFrameContext, TabFrameReporterContext, type TabFrameAlertState } from '../../hooks/tabFrameContext';
import { supportsTabFrameTrailingStrip } from '../../utils/widgetCapabilities';
import { TAB_FRAME_GLOW_CLIP_MARGIN_PX, TAB_FRAME_TITLE_HIDDEN, buildTabFrameGlowClipPath, buildTabFramePath } from '../../utils/tabFramePath';

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
// `--tab-frame-height` (so the fill, the border clip, the tab and the icon host follow) and the
// slanted-side cut scaled to it as its own `--tab-frame-tab-cut` (the angle never changes), the
// silhouette and the icon placement use them, and it is reported next to the tab width for the layers
// outside the shell. The tab grows downward into the widget; the outer size never changes.
//
// Header trailing content (a chart's period selector) is portaled into a host in the top strip, left of the
// icon (`useTabFrameStrip`): the tab's reserve grows by the host width plus one gap
// (`--tab-frame-trailing-gap`), and a tab whose label would have less than `--tab-frame-min-title` of room
// is hidden (`data-tab-title-hidden`, reported as `TAB_FRAME_TITLE_HIDDEN`, silhouette without the tab).
// The header then keeps only the clearance under the strip (`--tab-frame-header-clearance`).
// That is an opt-in of the five chart types (`supportsTabFrameTrailingStrip`, decided HERE and carried to
// the header as `trailingPlacement`), and only while the content fits in the frame: the header reports
// the content's intrinsic width (measured wherever it renders, so the decision never flips back and
// forth) and a selector too wide for the frame falls back to the body header row, the title tab back to
// normal. Every other widget keeps its trailing content in its header row.
// =============================================================================

/** Inline style of the tab shell: the radius plus the custom properties computed from the tokens. */
type TabFrameShellStyle = CSSProperties & {
    '--tab-frame-height'?: string;
    '--tab-frame-tab-cut'?: string;
    '--tab-frame-icon-top'?: string;
    '--tab-frame-icon-reserve'?: string;
    '--tab-frame-tab-reserve'?: string;
    '--tab-frame-icon-strip-extent'?: string;
    '--tab-frame-header-clearance'?: string;
};

/** Writes `node` to a ref that is either an object or a callback (the content element is ref'd twice). */
function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
    if (typeof ref === 'function') {
        ref(node);
    } else if (ref) {
        ref.current = node;
    }
}

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
    // Icon cutout (Clasico + Estandar, see `useIconCutoutActive`): only the standard frame element has it.
    const cutoutActive = useIconCutoutActive(widgetType) && !tabActive;
    const frameRef = useRef<HTMLElement | null>(null);
    const setFrameRef = useCallback((node: HTMLElement | null) => {
        frameRef.current = node;
        assignRef(ref, node);
    }, [ref]);
    useIconCutoutGeometry(frameRef, cutoutActive);
    const shellRef = useRef<HTMLDivElement>(null);
    const [titleHost, setTitleHost] = useState<HTMLElement | null>(null);
    const [iconHost, setIconHost] = useState<HTMLElement | null>(null);
    const [trailingHost, setTrailingHost] = useState<HTMLElement | null>(null);
    const [content, setContent] = useState<HTMLElement | null>(null);
    const [tabWidth, setTabWidth] = useState(0);
    // Intrinsic width of the header's trailing content, reported by `WidgetHeader` (0 = none).
    const [trailingWidth, setTrailingWidth] = useState(0);
    const alertState = resolveAlertState(frameClassName);
    const titleFontSize = tabActive ? (tabTitleFontSize ?? null) : null;
    // The content element is measured by the strip (its padding) and still handed to the widget's own ref.
    const setContentRef = useCallback((node: HTMLElement | null) => {
        setContent(node);
        assignRef(ref, node);
    }, [ref]);
    const reportTabWidth = useContext(TabFrameReporterContext);
    // Effective tab size of a title with its own size (height capped so the body keeps room, and the
    // slanted-side cut scaled with it); null keeps the `--tab-frame-height` / `--tab-frame-tab-cut` tokens.
    const ownTabSize = useTabFrameHeight(titleFontSize, shellRef);
    const tabHeight = ownTabSize?.height;
    const iconPlacement = useTabFrameIconPlacement(shellRef, tabActive, tabHeight);
    // Only the chart types that opt in host their trailing content in the strip; every other widget keeps
    // it in its header row and the frame publishes nothing for the strip.
    const stripCapable = supportsTabFrameTrailingStrip(widgetType);
    const strip = useTabFrameStrip({
        shellRef,
        trailingWidth: stripCapable ? trailingWidth : 0,
        content,
        active: tabActive,
        tabHeight,
        iconPlacement,
    });
    // Until the content is measured it goes to the strip (as it always did); too wide for the frame, it falls back to the body row.
    const trailingPlacement = stripCapable ? (strip?.placement ?? 'strip') : 'body';
    const tabContext = useMemo(
        () => ({
            titleHost,
            iconHost,
            trailingHost,
            trailingPlacement,
            trailingBelowStrip: stripCapable && trailingPlacement === 'body',
            reportTrailingWidth: setTrailingWidth,
            alertState,
            titleFontSize,
        }),
        [titleHost, iconHost, trailingHost, trailingPlacement, stripCapable, alertState, titleFontSize],
    );
    const titleHidden = strip?.titleHidden ?? false;
    const geometry = useTabFrameGeometry(shellRef, tabActive ? (titleHidden ? TAB_FRAME_TITLE_HIDDEN : tabWidth) : null, tabHeight);
    const silhouette = geometry ? buildTabFramePath(geometry) : null;
    // Tab height, icon top and the space the tab leaves free for it (index.css, `.hmi-tab-frame-icon-host`).
    const shellStyle: TabFrameShellStyle = { borderRadius: 'var(--frame-radius-rest)' };

    if (ownTabSize !== null) {
        shellStyle['--tab-frame-height'] = `${ownTabSize.height}px`;
        shellStyle['--tab-frame-tab-cut'] = `${ownTabSize.tabCut}px`;
    }

    if (iconPlacement) {
        shellStyle['--tab-frame-icon-top'] = `${iconPlacement.top}px`;
        shellStyle['--tab-frame-icon-reserve'] = `${iconPlacement.reserve}px`;
    }

    // Strip content (a chart's selector): the tab stops before it and the header row keeps only the clearance.
    if (strip && strip.reserve !== null) {
        shellStyle['--tab-frame-tab-reserve'] = `${strip.reserve}px`;
        shellStyle['--tab-frame-icon-strip-extent'] = `${strip.iconExtent}px`;
    }

    // The header starts under the strip whenever the trailing content is a chart's: collapsed in the strip, or its body row.
    if (strip && strip.clearance !== null) {
        shellStyle['--tab-frame-header-clearance'] = `${strip.clearance}px`;
    }

    // Publish the tab width (it follows the title) for the layers that trace the silhouette. It is
    // published from the very first layout pass: 0 means "tab shape, width not measured yet" so those
    // layers wait for the silhouette instead of showing a rectangle; `null` only when the frame is not
    // the tab shape (or unmounts); `TAB_FRAME_TITLE_HIDDEN` when the title tab is hidden.
    useLayoutEffect(() => {
        if (!tabActive) {
            return undefined;
        }

        const publish = () => {
            const measured = titleHidden
                ? TAB_FRAME_TITLE_HIDDEN
                : titleHost && titleHost.offsetWidth > 0 ? titleHost.offsetWidth : 0;
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
    }, [tabActive, titleHost, reportTabWidth, tabHeight, titleHidden]);

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
                ref={setFrameRef as Ref<never>}
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
            data-tab-title-hidden={titleHidden ? 'true' : undefined}
            style={shellStyle}
            className={['hmi-tab-frame group relative w-full h-full min-h-0', outerClassName].filter(Boolean).join(' ')}
        >
            {/* First child: the strip content comes before the chart in keyboard order (it paints above via z-index). */}
            <div ref={setTrailingHost} data-testid="tab-frame-trailing-host" className="hmi-tab-frame-trailing-host" />
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
                ref={setContentRef as Ref<never>}
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
