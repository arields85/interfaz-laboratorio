import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import AdminActionButton from './AdminActionButton';
import CopyValueButton from './CopyValueButton';
import { ADMIN_SIDEBAR_LABEL_CLS, ADMIN_SIDEBAR_INPUT_CLS, ADMIN_SIDEBAR_HINT_CLS } from './adminSidebarStyles';
import type { SaveStatus } from './saveStatus';
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
import {
    buildDataConnectionExport,
    parseDataConnectionFile,
} from '../../utils/dataConnectionPortability';
import { validateDataConnectionValues } from '../../utils/dataConnectionValidation';
import { downloadJsonFile } from '../../utils/portableFile';
import { DATA_OVERVIEW_QUERY_KEY } from '../../queries/useDataOverview';
import { ACTIVITY_SERIES_QUERY_KEY_PREFIX } from '../../queries/useActivitySeries';
import { DATA_HISTORY_QUERY_KEY_PREFIX } from '../../queries/useDataHistory';

// =============================================================================
// ConnectionSettingsTab
// Contenido extraído de NodeRedSettingsDialog — configura URL base y endpoints.
// =============================================================================

const COPY_FEEDBACK_MS = 1_500;
const COPY_FAILURE_MESSAGE = 'No pudimos copiar al portapapeles.';

type CopyFieldId = 'baseUrl' | 'endpoint' | 'historyEndpoint' | 'activitySeriesEndpoint';

const COPY_FIELD_TEXT: Record<CopyFieldId, { label: string; success: string }> = {
    baseUrl: { label: 'Copiar URL base', success: 'URL base copiada.' },
    endpoint: { label: 'Copiar endpoint snapshot', success: 'Endpoint snapshot copiado.' },
    historyEndpoint: { label: 'Copiar endpoint histórico', success: 'Endpoint histórico copiado.' },
    activitySeriesEndpoint: { label: 'Copiar endpoint activity-series', success: 'Endpoint activity-series copiado.' },
};

interface PortabilityFeedback {
    kind: 'success' | 'error';
    message: string;
}

interface ConnectionSettingsTabProps {
    onDirtyChange?: (dirty: boolean) => void;
    onSaveStatusChange?: (status: SaveStatus) => void;
    saveRef?: { current: (() => void) | null };
}

