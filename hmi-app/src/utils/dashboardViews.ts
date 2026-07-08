import type {
    Dashboard,
    DashboardHeaderConfig,
    DashboardView,
    PublishedSnapshot,
    WidgetConfig,
    WidgetLayout,
} from '../domain/admin.types';

export const DEFAULT_DASHBOARD_VIEW_ID = 'view-default';
export const DEFAULT_DASHBOARD_VIEW_NAME = 'Default view';

interface CreateDefaultDashboardViewInput {
    id?: string;
    name?: string;
    subtitle?: string;
    iconKey?: DashboardView['iconKey'];
    order?: number;
    widgets?: WidgetConfig[];
    layout?: WidgetLayout[];
}

interface CloneDashboardViewsResult {
    views: DashboardView[];
    viewIdMap: Map<string, string>;
    widgetIdMapByView: Map<string, Map<string, string>>;
}

interface DashboardViewUpdateResult {
    views: DashboardView[];
    activeViewId?: string;
}

interface DashboardViewPresentationInput {
    id?: string;
    name?: string;
    iconKey?: DashboardView['iconKey'];
}

export function createDefaultDashboardView({
    id = DEFAULT_DASHBOARD_VIEW_ID,
    name = DEFAULT_DASHBOARD_VIEW_NAME,
    subtitle,
    iconKey,
    order = 0,
    widgets = [],
    layout = [],
}: CreateDefaultDashboardViewInput = {}): DashboardView {
    return {
        id,
        name,
        subtitle,
        iconKey,
        order,
        widgets: clone(widgets),
        layout: clone(layout),
    };
}

export function normalizeDashboardViews<T extends Dashboard>(dashboard: T): T {
    const normalizedViews = normalizeViewCollection(dashboard.views, dashboard.widgets, dashboard.layout);
    const activeViewId = resolveDefaultDashboardViewId(normalizedViews);
    const activeView = normalizedViews.find((view) => view.id === activeViewId) ?? normalizedViews[0];
    const publishedSnapshot = dashboard.publishedSnapshot
        ? normalizePublishedSnapshotViews(dashboard.publishedSnapshot)
        : undefined;

    return {
        ...clone(dashboard),
        views: normalizedViews,
        activeViewId,
        widgets: clone(activeView?.widgets ?? []),
        layout: clone(activeView?.layout ?? []),
        publishedSnapshot,
    };
}

export function normalizePublishedSnapshotViews(snapshot: PublishedSnapshot): PublishedSnapshot {
    const normalizedViews = normalizeViewCollection(snapshot.views, snapshot.widgets, snapshot.layout);
    const activeViewId = resolveActiveViewId(normalizedViews, snapshot.activeViewId);
    const activeView = normalizedViews.find((view) => view.id === activeViewId) ?? normalizedViews[0];

    return {
        ...clone(snapshot),
        views: normalizedViews,
        activeViewId,
        widgets: clone(activeView?.widgets ?? []),
        layout: clone(activeView?.layout ?? []),
    };
}

export function materializeDashboardView<T extends Dashboard>(dashboard: T, preferredViewId?: string): T {
    const normalized = normalizeDashboardViews(dashboard);
    const activeViewId = preferredViewId
        ? resolveActiveViewId(normalized.views ?? [], preferredViewId)
        : resolveDefaultDashboardViewId(normalized.views ?? []);
    const activeView = normalized.views?.find((view) => view.id === activeViewId) ?? normalized.views?.[0];

    return {
        ...normalized,
        activeViewId,
        widgets: clone(activeView?.widgets ?? []),
        layout: clone(activeView?.layout ?? []),
    } as T;
}

export function getActiveDashboardView(dashboard: Dashboard, preferredViewId?: string): DashboardView {
    const normalized = normalizeDashboardViews(dashboard);
    const activeViewId = preferredViewId
        ? resolveActiveViewId(normalized.views ?? [], preferredViewId)
        : resolveDefaultDashboardViewId(normalized.views ?? []);

    return normalized.views?.find((view) => view.id === activeViewId) ?? createDefaultDashboardView();
}

export function getDefaultDashboardView(dashboard: Dashboard): DashboardView {
    const normalized = normalizeDashboardViews(dashboard);
    const defaultViewId = resolveDefaultDashboardViewId(normalized.views ?? []);

    return normalized.views?.find((view) => view.id === defaultViewId) ?? createDefaultDashboardView();
}

export function getAllDashboardWidgets(dashboard: Dashboard): WidgetConfig[] {
    return normalizeDashboardViews(dashboard).views?.flatMap((view) => view.widgets) ?? [];
}

