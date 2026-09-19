import { useEffect, useMemo, useState } from 'react';
import AdminActionButton from './AdminActionButton';
import type { SaveStatus } from './saveStatus';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
} from './adminSidebarStyles';
import {
    LOADER_OPTIONS_DEFAULTS,
    type LoaderOptionsConfig,
    type LoaderProfileId,
    normalizeLoaderOptionsConfig,
    readLoaderOptionsConfig,
    saveLoaderOptionsConfig,
} from '../../config/loaderOptions.config';

type LoaderOptionsSettingsTabProps = {
    onDirtyChange?: (dirty: boolean) => void;
    onSaveStatusChange?: (status: SaveStatus) => void;
    saveRef?: { current: (() => void) | null };
};

type LoaderOptionDraft = {
    enabled: boolean;
    durationSeconds: string;
};

type LoaderOptionsDraft = Record<LoaderProfileId, LoaderOptionDraft>;

const HELPER_TEXT = 'Minimo 0.2s · Maximo 15s';
const PROFILE_ORDER: LoaderProfileId[] = ['short', 'long'];

function toDraft(config: LoaderOptionsConfig): LoaderOptionsDraft {
    return {
        short: {
            enabled: config.short.enabled,
            durationSeconds: String(config.short.durationSeconds),
        },
        long: {
            enabled: config.long.enabled,
            durationSeconds: String(config.long.durationSeconds),
        },
    };
}

function toConfig(draft: LoaderOptionsDraft): LoaderOptionsConfig {
    return normalizeLoaderOptionsConfig({
        short: {
            enabled: draft.short.enabled,
            durationSeconds: Number(draft.short.durationSeconds),
        },
        long: {
            enabled: draft.long.enabled,
            durationSeconds: Number(draft.long.durationSeconds),
        },
    });
}

export default function LoaderOptionsSettingsTab({ onDirtyChange, onSaveStatusChange, saveRef }: LoaderOptionsSettingsTabProps) {
    const [draft, setDraft] = useState<LoaderOptionsDraft>(() => toDraft(readLoaderOptionsConfig()));
    const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);

    const normalizedDraft = useMemo(() => toConfig(draft), [draft]);

    useEffect(() => {
        onSaveStatusChange?.(saveStatus);
    }, [onSaveStatusChange, saveStatus]);

    const handleEnabledChange = (profileId: LoaderProfileId, enabled: boolean) => {
        setDraft((currentDraft) => ({
            ...currentDraft,
            [profileId]: {
                ...currentDraft[profileId],
                enabled,
            },
        }));
        setSaveStatus('dirty');
        onDirtyChange?.(true);
    };

    const handleDurationChange = (profileId: LoaderProfileId, nextValue: string) => {
        setDraft((currentDraft) => ({
            ...currentDraft,
            [profileId]: {
                ...currentDraft[profileId],
                durationSeconds: nextValue,
            },
        }));
        setSaveStatus('dirty');
        onDirtyChange?.(true);
    };

    const handleDurationBlur = (profileId: LoaderProfileId) => {
        setDraft((currentDraft) => ({
            ...currentDraft,
            [profileId]: {
                ...currentDraft[profileId],
                durationSeconds: String(toConfig(currentDraft)[profileId].durationSeconds),
            },
        }));
    };

    const handleRestoreDefaults = () => {
        setDraft(toDraft(LOADER_OPTIONS_DEFAULTS));
        // The restore only replaces the draft: it does not touch storage here
        // (the persisted write happens through the save ref), so it projects
        // `dirty`, the same case as any other edit that marks dirty without
        // persisting.
        setSaveStatus('dirty');
        onDirtyChange?.(true);
    };

    useEffect(() => {
        if (!saveRef) {
            return;
        }

        saveRef.current = () => {
            try {
                saveLoaderOptionsConfig(normalizedDraft);
                setSaveStatus('saved');
                onDirtyChange?.(false);
            } catch {
                // The dialog's save-ref contract is fire-and-forget: report the
                // persistence failure upward instead of rethrowing, keeping the
                // tab dirty because nothing was persisted.
                setSaveStatus('error');
            }
        };

        return () => {
            saveRef.current = null;
        };
    }, [normalizedDraft, onDirtyChange, saveRef]);

    return (
        <div className="space-y-4">
            <header>
                <h4 className="uppercase text-white">Opciones</h4>
                <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Configura loaders visuales de la HMI sin cambios sobre la planta.
                </p>
            </header>

            {PROFILE_ORDER.map((profileId) => {
                const sectionDraft = draft[profileId];
                const inputId = `loader-duration-${profileId}`;

                return (
                    <section key={profileId} className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h5 className="uppercase text-white">Loader {profileId}</h5>
                                <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                                    {HELPER_TEXT}
                                </p>
                            </div>

                            <label className="flex items-center gap-2 text-industrial-muted">
                                <input
                                    type="checkbox"
                                    checked={sectionDraft.enabled}
                                    onChange={(event) => handleEnabledChange(profileId, event.target.checked)}
                                    aria-label={`Habilitar loader ${profileId}`}
                                />
                                <span>Habilitar</span>
                            </label>
                        </div>

                        <div className="mt-4 space-y-1.5">
                            <label htmlFor={inputId} className={`${ADMIN_SIDEBAR_LABEL_CLS} block w-auto`}>
                                {`Duracion ${profileId} (s)`}
                            </label>
                            <input
                                id={inputId}
                                type="number"
                                min="0.2"
                                max="15"
                                step="0.1"
                                inputMode="decimal"
                                value={sectionDraft.durationSeconds}
                                disabled={!sectionDraft.enabled}
                                onChange={(event) => handleDurationChange(profileId, event.target.value)}
                                onBlur={() => handleDurationBlur(profileId)}
                                className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60`}
                            />
                        </div>
                    </section>
                );
            })}

            <div>
                <AdminActionButton variant="secondary" onClick={handleRestoreDefaults}>
                    Restaurar valores por defecto
                </AdminActionButton>
            </div>
        </div>
    );
}
