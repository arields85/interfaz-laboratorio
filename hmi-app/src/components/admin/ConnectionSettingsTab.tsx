import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AdminActionButton from './AdminActionButton';
import { ADMIN_SIDEBAR_LABEL_CLS, ADMIN_SIDEBAR_INPUT_CLS, ADMIN_SIDEBAR_HINT_CLS } from './adminSidebarStyles';
import {
    DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT,
    DATA_DEFAULT_ENDPOINT,
    DATA_DEFAULT_HISTORY_ENDPOINT,
    clearDataActivitySeriesEndpoint,
    clearDataEndpoint,
    clearDataHistoryEndpoint,
    getDataBaseUrl,
    getSavedDataActivitySeriesEndpoint,
    getSavedDataEndpoint,
    getSavedDataBaseUrl,
    getSavedDataHistoryEndpoint,
    clearDataBaseUrl,
    saveDataBaseUrl,
    saveDataActivitySeriesEndpoint,
    saveDataEndpoint,
    saveDataHistoryEndpoint,
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

    const handleSave = useCallback(() => {
        const trimmed = draftUrl.trim();
        const trimmedEndpoint = draftEndpoint.trim();
        const trimmedHistoryEndpoint = draftHistoryEndpoint.trim();
        const trimmedActivitySeriesEndpoint = draftActivitySeriesEndpoint.trim();

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

        queryClient.invalidateQueries({ queryKey: DATA_OVERVIEW_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: DATA_HISTORY_QUERY_KEY_PREFIX });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_SERIES_QUERY_KEY_PREFIX });
        onStatusChange?.(true);
        onDirtyChange?.(false);
    }, [draftActivitySeriesEndpoint, draftEndpoint, draftHistoryEndpoint, draftUrl, onDirtyChange, onStatusChange, queryClient]);

    const handleClear = useCallback(() => {
        clearDataBaseUrl();
        clearDataEndpoint();
        clearDataHistoryEndpoint();
        clearDataActivitySeriesEndpoint();
        setDraftUrl('');
        setDraftEndpoint(DATA_DEFAULT_ENDPOINT);
        setDraftHistoryEndpoint(DATA_DEFAULT_HISTORY_ENDPOINT);
        setDraftActivitySeriesEndpoint(DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT);
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
                    placeholder="https://192.168.50.250:51880"
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
