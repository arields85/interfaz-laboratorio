import { Fragment, useCallback, useRef, useState } from 'react';
import { Clock3, Palette, Pyramid, SlidersHorizontal, SwatchBook, Wifi } from 'lucide-react';
import AdminDialog from './AdminDialog';
import AdminActionButton from './AdminActionButton';
import ConnectionSettingsTab from './ConnectionSettingsTab';
import DesignSettingsTab from './DesignSettingsTab';
import LoaderOptionsSettingsTab from './LoaderOptionsSettingsTab';
import TemporalSettingsTab from './TemporalSettingsTab';
import ThemeSettingsTab from './ThemeSettingsTab';
import VoiceSettingsTab from './VoiceSettingsTab';
import { useHoldSharedConfigReapply } from '../../hooks/useHoldSharedConfigReapply';
import { SAVE_STATUS_UI, type SaveStatus } from './saveStatus';

const TABS = [
    { id: 'connection', label: 'Conexion', icon: Wifi },
    { id: 'design', label: 'Diseno', icon: Palette },
    { id: 'theme', label: 'Tema', icon: SwatchBook },
    { id: 'options', label: 'Opciones', icon: SlidersHorizontal },
    { id: 'temporal', label: 'Ajustes', icon: Clock3 },
    { id: 'voice', label: 'Prisma', icon: Pyramid },
] as const;

type GlobalSettingsDialogProps = {
    open: boolean;
    onClose: () => void;
};

type TabId = (typeof TABS)[number]['id'];

