import { useCallback, useState } from 'react';
import { RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { useShaderParamsStore, SHADER_SECTIONS } from '../../store/shaderParams.store';
import type {
    ControlDef,
    ShaderControlSlot,
    ShaderGroupControlCapability,
    ShaderParams,
    SectionDef,
} from '../../store/shaderParams.store';
import HoverTooltip from '../ui/HoverTooltip';

// =============================================================================
// BackgroundSettingsTab
// Controles del fondo WebGL EventHorizon, migrados desde el tweaks panel.
// Lee/escribe al Zustand store que EventHorizonBackground consume en su frame loop.
// =============================================================================

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            onClick={() => onChange(!value)}
            className={`relative w-8 h-[18px] rounded-full border transition-colors ${
                value
                    ? 'bg-admin-accent/20 border-admin-accent/50'
                    : 'bg-white/8 border-white/10'
            }`}
        >
            <span
                className={`absolute top-[2px] left-[2px] w-3 h-3 rounded-full transition-all ${
                    value
                        ? 'translate-x-3.5 bg-admin-accent shadow-[0_0_6px_var(--color-admin-accent)]'
                        : 'bg-industrial-muted'
                }`}
            />
        </button>
    );
}

const FIRST_POSITION_CONTROL_ORDER: ShaderControlSlot[] = [
    'tone',
    'saturation',
    'brightness',
    'contrast',
    'intensity',
    'alpha',
];

const SLOT_LABELS: Record<ShaderControlSlot, string> = {
    tone: 'Tone',
    saturation: 'Saturation',
    brightness: 'Brightness',
    contrast: 'Contrast',
    intensity: 'Intensity',
    alpha: 'Alpha',
    blend: 'Blend Mode',
};

const DEFAULT_SLOT_SLIDER_CONFIG: Record<
    Exclude<ShaderControlSlot, 'blend'>,
    Pick<ControlDef, 'min' | 'max' | 'step'>
> = {
    tone: { min: 0, max: 1, step: 0.01 },
    saturation: { min: 0, max: 2, step: 0.02 },
    brightness: { min: 0, max: 2, step: 0.02 },
    contrast: { min: 0, max: 2, step: 0.02 },
    intensity: { min: 0, max: 2.5, step: 0.01 },
    alpha: { min: 0, max: 1, step: 0.01 },
};

const INITIAL_COLLAPSED_SECTIONS = Object.fromEntries(
    SHADER_SECTIONS.map((section) => [section.title, true]),
) as Record<string, boolean>;

function isParamCapability(
    capability: ShaderGroupControlCapability,
): capability is Extract<ShaderGroupControlCapability, { state: 'supported'; storage: 'param' }> {
    return capability.state === 'supported' && capability.storage === 'param';
}

function isAliasedCapability(
    capability: ShaderGroupControlCapability,
): capability is Extract<ShaderGroupControlCapability, { state: 'aliased' }> {
    return capability.state === 'aliased';
}

function getDisplayedControls(section: SectionDef): ControlDef[] {
    const consumedKeys = new Set<keyof ShaderParams>();

    for (const capability of Object.values(section.capabilities)) {
        if (isParamCapability(capability) || isAliasedCapability(capability)) {
            consumedKeys.add(capability.key);
        }
    }

    return section.controls.filter((control) => !consumedKeys.has(control.key));
}

function getSliderPrecision(step: number): number {
    const fractionalDigits = step.toString().split('.')[1];

    return fractionalDigits?.length ?? 0;
}

function getCapabilitySliderConfig(
    section: SectionDef,
    capability: Extract<
        ShaderGroupControlCapability,
        { state: 'supported'; storage: 'param' } | { state: 'aliased' }
    >,
): Pick<ControlDef, 'min' | 'max' | 'step'> {
    const canonicalControl = section.controls.find((control) => control.key === capability.key);

    if (canonicalControl) {
        return {
            min: canonicalControl.min,
            max: canonicalControl.max,
            step: canonicalControl.step,
        };
    }

    return DEFAULT_SLOT_SLIDER_CONFIG[capability.slot];
}

function ValueSlider({
    ariaLabel,
    label,
    min,
    max,
    step,
    value,
    onChange,
}: {
    ariaLabel: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
}) {
    const precision = getSliderPrecision(step);

    return (
        <div className="space-y-0.5">
            <div className="flex justify-between">
                <span className="text-industrial-muted">{label}</span>
                <span className="font-mono text-industrial-muted/70 tabular-nums">
                    {value.toFixed(precision)}
                </span>
            </div>
            <input
                aria-label={ariaLabel}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-1 appearance-none rounded-full bg-white/8 accent-admin-accent cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-admin-accent [&::-webkit-slider-thumb]:shadow-[0_0_6px_var(--color-admin-accent)]"
            />
        </div>
    );
}

