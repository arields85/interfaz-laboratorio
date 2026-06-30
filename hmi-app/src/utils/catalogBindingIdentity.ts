import type { WidgetConfig } from '../domain/admin.types';

export function getCatalogBindingContext(widget: WidgetConfig): string {
    if (widget.hierarchyMode) {
        return 'hierarchy';
    }

    const binding = widget.binding;

    if (!binding) {
        return 'unbound';
    }

    if (binding.mode === 'real_variable') {
        if (binding.machineId !== undefined) {
            return `machine:${binding.machineId}`;
        }

        if (binding.assetId) {
            return `asset:${binding.assetId}`;
        }

        return 'real:unbound';
    }

    if (binding.mode === 'simulated_value') {
        return 'simulated';
    }

    return 'unbound';
}

export function getCatalogBindingIdentity(widget: WidgetConfig): string | null {
    const catalogVariableId = widget.binding?.catalogVariableId;

    if (!catalogVariableId) {
        return null;
    }

    return `${catalogVariableId}::${getCatalogBindingContext(widget)}`;
}

export function hasDuplicateCatalogBindings(widgets: WidgetConfig[]): boolean {
    const seen = new Set<string>();

    for (const widget of widgets) {
        const identity = getCatalogBindingIdentity(widget);

        if (!identity) {
            continue;
        }

        if (seen.has(identity)) {
            return true;
        }

        seen.add(identity);
    }

    return false;
}

export function getUsedCatalogVariableIdsForWidget(
    widgets: WidgetConfig[],
    selectedWidgetId?: string,
): string[] {
    if (!selectedWidgetId) {
        return [];
    }

    const selectedWidget = widgets.find((widget) => widget.id === selectedWidgetId);

    if (!selectedWidget) {
        return [];
    }

    const selectedContext = getCatalogBindingContext(selectedWidget);
    const usedIds = new Set<string>();

    for (const widget of widgets) {
        if (widget.id === selectedWidgetId) {
            continue;
        }

        const identity = getCatalogBindingIdentity(widget);

        if (!identity) {
            continue;
        }

        const [catalogVariableId, context] = identity.split('::');

        if (context === selectedContext && catalogVariableId) {
            usedIds.add(catalogVariableId);
        }
    }

    return Array.from(usedIds);
}
