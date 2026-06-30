import { useRef, useState, type ChangeEvent } from 'react';
import { Download, Upload, X } from 'lucide-react';
import BackgroundSettingsTab from '../admin/BackgroundSettingsTab';
import {
    createShaderPortableConfigFile,
    parseShaderPortableConfigFile,
    useShaderParamsStore,
} from '../../store/shaderParams.store';

interface ShaderSettingsPanelProps {
    open: boolean;
    onClose: () => void;
}

export default function ShaderSettingsPanel({ open, onClose }: ShaderSettingsPanelProps) {
    const params = useShaderParamsStore((state) => state.params);
    const blendModes = useShaderParamsStore((state) => state.blendModes);
    const replaceAll = useShaderParamsStore((state) => state.replaceAll);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const [importFeedback, setImportFeedback] = useState<{
        severity: 'success' | 'error';
        message: string;
    } | null>(null);

    const handleExport = () => {
        const portableConfig = createShaderPortableConfigFile({ params, blendModes });
        const downloadUrl = URL.createObjectURL(
            new Blob([JSON.stringify(portableConfig, null, 2)], { type: 'application/json' }),
        );

        try {
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = 'hmi-background-config.json';
            link.click();
        } finally {
            URL.revokeObjectURL(downloadUrl);
        }
    };

    const handleImportClick = () => {
        importInputRef.current?.click();
    };

    const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        try {
            const parsedJson = JSON.parse(await file.text()) as unknown;
            const importedConfig = parseShaderPortableConfigFile(parsedJson);

            if (!importedConfig) {
                setImportFeedback({
                    severity: 'error',
                    message: 'ARCHIVO DE FONDO INVALIDO',
                });
                return;
            }

            replaceAll(importedConfig);
            setImportFeedback({
                severity: 'success',
                message: 'CONFIGURACION IMPORTADA',
            });
        } catch {
            setImportFeedback({
                severity: 'error',
                message: 'NO SE PUDO LEER EL JSON',
            });
        }
    };

    if (!open) return null;

    return (
        <div
            data-shader-panel
            className="fixed top-16 right-4 z-50 w-80 max-h-[calc(100vh-5rem)] overflow-hidden rounded-xl border border-industrial-border bg-industrial-surface/90 shadow-2xl backdrop-blur-xl flex flex-col"
        >
            <div className="shrink-0 flex items-center justify-between border-b border-industrial-border bg-industrial-surface/95 px-4 py-3 backdrop-blur-sm">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="uppercase text-industrial-muted">
                        Configuracion de Fondo
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            aria-label="Exportar configuración de fondo"
                            onClick={handleExport}
                            className="rounded p-1 text-industrial-muted transition-colors hover:bg-white/10 hover:text-white"
                            title="Exportar configuración de fondo"
                        >
                            <Upload size={14} />
                        </button>
                        <button
                            type="button"
                            aria-label="Importar configuración de fondo"
                            onClick={handleImportClick}
                            className="rounded p-1 text-industrial-muted transition-colors hover:bg-white/10 hover:text-white"
                            title="Importar configuración de fondo"
                        >
                            <Download size={14} />
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(event) => {
                            void handleImportChange(event);
                        }}
                    />
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded p-1 text-industrial-muted transition-colors hover:text-white hover:bg-white/10"
                        title="Cerrar panel"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {importFeedback && (
                <div
                    role="status"
                    className={`shrink-0 border-b px-4 py-2 text-[11px] uppercase tracking-[0.08em] ${
                        importFeedback.severity === 'error'
                            ? 'border-industrial-border text-industrial-muted'
                            : 'border-admin-accent/30 text-admin-accent'
                    }`}
                >
                    {importFeedback.message}
                </div>
            )}

            <div className="hmi-scrollbar flex-1 overflow-y-auto p-3">
                <BackgroundSettingsTab />
            </div>
        </div>
    );
}