export function setActiveDashboardView<T extends Dashboard>(dashboard: T, viewId: string): T {
    return materializeDashboardView(dashboard, viewId);
}

export function createDashboardView<T extends Dashboard>(dashboard: T, input?: string | DashboardViewPresentationInput): T {
    return updateDashboardViews(dashboard, (views) => {
        const presentation = typeof input === 'string' ? { name: input } : input ?? {};
        const nextView: DashboardView = createDefaultDashboardView({
            id: presentation.id ?? `view-${Date.now().toString(36)}`,
            name: presentation.name?.trim() || `View ${views.length + 1}`,
            iconKey: presentation.iconKey,
            order: views.length,
        });

        return {
            views: [...views, nextView],
        };
    });
}

export function renameDashboardView<T extends Dashboard>(dashboard: T, viewId: string, name: string): T {
    return updateDashboardViewPresentation(dashboard, viewId, { name });
}

export function updateDashboardViewPresentation<T extends Dashboard>(
    dashboard: T,
    viewId: string,
    presentation: DashboardViewPresentationInput,
): T {
    const trimmedName = presentation.name?.trim();

    if (!trimmedName) {
        return normalizeDashboardViews(dashboard);
    }

    return updateDashboardViews(dashboard, (views) => ({
        views: views.map((view) => (
            view.id === viewId
                ? {
                    ...view,
                    name: trimmedName,
                    iconKey: presentation.iconKey,
                }
                : view
        )),
    }));
}

export function moveDashboardView<T extends Dashboard>(dashboard: T, viewId: string, direction: 'left' | 'right'): T {
    return updateDashboardViews(dashboard, (views, activeViewId) => {
        const currentIndex = views.findIndex((view) => view.id === viewId);
        const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;

        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= views.length) {
            return { views, activeViewId };
        }

        const reorderedViews = [...views];
        const [movingView] = reorderedViews.splice(currentIndex, 1);
        reorderedViews.splice(targetIndex, 0, movingView);

        return {
            views: reorderedViews.map((view, index) => ({ ...view, order: index })),
            activeViewId,
        };
    });
}

export function deleteDashboardView<T extends Dashboard>(dashboard: T, viewId: string): T {
    return updateDashboardViews(dashboard, (views, activeViewId) => {
        if (!canDeleteDashboardView(views, viewId)) {
            return { views, activeViewId };
        }

        const currentIndex = views.findIndex((view) => view.id === viewId);
        const nextViews = views.filter((view) => view.id !== viewId).map((view, index) => ({
            ...view,
            order: index,
        }));
        const fallbackView = nextViews[Math.max(0, currentIndex - 1)] ?? nextViews[0];

        return {
            views: nextViews,
            activeViewId: activeViewId === viewId ? fallbackView?.id : activeViewId,
        };
    });
}

export function updateActiveDashboardView<T extends Dashboard>(
    dashboard: T,
    updater: (view: DashboardView) => DashboardView,
): T {
    const activeViewId = getActiveDashboardView(dashboard).id;

    return updateDashboardView(dashboard, activeViewId, updater);
}

export function updateDashboardView<T extends Dashboard>(
    dashboard: T,
    viewId: string,
    updater: (view: DashboardView) => DashboardView,
): T {
    return updateDashboardViews(dashboard, (views, activeViewId) => ({
        views: views.map((view) => (
            view.id === viewId
                ? normalizeDashboardView(updater(clone(view)), view.order)
                : normalizeDashboardView(view, view.order)
        )),
        activeViewId,
    }));
}

export function mapDashboardWidgets<T extends Dashboard>(
    dashboard: T,
    mapper: (widget: WidgetConfig, view: DashboardView) => WidgetConfig,
): T {
    return updateDashboardViews(dashboard, (views, activeViewId) => ({
        views: views.map((view) => ({
            ...normalizeDashboardView(view, view.order),
            widgets: view.widgets.map((widget) => mapper(clone(widget), view)),
        })),
        activeViewId,
    }));
}

export function canDeleteDashboardView(views: DashboardView[], viewId: string): boolean {
    return views.length > 1 && views.some((view) => view.id === viewId);
}

