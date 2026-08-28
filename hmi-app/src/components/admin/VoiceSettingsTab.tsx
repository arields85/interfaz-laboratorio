import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import {
    DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT,
    DATA_DEFAULT_VOICE_ENDPOINT,
    buildDataUrl,
    getDataBaseUrl,
    getDataPrismaConfigEndpoint,
    getDataPrismaConfigUrl,
    getSavedDataPrismaConfigEndpoint,
    getSavedDataVoiceEndpoint,
    saveDataPrismaConfigEndpoint,
    saveDataVoiceEndpoint,
} from '../../config/dataConnection.config';
import {
    readPrismaVoiceTtsServiceUrl,
    savePrismaVoiceTtsServiceUrl,
} from '../../config/prismaVoiceTts.config';
import {
    PRISMA_ORB_CORE_OPTIONS,
    PRISMA_ORB_GLOW_OPTIONS,
    PRISMA_ORB_VISUAL_LIMITS,
    readPrismaOrbVisualConfig,
    savePrismaOrbVisualConfig,
} from '../../config/prismaOrb.config';
import { savePrismaRuntimeMode } from '../../config/prismaRuntime.config';
import {
    clonePrismaVoiceConfig,
    validatePrismaVoiceConfig,
} from '../../domain/prismaVoiceConfig';
import type { PrismaOrbVisualConfig } from '../../domain/voice.types';
import { usePrismaVoiceConfigDraft } from '../../hooks/usePrismaVoiceConfigDraft';
import { usePrismaRuntimeProfile } from '../../hooks/usePrismaRuntimeProfile';
import { usePrismaVoiceConfig } from '../../queries/usePrismaVoiceConfig';
import { useUpdatePrismaVoiceConfig } from '../../queries/useUpdatePrismaVoiceConfig';
import PrismaOrb from '../PrismaOrb';
import AdminSelect from './AdminSelect';
import DockColorField from './DockColorField';
import DockInlineControlRow from './DockInlineControlRow';
import DockSliderField from './DockSliderField';
import DockToggleField from './DockToggleField';
import PrismaVoiceEffectsSettings from './PrismaVoiceEffectsSettings';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';
import type { VoiceSaveStatus } from './voiceSaveStatus';

interface VoiceSettingsTabProps {
    onDirtyChange?: (dirty: boolean) => void;
    onSaveStatusChange?: (status: VoiceSaveStatus) => void;
    saveRef?: { current: (() => void | Promise<void>) | null };
}

type PreviewBackdrop = 'HMI preview' | 'Transparent' | 'Light panel';
type ColorKey = 'core' | 'glow';

const HEX_CODE_PATTERN = /^[0-9a-f]{6}$/i;
const PREVIEW_BACKDROP_CLASSES: Record<PreviewBackdrop, string> = {
    'HMI preview': 'bg-industrial-bg',
    Transparent: 'bg-transparent',
    'Light panel': 'bg-industrial-text/90',
};
const PREVIEW_BACKDROP_OPTIONS = [
    { value: 'HMI preview', label: 'Vista previa HMI' },
    { value: 'Transparent', label: 'Transparente' },
    { value: 'Light panel', label: 'Panel claro' },
] satisfies Array<{ value: PreviewBackdrop; label: string }>;

const PRISMA_RUNTIME_MODE_OPTIONS = [
    { value: 'central', label: 'Server (Node-RED)' },
    { value: 'local', label: 'Local (presentations)' },
] satisfies Array<{ value: string; label: string }>;

function visualConfigsEqual(left: PrismaOrbVisualConfig, right: PrismaOrbVisualConfig): boolean {
    return left.rays === right.rays
        && left.speed === right.speed
        && left.intensity === right.intensity
        && left.size === right.size
        && left.core === right.core
        && left.glow === right.glow;
}

