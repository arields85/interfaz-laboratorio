import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AdminActionButton from './AdminActionButton';
import { ADMIN_SIDEBAR_LABEL_CLS, ADMIN_SIDEBAR_INPUT_CLS, ADMIN_SIDEBAR_HINT_CLS } from './adminSidebarStyles';
import {
    DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS,
    DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS,
    DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT,
    DATA_DEFAULT_ENDPOINT,
    DATA_DEFAULT_HISTORY_ENDPOINT,
    clearDataActivitySeriesEndpoint,
    clearDataEndpoint,
    clearDataHistoryEndpoint,
    clearDataSnapshotExportEnabledSetting,
    clearDataSnapshotExportEndpoint,
    clearDataSnapshotExportIntervalMs,
    getDataBaseUrl,
    getDataSnapshotExportEnabledSetting,
    getDataSnapshotExportIntervalMs,
    getSavedDataActivitySeriesEndpoint,
    getSavedDataEndpoint,
    getSavedDataBaseUrl,
    getSavedDataHistoryEndpoint,
    getSavedDataSnapshotExportEndpoint,
    clearDataBaseUrl,
    saveDataBaseUrl,
    saveDataActivitySeriesEndpoint,
    saveDataEndpoint,
    saveDataHistoryEndpoint,
    saveDataSnapshotExportEnabledSetting,
    saveDataSnapshotExportEndpoint,
    saveDataSnapshotExportIntervalMs,
} from '../../config/dataConnection.config';
import { DATA_OVERVIEW_QUERY_KEY } from '../../queries/useDataOverview';
import { ACTIVITY_SERIES_QUERY_KEY_PREFIX } from '../../queries/useActivitySeries';
import { DATA_HISTORY_QUERY_KEY_PREFIX } from '../../queries/useDataHistory';

// =============================================================================
// ConnectionSettingsTab
// Contenido extraído de NodeRedSettingsDialog — configura URL base y endpoints.
// =============================================================================

interface ConnectionSettingsTabProps {
    onStatusChange?: (saved: boolean) => void;
    onDirtyChange?: (dirty: boolean) => void;
    saveRef?: { current: (() => void) | null };
}

