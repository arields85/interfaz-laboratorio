import { useEffect, useMemo, useRef, useState } from 'react';
import {
    applyThemeStyleToDocument,
    CLASSIC_THEME_STYLE_ID,
    INSTRUMENT_THEME_STYLE_ID,
    OUTLINE_THEME_STYLE_ID,
    previewThemeStyleOnDocument,
    readStoredThemeStylePresetId,
    setActiveThemeStyle,
    THEME_STYLE_PRESETS,
} from '../../services/themeStyle.service';
import {
    applyViewerEntranceSettingsToDocument,
    readStoredViewerEntranceSettings,
    VIEWER_ENTRANCE_LIMITS,
    writeStoredViewerEntranceSettings,
} from '../../services/viewerEntranceStyle.service';
import type { ViewerEntranceSettings } from '../../domain/viewerEntrance.types';
import type { FrameShape } from '../../domain/frameShape.types';
import {
    previewFrameShape,
    readStoredFrameShape,
    writeStoredFrameShape,
} from '../../services/frameShape.service';
import DockSliderField from './DockSliderField';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';
import type { SaveStatus } from './saveStatus';

// Presentational copy for the built-in presets (`themeStyle.service`'s
// `THEME_STYLE_PRESETS` only carries visual tokens, no UI text). Spanish,
// usted register, one line each. Keyed by the service's own id constants
// (not literal strings) so a rename shows up as a stale/missing key here
// instead of silently drifting; a genuinely new preset without a matching
// entry still falls back to `getPresetCopy`'s raw-id/blank-description
// default below.
const THEME_PRESET_COPY: Record<string, { name: string; description: string }> = {
    [CLASSIC_THEME_STYLE_ID]: {
        name: 'Clásico',
        description: 'El estilo actual: marcos con efecto vidrio y brillo suave en los bordes.',
    },
    [OUTLINE_THEME_STYLE_ID]: {
        name: 'Contorno',
        description: 'Bordes finos y relleno transparente para los marcos de widgets y botones.',
    },
    [INSTRUMENT_THEME_STYLE_ID]: {
        name: 'Instrumento',
        description: 'Vidrio sobrio con esquinas apenas redondeadas y detalles finos, como un tablero de medición.',
    },
};

interface EntranceControlCopy {
    key: keyof ViewerEntranceSettings;
    label: string;
    numberInputAriaLabel: string;
    unit: string;
}

// Spanish, usted register. Labels double as the sliders' accessible names.
const ENTRANCE_CONTROLS: readonly EntranceControlCopy[] = [
    { key: 'outlineWidthPx', label: 'Grosor del contorno', numberInputAriaLabel: 'Valor de grosor del contorno', unit: 'px' },
    { key: 'outlineOpacityPercent', label: 'Opacidad del contorno', numberInputAriaLabel: 'Valor de opacidad del contorno', unit: '%' },
    { key: 'flashIntensityPercent', label: 'Intensidad del destello', numberInputAriaLabel: 'Valor de intensidad del destello', unit: '%' },
];

interface FrameShapeCopy {
    value: FrameShape;
    name: string;
    description: string;
}

// Spanish, usted register. The names double as the radios' accessible names.
const FRAME_SHAPE_OPTIONS: readonly FrameShapeCopy[] = [
    {
        value: 'standard',
        name: 'Estándar',
        description: 'El marco redondeado de siempre, con el título dentro del widget.',
    },
    {
        value: 'tab',
        name: 'Pestaña',
        description: 'El título pasa a una pestaña sobre el marco y la esquina superior derecha se recorta, con el ícono en el corte.',
    },
];