export default function VoiceSettingsTab({ onDirtyChange, onSaveStatusChange, saveRef }: VoiceSettingsTabProps) {
    const runtimeProfile = usePrismaRuntimeProfile();
    const voiceConfigDraft = usePrismaVoiceConfigDraft();
    const updateVoiceConfig = useUpdatePrismaVoiceConfig();
    const [initialSettings] = useState(() => {
        const prismaConfigEndpoint = getDataPrismaConfigEndpoint();
        const dataBaseUrl = getDataBaseUrl();

        return {
            endpoint: getSavedDataVoiceEndpoint() ?? DATA_DEFAULT_VOICE_ENDPOINT,
            prismaConfigEndpoint: getSavedDataPrismaConfigEndpoint() ?? DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT,
            prismaConfigUrl: getDataPrismaConfigUrl(),
            prismaConfigUnavailableReason: prismaConfigEndpoint === null
                ? 'endpoint-disabled' as const
                : dataBaseUrl === null
                    ? 'base-missing' as const
                    : null,
            ttsServiceUrl: readPrismaVoiceTtsServiceUrl(),
            visualConfig: readPrismaOrbVisualConfig(),
        };
    });
    const remoteVoiceConfig = usePrismaVoiceConfig(initialSettings.prismaConfigUrl);
    const persistedSettingsRef = useRef({
        endpoint: initialSettings.endpoint,
        prismaConfigEndpoint: initialSettings.prismaConfigEndpoint,
        ttsServiceUrl: initialSettings.ttsServiceUrl,
        visualConfig: initialSettings.visualConfig,
    });
    const [draftEndpoint, setDraftEndpoint] = useState(initialSettings.endpoint);
    const [draftPrismaConfigEndpoint, setDraftPrismaConfigEndpoint] = useState(initialSettings.prismaConfigEndpoint);
    const [draftTtsServiceUrl, setDraftTtsServiceUrl] = useState(initialSettings.ttsServiceUrl);
    const [draftVisualConfig, setDraftVisualConfig] = useState(initialSettings.visualConfig);
    const [coreHexCode, setCoreHexCode] = useState(initialSettings.visualConfig.core.slice(1));
    const [glowHexCode, setGlowHexCode] = useState(initialSettings.visualConfig.glow.slice(1));
    const [showSlider, setShowSlider] = useState(true);
    const [autoDemo, setAutoDemo] = useState(true);
    const [speaking, setSpeaking] = useState(false);
    const [demoSpeaking, setDemoSpeaking] = useState(false);
    const [backdrop, setBackdrop] = useState<PreviewBackdrop>('HMI preview');
    const [voiceConfigValid, setVoiceConfigValid] = useState(true);
    const [saveStatus, setSaveStatus] = useState<VoiceSaveStatus>(null);
    const autoDemoRef = useRef(autoDemo);
    const speakingRef = useRef(speaking);
    const demoSpeakingRef = useRef(demoSpeaking);
    const mountedRef = useRef(true);
    const saveInFlightRef = useRef<Promise<void> | null>(null);
    const editGenerationRef = useRef(0);
    const effectEditGenerationRef = useRef(0);
    const voiceConfigValidRef = useRef(true);
    const initializeVoiceConfigFromRemote = voiceConfigDraft.initializeFromRemote;

    const markPersistentEdit = useCallback((effectEdit = false) => {
        editGenerationRef.current += 1;
        if (effectEdit) {
            effectEditGenerationRef.current += 1;
        }
        setSaveStatus('dirty');
    }, []);

    const handleVoiceConfigValidityChange = useCallback((valid: boolean) => {
        voiceConfigValidRef.current = valid;
        setVoiceConfigValid(valid);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        autoDemoRef.current = autoDemo;
        speakingRef.current = speaking;
    }, [autoDemo, speaking]);

    useEffect(() => {
        if (remoteVoiceConfig.data) {
            initializeVoiceConfigFromRemote(remoteVoiceConfig.data);
        }
    }, [initializeVoiceConfigFromRemote, remoteVoiceConfig.data]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const cycle = () => {
            const nextSpeaking = autoDemoRef.current
                ? !demoSpeakingRef.current
                : speakingRef.current;
            demoSpeakingRef.current = nextSpeaking;
            setDemoSpeaking(nextSpeaking);
            timer = setTimeout(cycle, nextSpeaking ? 2_600 : 5_200);
        };

        timer = setTimeout(cycle, 2_200);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const persisted = persistedSettingsRef.current;
        onDirtyChange?.(
            draftEndpoint !== persisted.endpoint
            || draftPrismaConfigEndpoint !== persisted.prismaConfigEndpoint
            || draftTtsServiceUrl !== persisted.ttsServiceUrl
            || !visualConfigsEqual(draftVisualConfig, persisted.visualConfig)
            || voiceConfigDraft.isDirty
            || !voiceConfigValid
            || saveStatus === 'saving'
            || saveStatus === 'error',
        );
    }, [
        draftEndpoint,
        draftPrismaConfigEndpoint,
        draftTtsServiceUrl,
        draftVisualConfig,
        onDirtyChange,
        voiceConfigDraft.isDirty,
        voiceConfigValid,
        saveStatus,
    ]);

    useEffect(() => {
        onSaveStatusChange?.(saveStatus);
    }, [onSaveStatusChange, saveStatus]);

    const handleSave = useCallback((): Promise<void> => {
        if (saveInFlightRef.current) {
            return saveInFlightRef.current;
        }

        const savedEndpoint = draftEndpoint.trim();
        const savedPrismaConfigEndpoint = draftPrismaConfigEndpoint.trim();
        const prismaConfigUrl = buildDataUrl(getDataBaseUrl(), savedPrismaConfigEndpoint);
        const voiceConfigSnapshot = clonePrismaVoiceConfig(voiceConfigDraft.draft);
        const validation = validatePrismaVoiceConfig(voiceConfigSnapshot);
        if (!voiceConfigValidRef.current || !validation.valid || !prismaConfigUrl) {
            setSaveStatus('error');
            return Promise.resolve();
        }

        if (savedEndpoint !== persistedSettingsRef.current.endpoint) {
            saveDataVoiceEndpoint(savedEndpoint);
        }
        if (savedPrismaConfigEndpoint !== persistedSettingsRef.current.prismaConfigEndpoint) {
            saveDataPrismaConfigEndpoint(savedPrismaConfigEndpoint);
        }
        const savedTtsServiceUrl = savePrismaVoiceTtsServiceUrl(draftTtsServiceUrl);
        const savedVisualConfig = savePrismaOrbVisualConfig(draftVisualConfig);
        persistedSettingsRef.current = {
            endpoint: savedEndpoint,
            prismaConfigEndpoint: savedPrismaConfigEndpoint,
            ttsServiceUrl: savedTtsServiceUrl,
            visualConfig: savedVisualConfig,
        };
        setDraftEndpoint(savedEndpoint);
        setDraftPrismaConfigEndpoint(savedPrismaConfigEndpoint);
        setDraftTtsServiceUrl(savedTtsServiceUrl);
        setDraftVisualConfig(savedVisualConfig);
        const sentEditGeneration = editGenerationRef.current;
        const sentEffectEditGeneration = effectEditGenerationRef.current;
        setSaveStatus('saving');

        const request = (async () => {
            try {
                const remoteConfig = await updateVoiceConfig.mutateAsync({
                    url: prismaConfigUrl,
                    config: validation.value,
                });
                if (!mountedRef.current) return;

                const hasConcurrentEdits = editGenerationRef.current !== sentEditGeneration;
                const hasInvalidConcurrentEffectEdit = effectEditGenerationRef.current !== sentEffectEditGeneration
                    && !voiceConfigValidRef.current;
                voiceConfigDraft.commitRemote(
                    voiceConfigSnapshot,
                    remoteConfig,
                    !hasInvalidConcurrentEffectEdit,
                );
                setSaveStatus(hasConcurrentEdits ? 'dirty' : 'saved');
            } catch {
                if (mountedRef.current) {
                    setSaveStatus('error');
                }
            }
        })();

        saveInFlightRef.current = request;
        void request.then(() => {
            if (saveInFlightRef.current === request) {
                saveInFlightRef.current = null;
            }
        });
        return request;
    }, [
        draftEndpoint,
        draftPrismaConfigEndpoint,
        draftTtsServiceUrl,
        draftVisualConfig,
        voiceConfigDraft,
        updateVoiceConfig,
    ]);

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

    const updateVisualConfig = <Key extends keyof PrismaOrbVisualConfig>(
        key: Key,
        value: PrismaOrbVisualConfig[Key],
    ) => {
        markPersistentEdit();
        setDraftVisualConfig((current) => ({ ...current, [key]: value }));
    };

    const updateColor = (key: ColorKey, value: string) => {
        const normalized = value.toLowerCase();
        updateVisualConfig(key, normalized);
        if (key === 'core') {
            setCoreHexCode(normalized.slice(1));
        } else {
            setGlowHexCode(normalized.slice(1));
        }
    };

    const updateHexCode = (key: ColorKey, value: string) => {
        const nextHexCode = value.replace(/^#/, '').slice(0, 6);
        if (key === 'core') {
            setCoreHexCode(nextHexCode);
        } else {
            setGlowHexCode(nextHexCode);
        }

        if (HEX_CODE_PATTERN.test(nextHexCode)) {
            updateVisualConfig(key, `#${nextHexCode.toLowerCase()}`);
        }
    };

    const restoreInvalidHexCode = (key: ColorKey) => {
        if (key === 'core' && !HEX_CODE_PATTERN.test(coreHexCode)) {
            setCoreHexCode(draftVisualConfig.core.slice(1));
        }
        if (key === 'glow' && !HEX_CODE_PATTERN.test(glowHexCode)) {
            setGlowHexCode(draftVisualConfig.glow.slice(1));
        }
    };

    const resolvedSpeaking = autoDemo ? demoSpeaking : speaking;

    return (
        <div className="space-y-4">
            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Modo de ejecución de Prisma
                </div>
                <AdminSelect
                    ariaLabel="Modo de ejecución de Prisma"
                    value={runtimeProfile.mode}
                    options={PRISMA_RUNTIME_MODE_OPTIONS}
                    disabled={runtimeProfile.isTemporaryOverride}
                    onChange={(value) => savePrismaRuntimeMode(value)}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    {runtimeProfile.mode === 'local'
                        ? 'Usa servicios locales de presentación para demostraciones offline; no modifica la conexión industrial.'
                        : 'Usa la conexión central configurada en Node-RED para la asistencia de Prisma.'}
                </p>
                {runtimeProfile.isTemporaryOverride ? (
                    <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`} aria-live="polite">
                        El modo Local está activo por un parámetro temporal de la URL. La selección está deshabilitada y la preferencia guardada no cambia.
                    </p>
                ) : null}
            </section>

            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <label htmlFor="voice-settings-endpoint" className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Voz HMI
                </label>
                <input
                    id="voice-settings-endpoint"
                    value={draftEndpoint}
                    onChange={(event) => {
                        markPersistentEdit();
                        setDraftEndpoint(event.target.value);
                    }}
                    placeholder={DATA_DEFAULT_VOICE_ENDPOINT}
                    aria-describedby="voice-settings-endpoint-hint voice-settings-endpoint-legend"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p id="voice-settings-endpoint-hint" className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint de respuestas del asistente de voz. Dejar vacío para deshabilitar el canal de voz de la HMI.
                </p>
                <p id="voice-settings-endpoint-legend" className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    /hmi/voice/latest → Node-RED, respuestas de voz
                </p>
            </section>

            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <label htmlFor="voice-settings-prisma-config-endpoint" className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Configuración Prisma
                </label>
                <input
                    id="voice-settings-prisma-config-endpoint"
                    value={draftPrismaConfigEndpoint}
                    onChange={(event) => {
                        markPersistentEdit();
                        setDraftPrismaConfigEndpoint(event.target.value);
                    }}
                    placeholder={DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT}
                    aria-describedby="voice-settings-prisma-config-endpoint-legend"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p id="voice-settings-prisma-config-endpoint-legend" className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    /hmi/prisma-config → Node-RED, configuración central de efectos
                </p>
                {initialSettings.prismaConfigUnavailableReason === 'base-missing' ? (
                    <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`} aria-live="polite">
                        Configurá la conexión a Node-RED para cargar la configuración central de Prisma.
                    </p>
                ) : null}
                {remoteVoiceConfig.error ? (
                    <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`} aria-live="polite">
                        No se pudo cargar la configuración central de Prisma. Se mantienen los valores actuales.
                    </p>
                ) : null}
            </section>

            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <label htmlFor="voice-settings-tts-service-url" className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    URL Servicio Voz Prisma
                </label>
                <input
                    id="voice-settings-tts-service-url"
                    value={draftTtsServiceUrl}
                    onChange={(event) => {
                        markPersistentEdit();
                        setDraftTtsServiceUrl(event.target.value);
                    }}
                    aria-describedby="voice-settings-tts-service-url-hint voice-settings-tts-service-url-legend"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p id="voice-settings-tts-service-url-hint" className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    URL del servicio TTS utilizado por Prisma para generar la voz Leda. Dejar vacío para deshabilitar la reproducción de voz en la interfaz.
                </p>
                <p id="voice-settings-tts-service-url-legend" className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    http://127.0.0.1:5056/prisma/speak-live → servicio local de Prisma que genera y entrega el audio
                </p>
            </section>

            <PrismaVoiceEffectsSettings
                key={voiceConfigDraft.baselineGeneration}
                config={voiceConfigDraft.draft}
                onFieldChange={voiceConfigDraft.updateField}
                onRoboticFieldChange={voiceConfigDraft.updateRoboticField}
                onValidityChange={handleVoiceConfigValidityChange}
                onEdit={() => markPersistentEdit(true)}
            />

            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                    Prisma · Orbe visual
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.1fr)]">
                    <div
                        data-testid="prisma-orb-preview-stage"
                        className={`grid min-h-72 place-items-center overflow-hidden rounded-lg border border-white/10 p-3 transition-colors ${PREVIEW_BACKDROP_CLASSES[backdrop]}`}
                    >
                        <div
                            data-testid="prisma-orb-preview-size"
                            className="pointer-events-none size-[min(var(--prisma-orb-size),100%)] shrink-0"
                            style={{ '--prisma-orb-size': `${draftVisualConfig.size}px` } as CSSProperties}
                        >
                            <div data-testid="prisma-orb-preview" className="size-full">
                                <PrismaOrb
                                    config={draftVisualConfig}
                                    speaking={resolvedSpeaking}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid content-start gap-4 sm:grid-cols-2 md:grid-cols-1">
                        <DockSliderField
                            label="Haces (rays)"
                            ariaLabel="Haces (rays)"
                            value={draftVisualConfig.rays}
                            {...PRISMA_ORB_VISUAL_LIMITS.rays}
                            onChange={(value) => updateVisualConfig('rays', value)}
                        />
                        <DockToggleField
                            label="Mostrar deslizador"
                            checked={showSlider}
                            onChange={setShowSlider}
                            labelClassName="w-auto"
                        />
                        <DockToggleField
                            label="Demo automática"
                            checked={autoDemo}
                            onChange={setAutoDemo}
                            labelClassName="w-auto"
                        />
                        <DockToggleField
                            label="Hablando"
                            checked={speaking}
                            disabled={autoDemo}
                            onChange={setSpeaking}
                            labelClassName="w-auto"
                        />
                        <DockSliderField
                            label="Velocidad"
                            value={draftVisualConfig.speed}
                            {...PRISMA_ORB_VISUAL_LIMITS.speed}
                            onChange={(value) => updateVisualConfig('speed', value)}
                        />
                        <DockSliderField
                            label="Intensidad"
                            value={draftVisualConfig.intensity}
                            {...PRISMA_ORB_VISUAL_LIMITS.intensity}
                            onChange={(value) => updateVisualConfig('intensity', value)}
                        />
                        <DockSliderField
                            label="Tamaño (px)"
                            value={draftVisualConfig.size}
                            {...PRISMA_ORB_VISUAL_LIMITS.size}
                            onChange={(value) => updateVisualConfig('size', value)}
                        />
                        <DockColorField
                            label="Color del núcleo"
                            color={draftVisualConfig.core}
                            hexCode={coreHexCode}
                            alpha={100}
                            showAlpha={false}
                            options={PRISMA_ORB_CORE_OPTIONS}
                            optionsAriaLabel="Colores de núcleo sugeridos"
                            optionAriaLabel={(color) => `Usar color de núcleo ${color}`}
                            invalid={!HEX_CODE_PATTERN.test(coreHexCode)}
                            swatchAriaLabel="Color del núcleo"
                            hexInputAriaLabel="Hex del núcleo"
                            onColorChange={(value) => updateColor('core', value)}
                            onHexCodeChange={(value) => updateHexCode('core', value)}
                            onHexCodeBlur={() => restoreInvalidHexCode('core')}
                            onAlphaChange={() => undefined}
                        />
                        <DockColorField
                            label="Color del halo"
                            color={draftVisualConfig.glow}
                            hexCode={glowHexCode}
                            alpha={100}
                            showAlpha={false}
                            options={PRISMA_ORB_GLOW_OPTIONS}
                            optionsAriaLabel="Colores de halo sugeridos"
                            optionAriaLabel={(color) => `Usar color de halo ${color}`}
                            invalid={!HEX_CODE_PATTERN.test(glowHexCode)}
                            swatchAriaLabel="Color del halo"
                            hexInputAriaLabel="Hex del halo"
                            onColorChange={(value) => updateColor('glow', value)}
                            onHexCodeChange={(value) => updateHexCode('glow', value)}
                            onHexCodeBlur={() => restoreInvalidHexCode('glow')}
                            onAlphaChange={() => undefined}
                        />
                        <DockInlineControlRow label="Fondo de la vista previa" labelClassName="w-auto">
                            <AdminSelect
                                ariaLabel="Fondo de la vista previa"
                                value={backdrop}
                                options={PREVIEW_BACKDROP_OPTIONS}
                                onChange={(value) => setBackdrop(value as PreviewBackdrop)}
                            />
                        </DockInlineControlRow>
                        {showSlider ? (
                            <DockSliderField
                                label="Penetración de haces"
                                ariaLabel="Penetración de haces"
                                value={draftVisualConfig.rays}
                                {...PRISMA_ORB_VISUAL_LIMITS.rays}
                                onChange={(value) => updateVisualConfig('rays', value)}
                            />
                        ) : null}
                    </div>
                </div>
            </section>
        </div>
    );
}