function renderCapabilityControl({
    section,
    slot,
    params,
    updateParam,
}: {
    section: SectionDef;
    slot: ShaderControlSlot;
    params: ShaderParams;
    updateParam: (key: keyof ShaderParams, value: number) => void;
}) {
    const capability = section.capabilities[slot];

    if (capability.state === 'omitted' || capability.state === 'disabled') {
        return null;
    }

    if (capability.state === 'supported' && capability.storage === 'blendMode') {
        return null;
    }

    const label = SLOT_LABELS[slot];
    const key = capability.key;
    const sliderConfig = getCapabilitySliderConfig(section, capability);

    return (
        <ValueSlider
            key={slot}
            ariaLabel={`${section.title} ${label.toLowerCase()}`}
            label={label}
            min={sliderConfig.min}
            max={sliderConfig.max}
            step={sliderConfig.step}
            value={params[key]}
            onChange={(value) => updateParam(key, value)}
        />
    );
}

function renderLegacyControl({
    sectionTitle,
    control,
    value,
    onChange,
}: {
    sectionTitle: string;
    control: ControlDef;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <ValueSlider
            key={control.key}
            ariaLabel={`${sectionTitle} ${control.label.toLowerCase()}`}
            label={control.label}
            min={control.min}
            max={control.max}
            step={control.step}
            value={value}
            onChange={onChange}
        />
    );
}

export default function BackgroundSettingsTab() {
    const params = useShaderParamsStore((s) => s.params);
    const updateParam = useShaderParamsStore((s) => s.updateParam);
    const resetAll = useShaderParamsStore((s) => s.resetAll);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(INITIAL_COLLAPSED_SECTIONS);

    const toggleSection = useCallback((title: string) => {
        setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
    }, []);

    return (
        <div>
            {/* Header with reset */}
            <div className="mb-3 flex items-center justify-between">
                <span className="uppercase text-industrial-muted">
                    Fondo Animado
                </span>
                <HoverTooltip label="Restaurar valores por defecto" position="bottom" className="flex">
                    <button
                        type="button"
                        aria-label="Restaurar valores por defecto"
                        onClick={resetAll}
                        className="flex items-center gap-1.5 uppercase text-industrial-muted hover:text-admin-accent transition-colors"
                    >
                        <RotateCcw size={12} />
                        Reset
                    </button>
                </HoverTooltip>
            </div>

            <div className="space-y-1">
                {SHADER_SECTIONS.map((section) => {
                    const isCollapsed = collapsed[section.title];
                    const isEnabled = section.toggleKey
                        ? params[section.toggleKey] > 0.5
                        : true;
                    const firstPositionControls = FIRST_POSITION_CONTROL_ORDER
                        .map((slot) =>
                            renderCapabilityControl({
                                section,
                                slot,
                                params,
                                updateParam,
                            }),
                        )
                        .filter(Boolean);
                    const displayedControls = getDisplayedControls(section);
                    const hasVisibleControls = firstPositionControls.length > 0 || displayedControls.length > 0;

                    return (
                        <div key={section.title} className="rounded-lg">
                            {/* Section header */}
                            <div className="flex items-center gap-2 px-2 py-1.5">
                                <button
                                    type="button"
                                    onClick={() => toggleSection(section.title)}
                                    className="text-industrial-muted hover:text-industrial-text transition-colors"
                                >
                                    {isCollapsed ? (
                                        <ChevronRight size={14} />
                                    ) : (
                                        <ChevronDown size={14} />
                                    )}
                                </button>
                                <span
                                    className={`flex-1 uppercase cursor-pointer ${
                                        isEnabled
                                            ? 'text-industrial-text'
                                            : 'text-industrial-muted'
                                    }`}
                                    onClick={() => toggleSection(section.title)}
                                >
                                    {section.title}
                                </span>
                                {section.toggleKey && (
                                    <Toggle
                                        value={isEnabled}
                                        onChange={(v) =>
                                            updateParam(
                                                section.toggleKey as keyof ShaderParams,
                                                v ? 1 : 0,
                                            )
                                        }
                                    />
                                )}
                            </div>

                            {/* Section body */}
                            {!isCollapsed && hasVisibleControls && (
                                <div
                                    className={`px-2 pb-2 space-y-2 ${
                                        !isEnabled
                                            ? 'opacity-30 pointer-events-none'
                                            : ''
                                    }`}
                                >
                                    {firstPositionControls}
                                    {displayedControls.map((control) =>
                                        renderLegacyControl({
                                            sectionTitle: section.title,
                                            control,
                                            value: params[control.key],
                                            onChange: (value) => updateParam(control.key, value),
                                        }),
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
