import {
    LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX,
    LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN,
    LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP,
    type LedaVoicePlaybackBufferConfig,
    type LedaVoicePlaybackBufferMode,
} from '../../domain/ledaVoiceConfig';
import AdminSelect from './AdminSelect';
import DockInlineControlRow from './DockInlineControlRow';
import DockSliderField from './DockSliderField';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';

interface LedaVoicePlaybackBufferSettingsProps {
    config: LedaVoicePlaybackBufferConfig;
    onFieldChange: <Key extends keyof LedaVoicePlaybackBufferConfig>(
        key: Key,
        value: LedaVoicePlaybackBufferConfig[Key],
    ) => void;
    onEdit: () => void;
}

const MODE_OPTIONS = [
    { value: 'automatic', label: 'Automático' },
    { value: 'manual', label: 'Manual' },
] satisfies Array<{ value: LedaVoicePlaybackBufferMode; label: string }>;

// Design item 4 (odd/tasks/leda-adaptive-voice-buffer.md): Automático adapts
// per answer from the T2/T3 estimator; Manual always uses the configured
// seconds. Copy approved by the user (2026-09-24).
const MODE_HINTS: Record<LedaVoicePlaybackBufferMode, string> = {
    automatic: 'La HMI mide cada respuesta y ajusta sola la espera antes de hablar, '
        + 'para evitar cortes con la red y el equipo actuales.',
    manual: 'Se usa siempre la espera fija que usted defina. Más espera reduce los '
        + 'cortes, pero Leda empieza a hablar más tarde.',
};

export default function LedaVoicePlaybackBufferSettings({
    config,
    onFieldChange,
    onEdit,
}: LedaVoicePlaybackBufferSettingsProps) {
    return (
        <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
            <h3 className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>Buffer de audio</h3>

            <div className="flex flex-col gap-3">
                <DockInlineControlRow label="Modo" labelClassName="w-auto">
                    <AdminSelect
                        ariaLabel="Modo del buffer de audio"
                        value={config.mode}
                        options={MODE_OPTIONS}
                        onChange={(value) => {
                            onEdit();
                            onFieldChange('mode', value as LedaVoicePlaybackBufferMode);
                        }}
                    />
                </DockInlineControlRow>

                <p className={`text-xs ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    {MODE_HINTS[config.mode]}
                </p>

                {config.mode === 'manual' ? (
                    <DockSliderField
                        label="Espera manual (s)"
                        ariaLabel="Espera manual en segundos"
                        value={config.manualSeconds}
                        min={LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN}
                        max={LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX}
                        step={LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP}
                        onChange={(value) => {
                            onEdit();
                            onFieldChange('manualSeconds', value);
                        }}
                    />
                ) : null}
            </div>
        </section>
    );
}