export default function ConnectionSettingsTab({ onDirtyChange, onSaveStatusChange, saveRef }: ConnectionSettingsTabProps) {
    const queryClient = useQueryClient();
    const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
    const [draftUrl, setDraftUrl] = useState(() => getSavedDataBaseUrl() || (getDataBaseUrl() ?? ''));
    const [draftEndpoint, setDraftEndpoint] = useState(() => getSavedDataEndpoint() || DATA_DEFAULT_ENDPOINT);
    const [draftHistoryEndpoint, setDraftHistoryEndpoint] = useState(() => getSavedDataHistoryEndpoint() || DATA_DEFAULT_HISTORY_ENDPOINT);
    const [draftActivitySeriesEndpoint, setDraftActivitySeriesEndpoint] = useState(() => getSavedDataActivitySeriesEndpoint() ?? DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT);

    const [copiedField, setCopiedField] = useState<CopyFieldId | null>(null);
    const [copyFailed, setCopyFailed] = useState(false);
    const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (copyResetTimerRef.current !== null) {
            clearTimeout(copyResetTimerRef.current);
        }
    }, []);

    const handleCopy = useCallback(async (field: CopyFieldId, value: string) => {
        if (copyResetTimerRef.current !== null) {
            clearTimeout(copyResetTimerRef.current);
            copyResetTimerRef.current = null;
        }

        try {
            await navigator.clipboard.writeText(value);
        } catch {
            setCopiedField(null);
            setCopyFailed(true);
            return;
        }

        setCopyFailed(false);
        setCopiedField(field);
        copyResetTimerRef.current = setTimeout(() => {
            setCopiedField(null);
            copyResetTimerRef.current = null;
        }, COPY_FEEDBACK_MS);
    }, []);

    const copyStatusMessage = copyFailed
        ? COPY_FAILURE_MESSAGE
        : copiedField ? COPY_FIELD_TEXT[copiedField].success : '';

    const [portabilityFeedback, setPortabilityFeedback] = useState<PortabilityFeedback | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    const handleExport = useCallback(() => {
        // Exports the current form values (including unsaved edits), so the file
        // matches what the user sees; the UI states this next to the button.
        const validation = validateDataConnectionValues({
            baseUrl: draftUrl,
            endpoint: draftEndpoint,
            historyEndpoint: draftHistoryEndpoint,
            activitySeriesEndpoint: draftActivitySeriesEndpoint,
        });

        if (!validation.ok) {
            setPortabilityFeedback({ kind: 'error', message: `No se puede exportar: ${validation.message}` });
            return;
        }

        const { fileName, json } = buildDataConnectionExport(validation.values);
        downloadJsonFile(fileName, json);
        setPortabilityFeedback(null);
    }, [draftActivitySeriesEndpoint, draftEndpoint, draftHistoryEndpoint, draftUrl]);

    const handleImportFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.target;
        const file = input.files?.[0];

        if (!file) {
            return;
        }

        try {
            const result = parseDataConnectionFile(await file.text());

            if (!result.ok) {
                setPortabilityFeedback({ kind: 'error', message: `No pudimos importar el archivo: ${result.message}` });
                return;
            }

            // Fill the form only: the user reviews the values and presses Guardar.
            setDraftUrl(result.values.baseUrl);
            setDraftEndpoint(result.values.endpoint);
            setDraftHistoryEndpoint(result.values.historyEndpoint);
            setDraftActivitySeriesEndpoint(result.values.activitySeriesEndpoint);
            onDirtyChange?.(true);
            setSaveStatus('dirty');
            setPortabilityFeedback({
                kind: 'success',
                message: 'Valores importados. Revíselos y presione Guardar para aplicarlos.',
            });
        } catch {
            setPortabilityFeedback({ kind: 'error', message: 'No pudimos importar el archivo: no se pudo leer.' });
        } finally {
            input.value = '';
        }
    }, [onDirtyChange]);

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

    useEffect(() => {
        onSaveStatusChange?.(saveStatus);
    }, [onSaveStatusChange, saveStatus]);

    const handleSave = useCallback(() => {
        const trimmed = draftUrl.trim();
        const trimmedEndpoint = draftEndpoint.trim();
        const trimmedHistoryEndpoint = draftHistoryEndpoint.trim();
        const trimmedActivitySeriesEndpoint = draftActivitySeriesEndpoint.trim();

        // The dialog's save-ref contract is fire-and-forget: the save status is
        // the user-visible channel, so a thrown persistence failure is reported
        // as `error` instead of being rethrown. Note that a mid-way failure is
        // a partial save: some values may have persisted while the status
        // reports the failure.
        try {
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

            setSaveStatus('saved');
            onDirtyChange?.(false);
        } catch {
            setSaveStatus('error');
        }
    }, [draftActivitySeriesEndpoint, draftEndpoint, draftHistoryEndpoint, draftUrl, onDirtyChange, queryClient]);

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
        onDirtyChange?.(false);
    }, [onDirtyChange, queryClient]);

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
                <div className="flex items-center gap-2">
                    <input
                        aria-label="URL Base de Node-RED"
                        value={draftUrl}
                        onChange={(e) => {
                            setDraftUrl(e.target.value);
                            onDirtyChange?.(true);
                            setSaveStatus('dirty');
                        }}
                        placeholder="https://node-red.example.local"
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} min-w-0 flex-1 px-3 py-2`}
                    />
                    <CopyValueButton
                        label={COPY_FIELD_TEXT.baseUrl.label}
                        copied={copiedField === 'baseUrl'}
                        onCopy={() => void handleCopy('baseUrl', draftUrl)}
                    />
                </div>
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    URL base del servidor Node-RED. Dejar vacio para deshabilitar.
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Snapshot
                </label>
                <div className="flex items-center gap-2">
                    <input
                        aria-label="Endpoint Snapshot"
                        value={draftEndpoint}
                        onChange={(e) => {
                            setDraftEndpoint(e.target.value);
                            onDirtyChange?.(true);
                            setSaveStatus('dirty');
                        }}
                        placeholder="/api/hmi-data"
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} min-w-0 flex-1 px-3 py-2`}
                    />
                    <CopyValueButton
                        label={COPY_FIELD_TEXT.endpoint.label}
                        copied={copiedField === 'endpoint'}
                        onCopy={() => void handleCopy('endpoint', draftEndpoint)}
                    />
                </div>
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Histórico
                </label>
                <div className="flex items-center gap-2">
                    <input
                        aria-label="Endpoint Histórico"
                        value={draftHistoryEndpoint}
                        onChange={(e) => {
                            setDraftHistoryEndpoint(e.target.value);
                            onDirtyChange?.(true);
                            setSaveStatus('dirty');
                        }}
                        placeholder="/api/hmi-data/history"
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} min-w-0 flex-1 px-3 py-2`}
                    />
                    <CopyValueButton
                        label={COPY_FIELD_TEXT.historyEndpoint.label}
                        copied={copiedField === 'historyEndpoint'}
                        onCopy={() => void handleCopy('historyEndpoint', draftHistoryEndpoint)}
                    />
                </div>
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint de datos históricos. Dejar vacío para deshabilitar.
                </p>
            </div>

            <div>
                <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Activity-Series
                </label>
                <div className="flex items-center gap-2">
                    <input
                        aria-label="Endpoint Activity-Series"
                        value={draftActivitySeriesEndpoint}
                        onChange={(e) => {
                            setDraftActivitySeriesEndpoint(e.target.value);
                            onDirtyChange?.(true);
                            setSaveStatus('dirty');
                        }}
                        placeholder="/api/hmi-data/activity-series"
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} min-w-0 flex-1 px-3 py-2`}
                    />
                    <CopyValueButton
                        label={COPY_FIELD_TEXT.activitySeriesEndpoint.label}
                        copied={copiedField === 'activitySeriesEndpoint'}
                        onCopy={() => void handleCopy('activitySeriesEndpoint', draftActivitySeriesEndpoint)}
                    />
                </div>
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

            <p role="status" aria-live="polite" className={copyFailed ? 'text-status-critical' : 'text-industrial-muted'}>
                {copyStatusMessage}
            </p>

            <div className="flex flex-wrap items-center gap-2">
                <AdminActionButton variant="secondary" onClick={handleClear}>
                    Limpiar URL guardada
                </AdminActionButton>
                <AdminActionButton variant="secondary" onClick={handleExport}>
                    <Upload size={14} />
                    Exportar
                </AdminActionButton>
                <AdminActionButton variant="secondary" onClick={() => importInputRef.current?.click()}>
                    <Download size={14} />
                    Importar
                </AdminActionButton>
                <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    aria-label="Seleccionar archivo de conexión"
                    onChange={(event) => void handleImportFileChange(event)}
                />
            </div>
            <p className={ADMIN_SIDEBAR_HINT_CLS}>
                Exportar guarda en un archivo los valores actuales del formulario, aunque todavía no estén guardados.
                Importar completa el formulario sin guardar.
            </p>
            <div aria-live="polite">
                {portabilityFeedback && (
                    <p
                        role={portabilityFeedback.kind === 'error' ? 'alert' : undefined}
                        className={portabilityFeedback.kind === 'error' ? 'text-status-critical' : 'text-industrial-muted'}
                    >
                        {portabilityFeedback.message}
                    </p>
                )}
            </div>
        </div>
    );
}
