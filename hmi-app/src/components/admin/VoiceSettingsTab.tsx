import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import {
    PRISMA_ORB_CORE_OPTIONS,
    PRISMA_ORB_GLOW_OPTIONS,
    PRISMA_ORB_VISUAL_LIMITS,
    readPrismaOrbVisualConfig,
    savePrismaOrbVisualConfig,
} from '../../config/prismaOrb.config';
import {
    clonePrismaVoiceConfig,
    validatePrismaVoiceConfig,
} from '../../domain/prismaVoiceConfig';
import type { PrismaOrbVisualConfig } from '../../domain/voice.types';
import { usePrismaVoiceConfigDraft } from '../../hooks/usePrismaVoiceConfigDraft';
import { usePrismaVoiceConfig } from '../../queries/usePrismaVoiceConfig';
import { useUpdatePrismaVoiceConfig } from '../../queries/useUpdatePrismaVoiceConfig';
import PrismaOrb from '../PrismaOrb';
import AdminSelect from './AdminSelect';
import DockColorField from './DockColorField';
import DockInlineControlRow from './DockInlineControlRow';
import DockSliderField from './DockSliderField';
import DockToggleField from './DockToggleField';
import PrismaVoiceEffectsSettings from './PrismaVoiceEffectsSettings';
import VoiceCredentialSettings from './VoiceCredentialSettings';
import {
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';
import type { SaveStatus } from './saveStatus';

interface VoiceSettingsTabProps {
    credentialControlsActive?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
    onSaveStatusChange?: (status: SaveStatus) => void;
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

function visualConfigsEqual(left: PrismaOrbVisualConfig, right: PrismaOrbVisualConfig): boolean {
    return left.rays === right.rays
        && left.speed === right.speed
        && left.intensity === right.intensity
        && left.size === right.size
        && left.core === right.core
        && left.glow === right.glow;
}

export default function VoiceSettingsTab({
    credentialControlsActive = true,
    onDirtyChange,
    onSaveStatusChange,
    saveRef,
}: VoiceSettingsTabProps) {
    const voiceConfigDraft = usePrismaVoiceConfigDraft();
    const updateVoiceConfig = useUpdatePrismaVoiceConfig();
    const [initialSettings] = useState(() => {
        return {
            visualConfig: readPrismaOrbVisualConfig(),
        };
    });
    const remoteVoiceConfig = usePrismaVoiceConfig();
    const persistedSettingsRef = useRef({
        visualConfig: initialSettings.visualConfig,
    });
    const [draftVisualConfig, setDraftVisualConfig] = useState(initialSettings.visualConfig);
    const [coreHexCode, setCoreHexCode] = useState(initialSettings.visualConfig.core.slice(1));
    const [glowHexCode, setGlowHexCode] = useState(initialSettings.visualConfig.glow.slice(1));
    const [showSlider, setShowSlider] = useState(true);
    const [autoDemo, setAutoDemo] = useState(true);
    const [speaking, setSpeaking] = useState(false);
    const [demoSpeaking, setDemoSpeaking] = useState(false);
    const [backdrop, setBackdrop] = useState<PreviewBackdrop>('HMI preview');
    const [voiceConfigValid, setVoiceConfigValid] = useState(true);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
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
        const hasUnsavedChanges = !visualConfigsEqual(draftVisualConfig, persisted.visualConfig)
            || voiceConfigDraft.isDirty
            || !voiceConfigValid;
        onDirtyChange?.(
            hasUnsavedChanges
            || saveStatus === 'saving'
            || saveStatus === 'error',
        );
    }, [
        draftVisualConfig,
        onDirtyChange,
        saveStatus,
        voiceConfigDraft.isDirty,
        voiceConfigValid,
    ]);

    useEffect(() => {
        onSaveStatusChange?.(saveStatus);
    }, [onSaveStatusChange, saveStatus]);

    const handleSave = useCallback((): Promise<void> => {
        if (saveInFlightRef.current) {
            return saveInFlightRef.current;
        }

        const voiceConfigSnapshot = clonePrismaVoiceConfig(voiceConfigDraft.draft);
        const validation = validatePrismaVoiceConfig(voiceConfigSnapshot);
        if (!voiceConfigValidRef.current || !validation.valid) {
            setSaveStatus('error');
            return Promise.resolve();
        }

        const savedVisualConfig = savePrismaOrbVisualConfig(draftVisualConfig);
        persistedSettingsRef.current = {
            visualConfig: savedVisualConfig,
        };
        setDraftVisualConfig(savedVisualConfig);
        const sentEditGeneration = editGenerationRef.current;
        const sentEffectEditGeneration = effectEditGenerationRef.current;
        setSaveStatus('saving');

        const request = (async () => {
            try {
                const remoteConfig = await updateVoiceConfig.mutateAsync(validation.value);
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
            <VoiceCredentialSettings active={credentialControlsActive} />

            {remoteVoiceConfig.error ? (
                <p className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4 text-xs text-industrial-muted`} aria-live="polite">
                    No se pudo cargar la configuración de Prisma. Se mantienen los valores actuales.
                </p>
            ) : null}

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
