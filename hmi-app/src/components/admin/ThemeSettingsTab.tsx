import { useEffect, useMemo, useRef, useState } from 'react';
import {
    applyThemeStyleToDocument,
    CLASSIC_THEME_STYLE_ID,
    OUTLINE_THEME_STYLE_ID,
    previewThemeStyleOnDocument,
    readStoredThemeStylePresetId,
    setActiveThemeStyle,
    THEME_STYLE_PRESETS,
} from '../../services/themeStyle.service';
import { ADMIN_SIDEBAR_HINT_CLS, ADMIN_SIDEBAR_SECTION_CLS } from './adminSidebarStyles';
import type { SaveStatus } from './saveStatus';

// Presentational copy for the built-in presets (`themeStyle.service`'s
// `THEME_STYLE_PRESETS` only carries visual tokens, no UI text). Spanish,
// usted register, one line each. Keyed by the service's own id constants so
// a renamed/added preset id can never silently fall through to a blank
// description.
const THEME_PRESET_COPY: Record<string, { name: string; description: string }> = {
    [CLASSIC_THEME_STYLE_ID]: {
        name: 'Clásico',
        description: 'El estilo actual: marcos con efecto vidrio y brillo suave en los bordes.',
    },
    [OUTLINE_THEME_STYLE_ID]: {
        name: 'Contorno',
        description: 'Bordes finos y relleno transparente para los marcos de widgets y botones.',
    },
};

function getPresetCopy(id: string): { name: string; description: string } {
    return THEME_PRESET_COPY[id] ?? { name: id, description: '' };
}

interface ThemeSettingsTabProps {
    onDirtyChange?: (dirty: boolean) => void;
    onSaveStatusChange?: (status: SaveStatus) => void;
    saveRef?: { current: (() => void) | null };
    revertRef?: { current: (() => void) | null };
}

export default function ThemeSettingsTab({ onDirtyChange, onSaveStatusChange, saveRef, revertRef }: ThemeSettingsTabProps) {
    const initialId = useMemo(() => readStoredThemeStylePresetId() ?? CLASSIC_THEME_STYLE_ID, []);
    const [selectedId, setSelectedId] = useState(initialId);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
    // The persisted id at mount / after the last save, so Descartar restores
    // exactly that instead of always falling back to Clasico.
    const snapshotIdRef = useRef(initialId);
    const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    useEffect(() => {
        onSaveStatusChange?.(saveStatus);
    }, [onSaveStatusChange, saveStatus]);

    // Each card gets the full preset applied on its own DOM node (scoped
    // custom properties, per `applyThemeStyleToDocument`'s `target` param),
    // so its mini frame/button preview always shows that preset's real look
    // regardless of which theme is currently live on the rest of the app.
    useEffect(() => {
        for (const preset of THEME_STYLE_PRESETS) {
            const cardEl = cardRefs.current[preset.id];
            if (cardEl) {
                applyThemeStyleToDocument(preset, cardEl);
            }
        }
    }, []);

    const handleSelect = (id: string) => {
        if (id === selectedId) {
            return;
        }

        setSelectedId(id);
        previewThemeStyleOnDocument(id);
        setSaveStatus('dirty');
        onDirtyChange?.(true);
    };

    useEffect(() => {
        if (!saveRef) {
            return;
        }

        saveRef.current = () => {
            setActiveThemeStyle(selectedId);
            snapshotIdRef.current = selectedId;
            setSaveStatus('saved');
            onDirtyChange?.(false);
        };

        return () => {
            saveRef.current = null;
        };
    }, [onDirtyChange, saveRef, selectedId]);

    useEffect(() => {
        if (!revertRef) {
            return;
        }

        revertRef.current = () => {
            const snapshotId = snapshotIdRef.current;
            setSelectedId(snapshotId);
            previewThemeStyleOnDocument(snapshotId);
            // The revert only restores state and document styles without
            // touching storage, so it reports no status: a persistence that
            // did not happen must not be claimed as `Guardado`.
            setSaveStatus(null);
            onDirtyChange?.(false);
        };

        return () => {
            revertRef.current = null;
        };
    }, [onDirtyChange, revertRef]);

    return (
        <div className="space-y-4">
            <header>
                <h4 className="uppercase text-white">Tema</h4>
                <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Elija el estilo visual de los marcos de widgets y botones de la interfaz.
                </p>
            </header>

            <div role="radiogroup" aria-label="Tema" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {THEME_STYLE_PRESETS.map((preset) => {
                    const copy = getPresetCopy(preset.id);
                    const isSelected = preset.id === selectedId;

                    return (
                        <button
                            key={preset.id}
                            ref={(el) => { cardRefs.current[preset.id] = el; }}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            aria-label={copy.name}
                            onClick={() => handleSelect(preset.id)}
                            className={[
                                ADMIN_SIDEBAR_SECTION_CLS,
                                'flex flex-col gap-3 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/40',
                                isSelected ? 'border-admin-accent/60 bg-admin-accent/5' : 'hover:border-white/20',
                            ].join(' ')}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="uppercase text-white">{copy.name}</span>
                                <span
                                    aria-hidden="true"
                                    className={[
                                        'h-3 w-3 shrink-0 rounded-full border',
                                        isSelected ? 'border-admin-accent bg-admin-accent' : 'border-white/30',
                                    ].join(' ')}
                                />
                            </div>

                            <p className={ADMIN_SIDEBAR_HINT_CLS}>{copy.description}</p>

                            <div aria-hidden="true" className="glass-panel flex items-center justify-center p-3">
                                <span className="theme-button admin-accent-ghost inline-flex items-center px-3 py-1 uppercase pointer-events-none">
                                    Vista previa
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