export default function ConnectionSettingsTab({ onStatusChange, onDirtyChange, saveRef }: ConnectionSettingsTabProps) {
    const queryClient = useQueryClient();
    const [draftUrl, setDraftUrl] = useState(() => getSavedDataBaseUrl() || (getDataBaseUrl() ?? ''));
    const [draftEndpoint, setDraftEndpoint] = useState(() => getSavedDataEndpoint() || DATA_DEFAULT_ENDPOINT);
    const [draftHistoryEndpoint, setDraftHistoryEndpoint] = useState(() => getSavedDataHistoryEndpoint() || DATA_DEFAULT_HISTORY_ENDPOINT);
    const [draftActivitySeriesEndpoint, setDraftActivitySeriesEndpoint] = useState(() => getSavedDataActivitySeriesEndpoint() ?? DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT);
    const [draftSnapshotExportEnabled, setDraftSnapshotExportEnabled] = useState(() => getDataSnapshotExportEnabledSetting());
    const [draftSnapshotExportEndpoint, setDraftSnapshotExportEndpoint] = useState(() => getSavedDataSnapshotExportEndpoint() ?? '');
    const [draftSnapshotExportIntervalMs, setDraftSnapshotExportIntervalMs] = useState(() => String(getDataSnapshotExportIntervalMs()));

    const previewSnapshotUrl = useMemo(() => {
        const baseUrl = draftUrl.trim().replace(/\/+$/, '');
        const endpoint = (draftEndpoint.trim() || DATA_DEFAULT_ENDPOINT).replace(/^\/+/, '');

        if (!baseUrl) {
            return null;
        }

        return `${baseUrl}/${endpoint}`;
    }, [draftEndpoint, draftUrl]);

    const previewHistoryUrl = useMemo(() => {
        const baseUrl = draftUrl.trim().replace(/\/+$/, '');
        const historyEndpoint = draftHistoryEndpoint.trim().replace(/^\/+/, '');

        if (!historyEndpoint) {
            return 'No configurado';
        }

        if (!baseUrl) {
            return 'Sin URL base configurada';
        }

        return `${baseUrl}/${historyEndpoint}`;
    }, [draftHistoryEndpoint, draftUrl]);

    const previewActivitySeriesUrl = useMemo(() => {
        const baseUrl = draftUrl.trim().replace(/\/+$/, '');
        const activitySeriesEndpoint = draftActivitySeriesEndpoint.trim().replace(/^\/+/, '');

        if (!activitySeriesEndpoint) {
            return 'No configurado';
        }

        if (!baseUrl) {
            return 'Sin URL base configurada';
        }

        return `${baseUrl}/${activitySeriesEndpoint}`;
    }, [draftActivitySeriesEndpoint, draftUrl]);

    const previewSnapshotExportUrl = useMemo(() => {
        const baseUrl = draftUrl.trim().replace(/\/+$/, '');
        const snapshotExportEndpoint = draftSnapshotExportEndpoint.trim().replace(/^\/+/, '');

        if (!snapshotExportEndpoint) {
            return 'No configurado';
        }

        if (!baseUrl) {
            return 'Sin URL base configurada';
        }

        return `${baseUrl}/${snapshotExportEndpoint}`;
    }, [draftSnapshotExportEndpoint, draftUrl]);

    const handleSave = useCallback(() => {
        const trimmed = draftUrl.trim();
        const trimmedEndpoint = draftEndpoint.trim();
        const trimmedHistoryEndpoint = draftHistoryEndpoint.trim();
        const trimmedActivitySeriesEndpoint = draftActivitySeriesEndpoint.trim();
        const trimmedSnapshotExportEndpoint = draftSnapshotExportEndpoint.trim();
        const parsedSnapshotExportIntervalMs = Number.parseInt(draftSnapshotExportIntervalMs, 10);

        if (trimmed) {
            saveDataBaseUrl(trimmed);
        } else {
            clearDataBaseUrl();
        }

        if (trimmedEndpoint) {
            saveDataEndpoint(trimmedEndpoint);
        } else {
            clearDataEndpoint();
        }

        if (trimmedHistoryEndpoint) {
            saveDataHistoryEndpoint(trimmedHistoryEndpoint);
        } else {
            clearDataHistoryEndpoint();
        }

        saveDataActivitySeriesEndpoint(trimmedActivitySeriesEndpoint);
        saveDataSnapshotExportEnabledSetting(draftSnapshotExportEnabled);
        saveDataSnapshotExportEndpoint(trimmedSnapshotExportEndpoint);
        saveDataSnapshotExportIntervalMs(parsedSnapshotExportIntervalMs);

        queryClient.invalidateQueries({ queryKey: DATA_OVERVIEW_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: DATA_HISTORY_QUERY_KEY_PREFIX });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_SERIES_QUERY_KEY_PREFIX });
        onStatusChange?.(true);
        onDirtyChange?.(false);
    }, [draftActivitySeriesEndpoint, draftEndpoint, draftHistoryEndpoint, draftSnapshotExportEnabled, draftSnapshotExportEndpoint, draftSnapshotExportIntervalMs, draftUrl, onDirtyChange, onStatusChange, queryClient]);

    const handleClear = useCallback(() => {
        clearDataBaseUrl();
        clearDataEndpoint();
        clearDataHistoryEndpoint();
        clearDataActivitySeriesEndpoint();
        clearDataSnapshotExportEnabledSetting();
        clearDataSnapshotExportEndpoint();
        clearDataSnapshotExportIntervalMs();
        saveDataSnapshotExportEnabledSetting(false);
        saveDataSnapshotExportEndpoint('');
        setDraftUrl('');
        setDraftEndpoint(DATA_DEFAULT_ENDPOINT);
        setDraftHistoryEndpoint(DATA_DEFAULT_HISTORY_ENDPOINT);
        setDraftActivitySeriesEndpoint(DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT);
        setDraftSnapshotExportEnabled(false);
        setDraftSnapshotExportEndpoint('');
        setDraftSnapshotExportIntervalMs(String(DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS));
        queryClient.invalidateQueries({ queryKey: DATA_OVERVIEW_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: DATA_HISTORY_QUERY_KEY_PREFIX });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_SERIES_QUERY_KEY_PREFIX });
        onStatusChange?.(true);
        onDirtyChange?.(false);
    }, [onDirtyChange, onStatusChange, queryClient]);

    useEffect(() => {
        if (!saveRef) {
            return;
        }

        saveRef.current = handleSave;

        return () => {
            if (saveRef.current === handleSave) {
                saveRef.current = null;
            }
        };
    }, [handleSave, saveRef]);

    return (
        <div className="space-y-4">
            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    URL Base de Node-RED
                </label>
                <input
                    aria-label="URL Base de Node-RED"
                    value={draftUrl}
                    onChange={(e) => {
                        setDraftUrl(e.target.value);
                        onDirtyChange?.(true);
                    }}
                    placeholder="https://node-red.example.local"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    URL base del servidor Node-RED. Dejar vacio para deshabilitar.
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Snapshot
                </label>
                <input
                    aria-label="Endpoint Snapshot"
                    value={draftEndpoint}
                    onChange={(e) => {
                        setDraftEndpoint(e.target.value);
                        onDirtyChange?.(true);
                    }}
                    placeholder="/api/hmi-data"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Histórico
                </label>
                <input
                    aria-label="Endpoint Histórico"
                    value={draftHistoryEndpoint}
                    onChange={(e) => {
                        setDraftHistoryEndpoint(e.target.value);
                        onDirtyChange?.(true);
                    }}
                    placeholder="/api/hmi-data/history"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint de datos históricos. Dejar vacío para deshabilitar.
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 flex w-auto items-center gap-2`}>
                    <input
                        aria-label="Habilitar exportación automática del snapshot actual"
                        type="checkbox"
                        checked={draftSnapshotExportEnabled}
                        onChange={(e) => {
                            setDraftSnapshotExportEnabled(e.target.checked);
                            onDirtyChange?.(true);
                        }}
                    />
                    Exportación automática del snapshot actual habilitada
                </label>
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Desactivarla guarda `enabled=false` para evitar reactivaciones implícitas al limpiar la URL.
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Export Snapshot Actual
                </label>
                <input
                    aria-label="Endpoint Export Snapshot Actual"
                    value={draftSnapshotExportEndpoint}
                    onChange={(e) => {
                        setDraftSnapshotExportEndpoint(e.target.value);
                        onDirtyChange?.(true);
                    }}
                    placeholder="/hmi/current-snapshot"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint de exportación automática del dashboard actual. Ej.: `/hmi/current-snapshot`. Dejar vacío para deshabilitar.
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Intervalo Export Snapshot Actual (ms)
                </label>
                <input
                    aria-label="Intervalo Export Snapshot Actual (ms)"
                    type="number"
                    min={DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS}
                    step={1_000}
                    value={draftSnapshotExportIntervalMs}
                    onChange={(e) => {
                        setDraftSnapshotExportIntervalMs(e.target.value);
                        onDirtyChange?.(true);
                    }}
                    placeholder={String(DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS)}
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Mínimo {DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS} ms. Vacío o inválido vuelve al default de {DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS} ms.
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Activity-Series
                </label>
                <input
                    aria-label="Endpoint Activity-Series"
                    value={draftActivitySeriesEndpoint}
                    onChange={(e) => {
                        setDraftActivitySeriesEndpoint(e.target.value);
                        onDirtyChange?.(true);
                    }}
                    placeholder="/api/hmi-data/activity-series"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint de activity-series. Dejar vacío para deshabilitar.
                </p>
            </div>

            <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <div>
                    <p className="uppercase text-industrial-muted">
                        URL Snapshot
                    </p>
                    <p className="mt-0.5 break-all text-white/70">
                        {previewSnapshotUrl ?? 'Sin URL base configurada'}
                    </p>
                </div>
                <div className="mt-3">
                    <p className="uppercase text-industrial-muted">
                        URL Histórico
                    </p>
                    <p className="mt-0.5 break-all text-white/70">
                        {previewHistoryUrl}
                    </p>
                </div>
                <div className="mt-3">
                    <p className="uppercase text-industrial-muted">
                        URL EXPORT SNAPSHOT ACTUAL
                    </p>
                    <p className="mt-0.5 break-all text-white/70">
                        {!draftSnapshotExportEnabled ? 'Deshabilitado' : previewSnapshotExportUrl}
                    </p>
                    <p className="mt-1 text-white/50">
                        Intervalo: {draftSnapshotExportIntervalMs || String(DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS)} ms
                    </p>
                </div>
                <div className="mt-3">
                    <p className="uppercase text-industrial-muted">
                        URL ACTIVITY-SERIES
                    </p>
                    <p className="mt-0.5 break-all text-white/70">
                        {previewActivitySeriesUrl}
                    </p>
                </div>
            </div>

            <div>
                <AdminActionButton variant="secondary" onClick={handleClear}>
                    Limpiar URL guardada
                </AdminActionButton>
            </div>
        </div>
    );
}
