import { useRef, useState } from 'react';
import { Clock3, Mic2, Palette, SlidersHorizontal, Wifi } from 'lucide-react';
import AdminDialog from './AdminDialog';
import AdminActionButton from './AdminActionButton';
import ConnectionSettingsTab from './ConnectionSettingsTab';
import DesignSettingsTab from './DesignSettingsTab';
import LoaderOptionsSettingsTab from './LoaderOptionsSettingsTab';
import TemporalSettingsTab from './TemporalSettingsTab';
import VoiceSettingsTab from './VoiceSettingsTab';

const TABS = [
    { id: 'connection', label: 'Conexion', icon: Wifi },
    { id: 'design', label: 'Diseno', icon: Palette },
    { id: 'options', label: 'Opciones', icon: SlidersHorizontal },
    { id: 'temporal', label: 'Ajustes', icon: Clock3 },
    { id: 'voice', label: 'Voz', icon: Mic2 },
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
    const [optionsDirty, setOptionsDirty] = useState(false);
    const [temporalDirty, setTemporalDirty] = useState(false);
    const [voiceDirty, setVoiceDirty] = useState(false);
    const dirty = connectionDirty || designDirty || optionsDirty || temporalDirty || voiceDirty;

    const connectionSaveRef = useRef<(() => void) | null>(null);
    const designSaveRef = useRef<(() => void) | null>(null);
    const designRevertRef = useRef<(() => void) | null>(null);
    const optionsSaveRef = useRef<(() => void) | null>(null);
    const temporalSaveRef = useRef<(() => void) | null>(null);
    const voiceSaveRef = useRef<(() => void) | null>(null);

    const handleSave = () => {
        if (activeTab === 'connection') {
            connectionSaveRef.current?.();
            return;
        }

        if (activeTab === 'design') {
            designSaveRef.current?.();
            return;
        }

        if (activeTab === 'temporal') {
            temporalSaveRef.current?.();
            return;
        }

        if (activeTab === 'voice') {
            voiceSaveRef.current?.();
            return;
        }

        optionsSaveRef.current?.();
    };

    const handleClose = () => {
        if (designDirty) {
            designRevertRef.current?.();
        }
        setConnectionDirty(false);
        setDesignDirty(false);
        setOptionsDirty(false);
        setTemporalDirty(false);
        setVoiceDirty(false);
        onClose();
    };

    return (
        <AdminDialog
            open={open}
            title="CONFIGURACION GENERAL"
            onClose={handleClose}
            maxWidth="max-w-3xl"
            actions={(
                <div className="flex gap-2">
                    <AdminActionButton
                        variant="primary"
                        onClick={handleSave}
                        disabled={!dirty}
                    >
                        Guardar
                    </AdminActionButton>
                    <AdminActionButton variant="secondary" onClick={handleClose}>
                        Cerrar
                    </AdminActionButton>
                </div>
            )}
        >
            <div className="flex max-h-[calc(100vh-12rem)] min-h-[520px] flex-col">
                <div className="shrink-0 border-b border-white/10">
                    <div className="flex flex-row gap-1">
                        {TABS.map(({ id, label, icon: Icon }) => {
                            const isActive = activeTab === id;

                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => {
                                    setActiveTab(id);
                                    localStorage.setItem('hmi-global-settings-tab', id);
                                }}
                                    className={[
                                        'flex items-center gap-2 px-4 py-2 uppercase transition-colors',
                                        isActive
                                            ? 'border-b-2 border-admin-accent text-white'
                                            : 'text-industrial-muted hover:text-white',
                                    ].join(' ')}
                                >
                                    <Icon size={14} />
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="hmi-scrollbar min-h-0 flex-1 overflow-y-auto pr-2 pt-4">
                    <div hidden={activeTab !== 'connection'}>
                        <ConnectionSettingsTab
                            onDirtyChange={setConnectionDirty}
                            saveRef={connectionSaveRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'design'}>
                        <DesignSettingsTab
                            onDirtyChange={setDesignDirty}
                            saveRef={designSaveRef}
                            revertRef={designRevertRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'options'}>
                        <LoaderOptionsSettingsTab
                            onDirtyChange={setOptionsDirty}
                            saveRef={optionsSaveRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'temporal'}>
                        <TemporalSettingsTab
                            onDirtyChange={setTemporalDirty}
                            saveRef={temporalSaveRef}
                        />
                    </div>

                    <div hidden={activeTab !== 'voice'}>
                        <VoiceSettingsTab
                            onDirtyChange={setVoiceDirty}
                            saveRef={voiceSaveRef}
                        />
                    </div>
                </div>
            </div>
        </AdminDialog>
    );
}