export default function GlobalSettingsDialog({ open, onClose }: GlobalSettingsDialogProps) {
    const [activeTab, setActiveTab] = useState<TabId>(() => {
        const stored = localStorage.getItem('hmi-global-settings-tab');
        return TABS.some((tab) => tab.id === stored) ? (stored as TabId) : 'connection';
    });

    const [connectionDirty, setConnectionDirty] = useState(false);
    const [designDirty, setDesignDirty] = useState(false);
    const [themeDirty, setThemeDirty] = useState(false);
    const [optionsDirty, setOptionsDirty] = useState(false);
    const [temporalDirty, setTemporalDirty] = useState(false);
    const [voiceDirty, setVoiceDirty] = useState(false);
    const [saveStatusByTab, setSaveStatusByTab] = useState<Record<TabId, SaveStatus>>(() => ({
        connection: null,
        design: null,
        theme: null,
        options: null,
        temporal: null,
        voice: null,
    }));
    const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

    // Per-tab lookup so Guardar's enablement and the tab indicators can read each
    // tab's dirty flag by id without a parallel switch statement per consumer.
    const dirtyByTab: Record<TabId, boolean> = {
        connection: connectionDirty,
        design: designDirty,
        theme: themeDirty,
        options: optionsDirty,
        temporal: temporalDirty,
        voice: voiceDirty,
    };
    const activeTabDirty = dirtyByTab[activeTab];
    const anyTabDirty = Object.values(dirtyByTab).some(Boolean);
    // Unsaved drafts (Diseño and Tema preview live on the document) must not be overwritten by a
    // change another browser saved: it is applied once the drafts are saved or discarded.
    useHoldSharedConfigReapply(anyTabDirty);

    const updateTabSaveStatus = useCallback((tabId: TabId, status: SaveStatus) => {
        setSaveStatusByTab((previous) => (
            previous[tabId] === status ? previous : { ...previous, [tabId]: status }
        ));
    }, []);

    // One stable setter per CONNECTED tab, added in the same work unit that
    // connects that tab's prop (U2 CONEXIÓN, U3 DISEÑO, U4 OPCIONES, U5
    // AJUSTES add theirs one by one), so every setter is always read and
    // noUnusedLocals stays satisfied without any bypass or discard.
    const setConnectionSaveStatus = useCallback(
        (status: SaveStatus) => updateTabSaveStatus('connection', status),
        [updateTabSaveStatus],
    );
    const setDesignSaveStatus = useCallback(
        (status: SaveStatus) => updateTabSaveStatus('design', status),
        [updateTabSaveStatus],
    );
    const setThemeSaveStatus = useCallback(
        (status: SaveStatus) => updateTabSaveStatus('theme', status),
        [updateTabSaveStatus],
    );
    const setOptionsSaveStatus = useCallback(
        (status: SaveStatus) => updateTabSaveStatus('options', status),
        [updateTabSaveStatus],
    );
    const setTemporalSaveStatus = useCallback(
        (status: SaveStatus) => updateTabSaveStatus('temporal', status),
        [updateTabSaveStatus],
    );
    const setVoiceSaveStatus = useCallback(
        (status: SaveStatus) => updateTabSaveStatus('voice', status),
        [updateTabSaveStatus],
    );

    const activeSaveStatus = saveStatusByTab[activeTab];

    const connectionSaveRef = useRef<(() => void) | null>(null);
    const designSaveRef = useRef<(() => void) | null>(null);
    const designRevertRef = useRef<(() => void) | null>(null);
    const themeSaveRef = useRef<(() => void) | null>(null);
    const themeRevertRef = useRef<(() => void) | null>(null);
    const optionsSaveRef = useRef<(() => void) | null>(null);
    const temporalSaveRef = useRef<(() => void) | null>(null);
    const voiceSaveRef = useRef<(() => void | Promise<void>) | null>(null);

    const handleSave = () => {
        if (activeTab === 'connection') {
            connectionSaveRef.current?.();
            return;
        }

        if (activeTab === 'design') {
            designSaveRef.current?.();
            return;
        }

        if (activeTab === 'theme') {
            themeSaveRef.current?.();
            return;
        }

        if (activeTab === 'temporal') {
            temporalSaveRef.current?.();
            return;
        }

        if (activeTab === 'voice') {
            void voiceSaveRef.current?.();
            return;
        }

        optionsSaveRef.current?.();
    };

    // Discards every tab's draft (reverting Diseño's and Tema's live preview)
    // and closes. This is the confirmed path: either the user accepted the
    // discard prompt, or there was nothing to discard in the first place.
    const discardAndClose = () => {
        if (designDirty) {
            designRevertRef.current?.();
        }
        if (themeDirty) {
            themeRevertRef.current?.();
        }
        setConnectionDirty(false);
        setDesignDirty(false);
        setThemeDirty(false);
        setOptionsDirty(false);
        setTemporalDirty(false);
        setVoiceDirty(false);
        setSaveStatusByTab({
            connection: null,
            design: null,
            theme: null,
            options: null,
            temporal: null,
            voice: null,
        });
        setConfirmDiscardOpen(false);
        onClose();
    };

    // Entry point for Cerrar, Escape and a backdrop click. When the confirm
    // dialog is already open it owns those gestures instead (guarded below),
    // so this never re-opens it out from under an in-flight cancel/confirm.
    const handleRequestClose = () => {
        if (confirmDiscardOpen) {
            return;
        }
        if (anyTabDirty) {
            setConfirmDiscardOpen(true);
            return;
        }
        discardAndClose();
    };

    const handleCancelDiscard = () => {
        setConfirmDiscardOpen(false);
    };

    return (
        <>
        <AdminDialog
            open={open}
            title="CONFIGURACION GENERAL"
            onClose={handleRequestClose}
            maxWidth="max-w-3xl"
            actions={(
                <div
                    role="group"
                    aria-label="Acciones de configuración general"
                    className="flex items-center gap-2"
                >
                    {activeSaveStatus ? (
                        <p
                            className={`mr-2 text-xs ${SAVE_STATUS_UI[activeSaveStatus].className}`}
                            aria-live="polite"
                            aria-atomic="true"
                        >
                            {SAVE_STATUS_UI[activeSaveStatus].label}
                        </p>
                    ) : null}
                    <AdminActionButton
                        variant="primary"
                        onClick={handleSave}
                        disabled={!activeTabDirty}
                    >
                        Guardar
                    </AdminActionButton>
                    <AdminActionButton variant="secondary" onClick={handleRequestClose}>
                        Cerrar
                    </AdminActionButton>
                </div>
            )}
        >
            <div className="flex max-h-[calc(var(--viewport-height)-12rem)] min-h-[520px] flex-col">
                <div className="shrink-0 border-b border-white/10">
                    <div className="flex flex-row gap-1">
                        {TABS.map(({ id, label, icon: Icon }) => {
                            const isActive = activeTab === id;
                            // Only surfaced on an inactive tab: the active tab's own
                            // status already renders in the footer next to Guardar.
                            const showUnsavedIndicator = !isActive && dirtyByTab[id];
                            const unsavedIndicatorId = `global-settings-tab-${id}-unsaved`;

                            return (
                                <Fragment key={id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                        setActiveTab(id);
                                        localStorage.setItem('hmi-global-settings-tab', id);
                                    }}
                                        aria-describedby={showUnsavedIndicator ? unsavedIndicatorId : undefined}
                                        className={[
                                            'flex items-center gap-2 px-4 py-2 uppercase transition-colors',
                                            isActive
                                                ? 'border-b-2 border-admin-accent text-white'
                                                : 'text-industrial-muted hover:text-white',
                                        ].join(' ')}
                                    >
                                        <Icon size={14} />
                                        <span>{label}</span>
                                        {showUnsavedIndicator ? (
                                            <span
                                                aria-hidden="true"
                                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning"
                                            />
                                        ) : null}
                                    </button>
                                    {/* Sibling of the button, not a child: keeps the button's
                                        accessible NAME stable for exact-name role queries while
                                        still exposing the state via aria-describedby. */}
                                    {showUnsavedIndicator ? (
                                        <span id={unsavedIndicatorId} className="sr-only">
                                            Cambios sin guardar
                                        </span>
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </div>
                </div>

                <div
                    role="region"
                    aria-label="Contenido de configuración general"
                    className="hmi-scrollbar min-h-0 flex-1 overflow-y-auto pr-2 pt-4"
                >
                    <div hidden={activeTab !== 'connection'}>
                        <ConnectionSettingsTab
                            onDirtyChange={setConnectionDirty}
                            onSaveStatusChange={setConnectionSaveStatus}
                            saveRef={connectionSaveRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'design'}>
                        <DesignSettingsTab
                            onDirtyChange={setDesignDirty}
                            onSaveStatusChange={setDesignSaveStatus}
                            saveRef={designSaveRef}
                            revertRef={designRevertRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'theme'}>
                        <ThemeSettingsTab
                            onDirtyChange={setThemeDirty}
                            onSaveStatusChange={setThemeSaveStatus}
                            saveRef={themeSaveRef}
                            revertRef={themeRevertRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'options'}>
                        <LoaderOptionsSettingsTab
                            onDirtyChange={setOptionsDirty}
                            onSaveStatusChange={setOptionsSaveStatus}
                            saveRef={optionsSaveRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'temporal'}>
                        <TemporalSettingsTab
                            onDirtyChange={setTemporalDirty}
                            onSaveStatusChange={setTemporalSaveStatus}
                            saveRef={temporalSaveRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'voice'}>
                        <VoiceSettingsTab
                            credentialControlsActive={open && activeTab === 'voice'}
                            onDirtyChange={setVoiceDirty}
                            onSaveStatusChange={setVoiceSaveStatus}
                            saveRef={voiceSaveRef}
                        />
                    </div>
                </div>
            </div>
        </AdminDialog>

        <AdminDialog
            open={confirmDiscardOpen}
            title="¿Descartar los cambios?"
            onClose={handleCancelDiscard}
            actions={(
                <>
                    <AdminActionButton variant="secondary" onClick={handleCancelDiscard}>
                        Cancelar
                    </AdminActionButton>
                    <AdminActionButton variant="critical" onClick={discardAndClose}>
                        Descartar cambios
                    </AdminActionButton>
                </>
            )}
        >
            <p className="text-industrial-muted">
                Hay cambios sin guardar en esta ventana. Si continúa, se perderán.
            </p>
        </AdminDialog>
        </>
    );
}
