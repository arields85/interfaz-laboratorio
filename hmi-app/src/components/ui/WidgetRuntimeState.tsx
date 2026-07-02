export type WidgetRuntimeStateKind =
    | 'loading'
    | 'preparing'
    | 'layout'
    | 'chart-not-ready'
    | 'disconnected'
    | 'error'
    | 'invalid-config'
    | 'empty'
    | 'empty-comparable'
    | 'stale';

export const WIDGET_RUNTIME_STATE_LABELS: Record<WidgetRuntimeStateKind, string> = {
    loading: 'Cargando',
    preparing: 'Cargando',
    layout: 'Cargando',
    'chart-not-ready': 'Cargando',
    disconnected: 'Sin conexión',
    error: 'No se pudieron cargar los datos',
    'invalid-config': 'Configuración incompleta',
    empty: 'Sin datos',
    'empty-comparable': 'Sin datos comparables',
    stale: 'Dato desactualizado',
};

const LOADING_STATES: ReadonlySet<WidgetRuntimeStateKind> = new Set([
    'loading',
    'preparing',
    'layout',
    'chart-not-ready',
]);

interface WidgetRuntimeStateProps {
    state: WidgetRuntimeStateKind;
    className?: string;
    labelOverride?: string;
    testId?: string;
}

export default function WidgetRuntimeState({
    state,
    className,
    labelOverride,
    testId,
}: WidgetRuntimeStateProps) {
    const label = labelOverride ?? WIDGET_RUNTIME_STATE_LABELS[state];
    const isLoadingState = LOADING_STATES.has(state);

    return (
        <div
            data-testid={testId}
            className={`flex h-full w-full items-center justify-center px-4 text-center ${className ?? ''}`.trim()}
        >
            <div className="flex flex-col items-center justify-center gap-2">
                <span className="font-system text-industrial-muted">
                    <span>{label}</span>
                    {isLoadingState && (
                        <span aria-hidden="true" className="widget-runtime-state-caret">
                            _
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
}
