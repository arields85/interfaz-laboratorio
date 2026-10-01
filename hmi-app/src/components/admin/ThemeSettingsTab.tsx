import { useEffect, useMemo, useRef, useState } from 'react';
import {
    applyThemeStyleToDocument,
    CLASSIC_THEME_STYLE_ID,
    FRAME_RADIUS_LIMITS,
    getThemeStylePreset,
    INSTRUMENT_THEME_STYLE_ID,
    OUTLINE_THEME_STYLE_ID,
    previewThemeStyleOnDocument,
    readStoredFrameRadiusOverrides,
    readStoredThemeStylePresetId,
    setActiveThemeStyle,
    THEME_STYLE_PRESETS,
    writeStoredFrameRadiusOverrides,
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
import {
    previewIconCutout,
    readStoredIconCutout,
    writeStoredIconCutout,
} from '../../services/iconCutout.service';
import {
    applyLinkAccentLengthsToDocument,
    LINK_ACCENT_LENGTH_LIMITS,
    previewLinkCornerAccents,
    readStoredLinkAccentLengths,
    readStoredLinkCornerAccents,
    writeStoredLinkAccentLengths,
    writeStoredLinkCornerAccents,
} from '../../services/linkCornerAccents.service';
import type { LinkAccentLengths } from '../../domain/linkCornerAccents.types';
import AdminActionButton from './AdminActionButton';
import DockSliderField from './DockSliderField';
import DockToggleField from './DockToggleField';
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

const ACCENT_LENGTH_CONTROLS: readonly { key: keyof LinkAccentLengths; label: string; numberInputAriaLabel: string }[] = [
    { key: 'restPx', label: 'Largo en reposo', numberInputAriaLabel: 'Valor de largo en reposo' },
    { key: 'hoverPx', label: 'Largo con el cursor', numberInputAriaLabel: 'Valor de largo con el cursor' },
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
        description: 'El título pasa a una pestaña sobre el marco; el ícono queda arriba a la derecha, en la franja de la pestaña.',
    },
];

type FrameRadiusOverrides = Readonly<Record<string, number>>;