export function cloneDashboardViewsWithRemappedIds(views: DashboardView[], suffix: string): CloneDashboardViewsResult {
    const viewIdMap = new Map<string, string>();
    const widgetIdMapByView = new Map<string, Map<string, string>>();

    const clonedViews = views.map((view, viewIndex) => {
        const nextViewId = `${view.id}-${suffix}`;
        viewIdMap.set(view.id, nextViewId);

        const widgetIdMap = new Map<string, string>();
        const clonedWidgets = view.widgets.map((widget) => {
            const nextWidgetId = `${widget.id}-${suffix}-${view.id}`;
            widgetIdMap.set(widget.id, nextWidgetId);
            return {
                ...clone(widget),
                id: nextWidgetId,
            };
        });

        widgetIdMapByView.set(view.id, widgetIdMap);

        return {
            ...clone(view),
            id: nextViewId,
            order: view.order ?? viewIndex,
            widgets: clonedWidgets,
            layout: view.layout.map((item) => ({
                ...clone(item),
                widgetId: widgetIdMap.get(item.widgetId) ?? item.widgetId,
            })),
        } satisfies DashboardView;
    });

    return {
        views: clonedViews,
        viewIdMap,
        widgetIdMapByView,
    };
}

export function remapDashboardHeaderConfigForView(
    headerConfig: DashboardHeaderConfig | undefined,
    widgetIdMap: ReadonlyMap<string, string>,
): DashboardHeaderConfig | undefined {
    if (!headerConfig) {
        return undefined;
    }

    return {
        ...clone(headerConfig),
        widgetSlots: (headerConfig.widgetSlots ?? []).map((slot) => ({
            ...slot,
            widgetId: widgetIdMap.get(slot.widgetId) ?? slot.widgetId,
        })),
    };
}

export function remapDashboardHeaderConfigAcrossViews(
    headerConfig: DashboardHeaderConfig | undefined,
    sourceViews: ReadonlyArray<DashboardView>,
    widgetIdMapByView: ReadonlyMap<string, ReadonlyMap<string, string>>,
): DashboardHeaderConfig | undefined {
    if (!headerConfig) {
        return undefined;
    }

    const sourceViewWidgetIds = sourceViews.map((view) => ({
        widgetIds: new Set(view.widgets.map((widget) => widget.id)),
        widgetIdMap: widgetIdMapByView.get(view.id) ?? new Map<string, string>(),
    }));

    return {
        ...clone(headerConfig),
        widgetSlots: (headerConfig.widgetSlots ?? []).map((slot) => {
            const matchingView = sourceViewWidgetIds.find(({ widgetIds }) => widgetIds.has(slot.widgetId));

            return {
                ...slot,
                widgetId: matchingView?.widgetIdMap.get(slot.widgetId) ?? slot.widgetId,
            };
        }),
    };
}

function normalizeViewCollection(
    views: DashboardView[] | undefined,
    legacyWidgets: WidgetConfig[] | undefined,
    legacyLayout: WidgetLayout[] | undefined,
): DashboardView[] {
    const sourceViews = views && views.length > 0
        ? views
        : [createDefaultDashboardView({ widgets: legacyWidgets, layout: legacyLayout })];

    return sourceViews
        .map((view, index) => normalizeDashboardView(view, index))
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        .map((view, index) => normalizeDashboardView(view, index));
}

function resolveActiveViewId(views: DashboardView[], activeViewId: string | undefined): string {
    if (activeViewId && views.some((view) => view.id === activeViewId)) {
        return activeViewId;
    }

    return views[0]?.id ?? DEFAULT_DASHBOARD_VIEW_ID;
}

function resolveDefaultDashboardViewId(views: DashboardView[]): string {
    return views[0]?.id ?? DEFAULT_DASHBOARD_VIEW_ID;
}

function clone<T>(value: T): T {
    if (value === undefined) {
        return value;
    }

    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T;
}

function updateDashboardViews<T extends Dashboard>(
    dashboard: T,
    updater: (views: DashboardView[], activeViewId: string) => DashboardViewUpdateResult,
): T {
    const normalized = normalizeDashboardViews(dashboard);
    const views = normalized.views ?? [];
    const activeViewId = resolveActiveViewId(views, normalized.activeViewId);
    const result = updater(views.map((view, index) => normalizeDashboardView(view, index)), activeViewId);

    return materializeDashboardView({
        ...normalized,
        views: result.views.map((view, index) => normalizeDashboardView(view, index)),
        activeViewId: result.activeViewId ?? activeViewId,
    });
}

function normalizeDashboardView(view: DashboardView, fallbackOrder: number): DashboardView {
    return {
        ...clone(view),
        id: view.id || (fallbackOrder === 0 ? DEFAULT_DASHBOARD_VIEW_ID : `view-${fallbackOrder + 1}`),
        name: view.name || (fallbackOrder === 0 ? DEFAULT_DASHBOARD_VIEW_NAME : `View ${fallbackOrder + 1}`),
        order: view.order ?? fallbackOrder,
        widgets: clone(view.widgets ?? []),
        layout: clone(view.layout ?? []),
    };
}
