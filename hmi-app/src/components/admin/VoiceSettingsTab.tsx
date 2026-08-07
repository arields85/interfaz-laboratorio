import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import {
    DATA_DEFAULT_VOICE_ENDPOINT,
    getSavedDataVoiceEndpoint,
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
import type { PrismaOrbVisualConfig } from '../../domain/voice.types';
import PrismaOrb from '../PrismaOrb';
import AdminSelect from './AdminSelect';
import DockColorField from './DockColorField';
import DockInlineControlRow from './DockInlineControlRow';
import DockSliderField from './DockSliderField';
import DockToggleField from './DockToggleField';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';

interface VoiceSettingsTabProps {
    onDirtyChange?: (dirty: boolean) => void;
    saveRef?: { current: (() => void) | null };
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

export default function VoiceSettingsTab({ onDirtyChange, saveRef }: VoiceSettingsTabProps) {
    const [initialSettings] = useState(() => ({
        endpoint: getSavedDataVoiceEndpoint() ?? DATA_DEFAULT_VOICE_ENDPOINT,
        ttsServiceUrl: readPrismaVoiceTtsServiceUrl(),
        visualConfig: readPrismaOrbVisualConfig(),
    }));
    const persistedSettingsRef = useRef(initialSettings);
    const [draftEndpoint, setDraftEndpoint] = useState(initialSettings.endpoint);
    const [draftTtsServiceUrl, setDraftTtsServiceUrl] = useState(initialSettings.ttsServiceUrl);
    const [draftVisualConfig, setDraftVisualConfig] = useState(initialSettings.visualConfig);
    const [coreHexCode, setCoreHexCode] = useState(initialSettings.visualConfig.core.slice(1));
    const [glowHexCode, setGlowHexCode] = useState(initialSettings.visualConfig.glow.slice(1));
    const [showSlider, setShowSlider] = useState(true);
    const [autoDemo, setAutoDemo] = useState(true);
    const [speaking, setSpeaking] = useState(false);
    const [demoSpeaking, setDemoSpeaking] = useState(false);
    const [backdrop, setBackdrop] = useState<PreviewBackdrop>('HMI preview');
    const autoDemoRef = useRef(autoDemo);
    const speakingRef = useRef(speaking);
    const demoSpeakingRef = useRef(demoSpeaking);

    useEffect(() => {
        autoDemoRef.current = autoDemo;
        speakingRef.current = speaking;
    }, [autoDemo, speaking]);

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
            || draftTtsServiceUrl !== persisted.ttsServiceUrl
            || !visualConfigsEqual(draftVisualConfig, persisted.visualConfig),
        );
    }, [draftEndpoint, draftTtsServiceUrl, draftVisualConfig, onDirtyChange]);

    const handleSave = useCallback(() => {
        const savedEndpoint = draftEndpoint.trim();
        if (savedEndpoint !== persistedSettingsRef.current.endpoint) {
            saveDataVoiceEndpoint(savedEndpoint);
        }
        const savedTtsServiceUrl = savePrismaVoiceTtsServiceUrl(draftTtsServiceUrl);
        const savedVisualConfig = savePrismaOrbVisualConfig(draftVisualConfig);
        persistedSettingsRef.current = {
            endpoint: savedEndpoint,
            ttsServiceUrl: savedTtsServiceUrl,
            visualConfig: savedVisualConfig,
        };
        setDraftEndpoint(savedEndpoint);
        setDraftTtsServiceUrl(savedTtsServiceUrl);
        setDraftVisualConfig(savedVisualConfig);
        onDirtyChange?.(false);
    }, [draftEndpoint, draftTtsServiceUrl, draftVisualConfig, onDirtyChange]);

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
                <label htmlFor="voice-settings-endpoint" className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Endpoint Voz HMI
                </label>
                <input
                    id="voice-settings-endpoint"
                    value={draftEndpoint}
                    onChange={(event) => setDraftEndpoint(event.target.value)}
                    placeholder={DATA_DEFAULT_VOICE_ENDPOINT}
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Ruta del endpoint de respuestas del asistente de voz. Dejar vacío para deshabilitar el canal de voz de la HMI.
                </p>
            </section>

            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <label htmlFor="voice-settings-tts-service-url" className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    URL Servicio Voz Prisma
                </label>
                <input
                    id="voice-settings-tts-service-url"
                    value={draftTtsServiceUrl}
                    onChange={(event) => setDraftTtsServiceUrl(event.target.value)}
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    URL del servicio TTS utilizado por Prisma para generar la voz Leda. Dejar vacío para deshabilitar la reproducción de voz en la interfaz.
                </p>
            </section>

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
