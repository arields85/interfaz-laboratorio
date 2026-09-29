import { useMemo, useState } from 'react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { useTabFrameActive } from '../../hooks/useTabFrameActive';
import { TabFrameContext } from '../../hooks/tabFrameContext';

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
//         clipped to the chamfered body silhouette, plus the diagonal-border overlay;
//      2. the CONTENT element (`className`, padding/flex/refs): unclipped, so the header icon can
//         sit in the cut-off corner and every child keeps the position it has in the standard frame;
//      3. the TAB, which receives the header title through `TabFrameContext` (WidgetHeader portals
//         it there).
//    Fill, blur and border colors keep coming from the active preset's `--frame-*` tokens because
//    the surface reuses the same classes; geometry comes from the `--tab-frame-*` tokens.
// =============================================================================

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
    as: Tag = 'div',
    ref,
    children,
    ...rest
}: WidgetFrameProps) {
    const tabActive = useTabFrameActive(widgetType, title);
    const [titleHost, setTitleHost] = useState<HTMLElement | null>(null);
    const tabContext = useMemo(() => ({ titleHost }), [titleHost]);

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
            data-widget-frame-shape="tab"
            className={['hmi-tab-frame group relative w-full h-full min-h-0', outerClassName].filter(Boolean).join(' ')}
        >
            <div
                data-testid="tab-frame-surface"
                aria-hidden="true"
                className={`${frameClassName} hmi-tab-frame-surface`}
            >
                <span data-testid="tab-frame-border" className="hmi-tab-frame-border" />
            </div>
            <Tag
                ref={ref as Ref<never>}
                className={['relative', className].filter(Boolean).join(' ')}
                {...rest}
            >
                <TabFrameContext.Provider value={tabContext}>{children}</TabFrameContext.Provider>
            </Tag>
            <div ref={setTitleHost} data-testid="tab-frame-tab" className="hmi-tab-frame-tab" />
        </div>
    );
}
