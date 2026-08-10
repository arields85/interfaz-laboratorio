import { useEffect, useState } from 'react';

import type {
    PrismaRoboticVoiceConfig,
    PrismaVoiceConfig,
    PrismaVoicePreset,
} from '../../domain/prismaVoiceConfig';
import AdminNumberInput from './AdminNumberInput';
import AdminSelect from './AdminSelect';
import DockDetailDisclosure from './DockDetailDisclosure';
import DockInlineControlRow from './DockInlineControlRow';
import DockSliderField from './DockSliderField';
import DockToggleField from './DockToggleField';
import {
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
    ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS,
} from './adminSidebarStyles';

interface PrismaVoiceEffectsSettingsProps {
    config: PrismaVoiceConfig;
    onFieldChange: <Key extends Exclude<keyof PrismaVoiceConfig, 'robotic'>>(
        key: Key,
        value: PrismaVoiceConfig[Key],
    ) => void;
    onRoboticFieldChange: <Key extends keyof PrismaRoboticVoiceConfig>(
        key: Key,
        value: PrismaRoboticVoiceConfig[Key],
    ) => void;
    onValidityChange: (valid: boolean) => void;
    onEdit: () => void;
}

interface AdvancedFieldDefinition {
    key: keyof PrismaRoboticVoiceConfig;
    label: string;
    step: number;
    constraint: 'positive' | 'nonNegative' | 'positiveInteger';
}

const PRESET_OPTIONS = [
    { value: 'clean', label: 'Limpio' },
    { value: 'robotic_medium_light', label: 'Robótico suave' },
] satisfies Array<{ value: PrismaVoicePreset; label: string }>;

const ADVANCED_FIELDS: AdvancedFieldDefinition[] = [
    { key: 'modulationHz', label: 'Frecuencia de modulación', step: 1, constraint: 'positive' },
    { key: 'baseGain', label: 'Ganancia base', step: 0.01, constraint: 'nonNegative' },
    { key: 'modulationDepth', label: 'Profundidad de modulación', step: 0.01, constraint: 'nonNegative' },
    { key: 'quantizationSteps', label: 'Pasos de cuantización', step: 1, constraint: 'positiveInteger' },
    { key: 'metallicHz', label: 'Frecuencia componente metálico', step: 1, constraint: 'positive' },
    { key: 'metallicMix', label: 'Intensidad componente metálico', step: 0.01, constraint: 'nonNegative' },
    { key: 'echo1DelayMs', label: 'Retardo eco 1', step: 1, constraint: 'positive' },
    { key: 'echo1Gain', label: 'Ganancia eco 1', step: 0.01, constraint: 'nonNegative' },
    { key: 'echo2DelayMs', label: 'Retardo eco 2', step: 1, constraint: 'positive' },
    { key: 'echo2Gain', label: 'Ganancia eco 2', step: 0.01, constraint: 'nonNegative' },
    { key: 'normalizationTarget', label: 'Pico objetivo de normalización', step: 1, constraint: 'positive' },
    { key: 'normalizationMaxGain', label: 'Ganancia máxima de normalización', step: 0.1, constraint: 'positive' },
];

function isValidAdvancedValue(value: string, constraint: AdvancedFieldDefinition['constraint']): boolean {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) {
        return false;
    }
    if (constraint === 'positiveInteger') {
        return Number.isInteger(parsedValue) && parsedValue > 0;
    }
    return constraint === 'positive' ? parsedValue > 0 : parsedValue >= 0;
}

export default function PrismaVoiceEffectsSettings({
    config,
    onFieldChange,
    onRoboticFieldChange,
    onValidityChange,
    onEdit,
}: PrismaVoiceEffectsSettingsProps) {
    const [advancedValues, setAdvancedValues] = useState<Record<keyof PrismaRoboticVoiceConfig, string>>(
        () => Object.fromEntries(
            ADVANCED_FIELDS.map(({ key }) => [key, String(config.robotic[key])]),
        ) as Record<keyof PrismaRoboticVoiceConfig, string>,
    );
    const invalidFields = ADVANCED_FIELDS.filter(
        ({ key, constraint }) => !isValidAdvancedValue(advancedValues[key], constraint),
    );

    useEffect(() => {
        onValidityChange(invalidFields.length === 0);
    }, [invalidFields.length, onValidityChange]);

    const updateAdvancedValue = (definition: AdvancedFieldDefinition, value: string) => {
        onEdit();
        setAdvancedValues((current) => ({ ...current, [definition.key]: value }));
        if (isValidAdvancedValue(value, definition.constraint)) {
            onRoboticFieldChange(definition.key, Number(value));
        }
    };

    return (
        <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
            <h3 className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>Efectos de voz de Prisma</h3>

            <div className="grid gap-4 md:grid-cols-2">
                <DockToggleField
                    label="Efecto robótico"
                    checked={config.effectEnabled}
                    onChange={(checked) => {
                        onEdit();
                        onFieldChange('effectEnabled', checked);
                    }}
                    labelClassName="w-auto"
                />
                <DockInlineControlRow label="Preset" labelClassName="w-auto">
                    <AdminSelect
                        ariaLabel="Preset"
                        value={config.preset}
                        options={PRESET_OPTIONS}
                        onChange={(value) => {
                            onEdit();
                            onFieldChange('preset', value as PrismaVoicePreset);
                        }}
                    />
                </DockInlineControlRow>
                <DockSliderField
                    label="Intensidad del efecto robótico"
                    ariaLabel="Intensidad del efecto robótico"
                    value={config.effectIntensity}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(value) => {
                        onEdit();
                        onFieldChange('effectIntensity', value);
                    }}
                    className="md:col-span-2"
                />
            </div>

            <DockDetailDisclosure summary="Avanzado" className="mt-4">
                <div className="grid gap-3 md:grid-cols-2">
                    {ADVANCED_FIELDS.map((definition) => {
                        const invalid = !isValidAdvancedValue(
                            advancedValues[definition.key],
                            definition.constraint,
                        );

                        return (
                            <DockInlineControlRow
                                key={definition.key}
                                label={definition.label}
                                labelClassName="w-auto"
                            >
                                <AdminNumberInput
                                    ariaLabel={definition.label}
                                    ariaInvalid={invalid}
                                    value={advancedValues[definition.key]}
                                    step={definition.step}
                                    commitOnBlur
                                    className={ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS}
                                    onChange={(value) => updateAdvancedValue(definition, value)}
                                />
                            </DockInlineControlRow>
                        );
                    })}
                </div>
            </DockDetailDisclosure>
        </section>
    );
}