function areEntranceSettingsEqual(a: ViewerEntranceSettings, b: ViewerEntranceSettings): boolean {
    return ENTRANCE_CONTROLS.every(({ key }) => a[key] === b[key]);
}

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
    const initialEntrance = useMemo(() => readStoredViewerEntranceSettings(), []);
    const [entrance, setEntrance] = useState<ViewerEntranceSettings>(initialEntrance);
    const initialShape = useMemo(() => readStoredFrameShape(), []);
    const [shape, setShape] = useState<FrameShape>(initialShape);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
    // The persisted id at mount / after the last save, so Descartar restores
    // exactly that instead of always falling back to Clasico.
    const snapshotIdRef = useRef(initialId);
    const snapshotEntranceRef = useRef(initialEntrance);
    const snapshotShapeRef = useRef(initialShape);
    // Mirrors whether the current selection differs from `snapshotIdRef`,
    // updated synchronously alongside every state change below (select,
    // save, revert) so the unmount cleanup can read it without waiting for
    // an effect to catch up with the latest render.
    const dirtyRef = useRef(false);
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

    // Selecting a theme or a value different from the saved one is dirty;
    // returning to the saved configuration is a not-dirty clear, not a
    // persisted `Guardado` -- nothing was written to storage.
    const isDifferentFromSnapshot = (next: {
        id: string;
        entrance: ViewerEntranceSettings;
        shape: FrameShape;
    }) => next.id !== snapshotIdRef.current
        || !areEntranceSettingsEqual(next.entrance, snapshotEntranceRef.current)
        || next.shape !== snapshotShapeRef.current;

    const syncDirty = (isDirty: boolean) => {
        dirtyRef.current = isDirty;
        setSaveStatus(isDirty ? 'dirty' : null);
        onDirtyChange?.(isDirty);
    };

    const handleSelect = (id: string) => {
        if (id === selectedId) {
            return;
        }

        setSelectedId(id);
        previewThemeStyleOnDocument(id);

        syncDirty(isDifferentFromSnapshot({ id, entrance, shape }));
    };

    // The shape is previewed on the whole document like a theme card: every framed widget of the
    // dashboard grid reads it through `useFrameShape`.
    const handleShapeSelect = (next: FrameShape) => {
        if (next === shape) {
            return;
        }

        setShape(next);
        previewFrameShape(next);
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance, shape: next }));
    };

    // Moving a slider previews the value on the whole document right away
    // (the viewer reads the `--viewer-entrance-*` tokens), like a theme card.
    const handleEntranceChange = (key: keyof ViewerEntranceSettings, value: number) => {
        const next = { ...entrance, [key]: value };
        if (next[key] === entrance[key]) {
            return;
        }

        setEntrance(next);
        applyViewerEntranceSettingsToDocument(next);
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance: next, shape }));
    };

    // If the tab unmounts (dialog closed/unmounted) while an unsaved
    // selection is still being previewed on the whole document, the preview
    // must not leak past the tab's lifetime: restore the last saved theme.
    // `dirtyRef` is updated synchronously by every handler below (select,
    // save, revert), so after an explicit save or revert it is already
    // false and this never double-applies on top of that outcome.
    useEffect(() => {
        return () => {
            if (dirtyRef.current) {
                previewThemeStyleOnDocument(snapshotIdRef.current);
                applyViewerEntranceSettingsToDocument(snapshotEntranceRef.current);
                previewFrameShape(snapshotShapeRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!saveRef) {
            return;
        }

        saveRef.current = () => {
            setActiveThemeStyle(selectedId);
            writeStoredViewerEntranceSettings(entrance);
            applyViewerEntranceSettingsToDocument(entrance);
            writeStoredFrameShape(shape);
            previewFrameShape(shape);
            snapshotIdRef.current = selectedId;
            snapshotEntranceRef.current = entrance;
            snapshotShapeRef.current = shape;
            dirtyRef.current = false;
            setSaveStatus('saved');
            onDirtyChange?.(false);
        };

        return () => {
            saveRef.current = null;
        };
    }, [entrance, onDirtyChange, saveRef, selectedId, shape]);

    useEffect(() => {
        if (!revertRef) {
            return;
        }

        revertRef.current = () => {
            const snapshotId = snapshotIdRef.current;
            setSelectedId(snapshotId);
            previewThemeStyleOnDocument(snapshotId);
            setEntrance(snapshotEntranceRef.current);
            applyViewerEntranceSettingsToDocument(snapshotEntranceRef.current);
            setShape(snapshotShapeRef.current);
            previewFrameShape(snapshotShapeRef.current);
            dirtyRef.current = false;
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

            <section aria-labelledby="theme-shape-heading" className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div id="theme-shape-heading" className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Forma del marco
                </div>
                <p className={`mb-4 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Elija la forma de los marcos de los widgets del dashboard. Se combina con cualquier tema. Solo aplica
                    a los widgets con título; los gráficos con selector de período conservan el marco estándar.
                </p>

                <div role="radiogroup" aria-label="Forma del marco" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {FRAME_SHAPE_OPTIONS.map((option) => {
                        const isSelected = option.value === shape;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                aria-label={option.name}
                                onClick={() => handleShapeSelect(option.value)}
                                className={[
                                    ADMIN_SIDEBAR_SECTION_CLS,
                                    'flex flex-col gap-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/40',
                                    isSelected ? 'border-admin-accent/60 bg-admin-accent/5' : 'hover:border-white/20',
                                ].join(' ')}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="uppercase text-white">{option.name}</span>
                                    <span
                                        aria-hidden="true"
                                        className={[
                                            'h-3 w-3 shrink-0 rounded-full border',
                                            isSelected ? 'border-admin-accent bg-admin-accent' : 'border-white/30',
                                        ].join(' ')}
                                    />
                                </div>
                                <p className={ADMIN_SIDEBAR_HINT_CLS}>{option.description}</p>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section aria-labelledby="theme-entrance-heading" className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div id="theme-entrance-heading" className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Animación de entrada
                </div>
                <p className={`mb-4 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ajuste el contorno y el destello con que aparece cada marco al abrir un dashboard en el visor. Los
                    valores se aplican a todos los temas. Para previsualizarlos, cambie de dashboard o de vista en el visor.
                </p>

                {/* One control per row, like the other admin panels: in narrow columns the number input
                    covered the label. */}
                <div data-testid="theme-entrance-controls" className="flex flex-col gap-4">
                    {ENTRANCE_CONTROLS.map(({ key, label, numberInputAriaLabel, unit }) => (
                        <DockSliderField
                            key={key}
                            label={label}
                            ariaLabel={label}
                            numberInputAriaLabel={numberInputAriaLabel}
                            unit={unit}
                            value={entrance[key]}
                            {...VIEWER_ENTRANCE_LIMITS[key]}
                            onChange={(value) => handleEntranceChange(key, value)}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}