function areRadiusOverridesEqual(a: FrameRadiusOverrides, b: FrameRadiusOverrides): boolean {
    const keys = Object.keys(a);

    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

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
    // Per-preset frame radius overrides (absent = the preset's own radius), edited as a whole so
    // every preset keeps its own adjusted value while the selection moves between them.
    const initialRadii = useMemo<FrameRadiusOverrides>(() => readStoredFrameRadiusOverrides(), []);
    const [radii, setRadii] = useState<FrameRadiusOverrides>(initialRadii);
    const initialCutout = useMemo(() => readStoredIconCutout(), []);
    const [cutout, setCutout] = useState(initialCutout);
    const initialLinkAccents = useMemo(() => readStoredLinkCornerAccents(), []);
    const [linkAccents, setLinkAccents] = useState(initialLinkAccents);
    const initialAccentLengths = useMemo(() => readStoredLinkAccentLengths(), []);
    const [accentLengths, setAccentLengths] = useState<LinkAccentLengths>(initialAccentLengths);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
    // The persisted id at mount / after the last save, so Descartar restores
    // exactly that instead of always falling back to Clasico.
    const snapshotIdRef = useRef(initialId);
    const snapshotEntranceRef = useRef(initialEntrance);
    const snapshotShapeRef = useRef(initialShape);
    const snapshotRadiiRef = useRef(initialRadii);
    const snapshotCutoutRef = useRef(initialCutout);
    const snapshotLinkAccentsRef = useRef(initialLinkAccents);
    const snapshotAccentLengthsRef = useRef(initialAccentLengths);
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
                const radiusPx = radii[preset.id];
                if (radiusPx !== undefined) {
                    applyThemeStyleToDocument({
                        ...preset,
                        frame: {
                            ...preset.frame,
                            rest: { ...preset.frame.rest, radiusPx },
                            hover: { ...preset.frame.hover, radiusPx },
                        },
                    }, cardEl);
                }
            }
        }
    }, [radii]);

    // Selecting a theme or a value different from the saved one is dirty;
    // returning to the saved configuration is a not-dirty clear, not a
    // persisted `Guardado` -- nothing was written to storage.
    const isDifferentFromSnapshot = (next: {
        id: string;
        entrance: ViewerEntranceSettings;
        shape: FrameShape;
        radii: FrameRadiusOverrides;
        cutout: boolean;
        linkAccents: boolean;
        accentLengths: LinkAccentLengths;
    }) => next.id !== snapshotIdRef.current
        || !areEntranceSettingsEqual(next.entrance, snapshotEntranceRef.current)
        || next.shape !== snapshotShapeRef.current
        || !areRadiusOverridesEqual(next.radii, snapshotRadiiRef.current)
        || next.cutout !== snapshotCutoutRef.current
        || next.linkAccents !== snapshotLinkAccentsRef.current
        || next.accentLengths.restPx !== snapshotAccentLengthsRef.current.restPx
        || next.accentLengths.hoverPx !== snapshotAccentLengthsRef.current.hoverPx;

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
        previewThemeStyleOnDocument(id, document.documentElement, radii[getThemeStylePreset(id).id]);

        syncDirty(isDifferentFromSnapshot({ id, entrance, shape, radii, cutout, linkAccents, accentLengths }));
    };

    // The shape is previewed on the whole document like a theme card: every framed widget of the
    // dashboard grid reads it through `useFrameShape`.
    const handleShapeSelect = (next: FrameShape) => {
        if (next === shape) {
            return;
        }

        setShape(next);
        previewFrameShape(next);
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance, shape: next, radii, cutout, linkAccents, accentLengths }));
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
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance: next, shape, radii, cutout, linkAccents, accentLengths }));
    };

    // The icon cutout is previewed on the whole document like the shape: framed widgets read it
    // through `useIconCutoutActive`.
    const handleCutoutChange = (next: boolean) => {
        if (next === cutout) {
            return;
        }

        setCutout(next);
        previewIconCutout(next);
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance, shape, radii, cutout: next, linkAccents, accentLengths }));
    };

    // The link corner accents are previewed on the whole document like the cutout: the viewer reads
    // them through `useLinkCornerAccentsActive`.
    const handleLinkAccentsChange = (next: boolean) => {
        if (next === linkAccents) {
            return;
        }

        setLinkAccents(next);
        previewLinkCornerAccents(next);
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance, shape, radii, cutout, linkAccents: next, accentLengths }));
    };

    // The lengths are previewed live on the document root (`--link-accent-length-rest` / `-hover`),
    // like the entrance sliders.
    const handleAccentLengthChange = (key: keyof LinkAccentLengths, value: number) => {
        const next = { ...accentLengths, [key]: value };
        if (next[key] === accentLengths[key]) {
            return;
        }

        setAccentLengths(next);
        applyLinkAccentLengthsToDocument(next);
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance, shape, radii, cutout, linkAccents, accentLengths: next }));
    };

    // The link corner accents show with Clasico (any frame shape); the section says so while the
    // selection is another preset.
    const linkAccentsApply = selectedId === CLASSIC_THEME_STYLE_ID;

    // The cutout only shows with Clasico and the Estandar shape (see `useIconCutoutActive`); the
    // section says so while the current selection makes it not apply.
    const cutoutApplies = selectedId === CLASSIC_THEME_STYLE_ID && shape === 'standard';

    // The radius belongs to the selected preset: a value equal to the preset's own radius is "no
    // override", so it never lingers in state or storage.
    const selectedPreset = getThemeStylePreset(selectedId);
    const presetRadiusPx = selectedPreset.frame.rest.radiusPx;
    const radiusOverridePx = radii[selectedPreset.id];
    const currentRadiusPx = radiusOverridePx ?? presetRadiusPx;

    const commitRadius = (radiusPx: number) => {
        const nextRadii: Record<string, number> = { ...radii };
        if (radiusPx === presetRadiusPx) {
            delete nextRadii[selectedPreset.id];
        } else {
            nextRadii[selectedPreset.id] = radiusPx;
        }
        if (areRadiusOverridesEqual(nextRadii, radii)) {
            return;
        }

        setRadii(nextRadii);
        previewThemeStyleOnDocument(selectedId, document.documentElement, nextRadii[selectedPreset.id]);
        syncDirty(isDifferentFromSnapshot({ id: selectedId, entrance, shape, radii: nextRadii, cutout, linkAccents, accentLengths }));
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
                previewThemeStyleOnDocument(
                    snapshotIdRef.current,
                    document.documentElement,
                    snapshotRadiiRef.current[getThemeStylePreset(snapshotIdRef.current).id],
                );
                applyViewerEntranceSettingsToDocument(snapshotEntranceRef.current);
                previewFrameShape(snapshotShapeRef.current);
                previewIconCutout(snapshotCutoutRef.current);
                previewLinkCornerAccents(snapshotLinkAccentsRef.current);
                applyLinkAccentLengthsToDocument(snapshotAccentLengthsRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!saveRef) {
            return;
        }

        saveRef.current = () => {
            setActiveThemeStyle(selectedId, document.documentElement, radii[getThemeStylePreset(selectedId).id]);
            writeStoredFrameRadiusOverrides(radii);
            writeStoredViewerEntranceSettings(entrance);
            applyViewerEntranceSettingsToDocument(entrance);
            writeStoredFrameShape(shape);
            previewFrameShape(shape);
            writeStoredIconCutout(cutout);
            previewIconCutout(cutout);
            writeStoredLinkCornerAccents(linkAccents);
            previewLinkCornerAccents(linkAccents);
            writeStoredLinkAccentLengths(accentLengths);
            applyLinkAccentLengthsToDocument(accentLengths);
            snapshotIdRef.current = selectedId;
            snapshotEntranceRef.current = entrance;
            snapshotShapeRef.current = shape;
            snapshotRadiiRef.current = radii;
            snapshotCutoutRef.current = cutout;
            snapshotLinkAccentsRef.current = linkAccents;
            snapshotAccentLengthsRef.current = accentLengths;
            dirtyRef.current = false;
            setSaveStatus('saved');
            onDirtyChange?.(false);
        };

        return () => {
            saveRef.current = null;
        };
    }, [accentLengths, cutout, entrance, linkAccents, onDirtyChange, radii, saveRef, selectedId, shape]);

    useEffect(() => {
        if (!revertRef) {
            return;
        }

        revertRef.current = () => {
            const snapshotId = snapshotIdRef.current;
            setSelectedId(snapshotId);
            setRadii(snapshotRadiiRef.current);
            previewThemeStyleOnDocument(
                snapshotId,
                document.documentElement,
                snapshotRadiiRef.current[getThemeStylePreset(snapshotId).id],
            );
            setEntrance(snapshotEntranceRef.current);
            applyViewerEntranceSettingsToDocument(snapshotEntranceRef.current);
            setShape(snapshotShapeRef.current);
            previewFrameShape(snapshotShapeRef.current);
            setCutout(snapshotCutoutRef.current);
            previewIconCutout(snapshotCutoutRef.current);
            setLinkAccents(snapshotLinkAccentsRef.current);
            previewLinkCornerAccents(snapshotLinkAccentsRef.current);
            setAccentLengths(snapshotAccentLengthsRef.current);
            applyLinkAccentLengthsToDocument(snapshotAccentLengthsRef.current);
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

            <section aria-labelledby="theme-radius-heading" className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div id="theme-radius-heading" className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Radio del marco
                </div>
                <p className={`mb-4 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ajuste las esquinas de los marcos de los widgets sobre el tema elegido. Cada tema recuerda su propio
                    valor; Restablecer vuelve al radio original del tema.
                </p>

                <div className="flex flex-col gap-3">
                    <DockSliderField
                        label="Radio del marco"
                        ariaLabel="Radio del marco"
                        numberInputAriaLabel="Valor de radio del marco"
                        unit="px"
                        value={currentRadiusPx}
                        {...FRAME_RADIUS_LIMITS}
                        onChange={commitRadius}
                    />
                    <div>
                        <AdminActionButton
                            variant="secondary"
                            disabled={radiusOverridePx === undefined}
                            onClick={() => commitRadius(presetRadiusPx)}
                        >
                            Restablecer
                        </AdminActionButton>
                    </div>
                </div>
            </section>

            <section aria-labelledby="theme-shape-heading" className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div id="theme-shape-heading" className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Forma del marco
                </div>
                <p className={`mb-4 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Elija la forma de los marcos de los widgets del dashboard. Se combina con cualquier tema. Solo aplica
                    a los widgets con título. En los gráficos con selector de período, el selector va en la franja de la
                    pestaña o, si no cabe, en una fila dentro del cuerpo.
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

            <section aria-labelledby="theme-cutout-heading" className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div id="theme-cutout-heading" className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Calado del ícono
                </div>
                <p className={`mb-4 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Hace transparente el fondo del widget en un círculo detrás del ícono del encabezado, para que el
                    ícono no quede sobre el vidrio. Se aplica con el tema Clásico y la forma de marco Estándar, en los
                    widgets con ícono del dashboard.
                </p>

                <DockToggleField
                    label="Calado del ícono"
                    ariaLabel="Calado del ícono"
                    labelClassName="w-auto flex-1"
                    checked={cutout}
                    onChange={handleCutoutChange}
                />

                {!cutoutApplies && (
                    <p data-testid="theme-cutout-note" className={`mt-3 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                        Ahora no se aplica: requiere el tema Clásico y la forma de marco Estándar.
                    </p>
                )}
            </section>

            <section aria-labelledby="theme-link-accents-heading" className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div id="theme-link-accents-heading" className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Esquinas en widgets con enlace
                </div>
                <p className={`mb-4 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Muestra unas esquinas animadas, apenas por fuera del marco, al pasar el cursor sobre un widget que
                    abre otro dashboard. Se aplica con el tema Clásico y solo en el visor.
                </p>

                <DockToggleField
                    label="Esquinas en widgets con enlace"
                    ariaLabel="Esquinas en widgets con enlace"
                    labelClassName="w-auto flex-1"
                    checked={linkAccents}
                    onChange={handleLinkAccentsChange}
                />

                {/* Visible with the switch off but inactive, like a dependent control. */}
                <p className={`mt-4 mb-3 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    El largo es el tramo recto visible que continúa el arco de la esquina, medido desde donde termina la curva.
                </p>
                <div className="flex flex-col gap-4">
                    {ACCENT_LENGTH_CONTROLS.map(({ key, label, numberInputAriaLabel }) => (
                        <DockSliderField
                            key={key}
                            label={label}
                            ariaLabel={label}
                            numberInputAriaLabel={numberInputAriaLabel}
                            unit="px"
                            value={accentLengths[key]}
                            disabled={!linkAccents}
                            {...LINK_ACCENT_LENGTH_LIMITS}
                            onChange={(value) => handleAccentLengthChange(key, value)}
                        />
                    ))}
                </div>

                {!linkAccentsApply && (
                    <p data-testid="theme-link-accents-note" className={`mt-3 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                        Ahora no se aplica: requiere el tema Clásico.
                    </p>
                )}
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
