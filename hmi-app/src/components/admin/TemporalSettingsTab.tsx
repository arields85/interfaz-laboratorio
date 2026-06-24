import { useEffect, useMemo, useState } from 'react';

import {
    type TemporalSettingsConfig,
} from '../../domain/admin.types';
import {
    readTemporalSettingsConfig,
    saveTemporalSettingsConfig,
} from '../../config/temporalSettings.config';
import { ALL_WEEKDAY_KEYS, normalizeWeekdays, validateWeeklyShiftSchedule } from '../../utils/weeklyShiftSchedule';
import type { WeekdayKey } from '../../domain/admin.types';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
} from './adminSidebarStyles';

type TemporalSettingsTabProps = {
    onDirtyChange?: (dirty: boolean) => void;
    saveRef?: { current: (() => void) | null };
};

type ShiftDraft = {
    id: string;
    label: string;
    start: string;
    end: string;
    weekdays: WeekdayKey[];
};

type TemporalSettingsDraft = {
    plantTimezone: string;
    shifts: ShiftDraft[];
};

const SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TEMPORAL_SETTINGS_ACTION_BUTTON_CLS = 'rounded-md px-3 py-2 text-sm transition-colors admin-accent-ghost';
const TEMPORAL_SETTINGS_SHIFT_CARD_CLS = 'rounded-md border border-industrial-border bg-industrial-hover p-3';
const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
    mon: 'Lunes',
    tue: 'Martes',
    wed: 'Miercoles',
    thu: 'Jueves',
    fri: 'Viernes',
    sat: 'Sabado',
    sun: 'Domingo',
};

function toDraft(config: TemporalSettingsConfig): TemporalSettingsDraft {
    return {
        plantTimezone: config.plantTimezone ?? '',
        shifts: config.shifts.map((shift) => ({ ...shift, weekdays: normalizeWeekdays(shift.weekdays) })),
    };
}

function toConfig(draft: TemporalSettingsDraft): TemporalSettingsConfig {
    return {
        plantTimezone: draft.plantTimezone.trim() || null,
        shifts: draft.shifts.map((shift) => ({
            id: shift.id,
            label: shift.label,
            start: shift.start,
            end: shift.end,
            weekdays: [...shift.weekdays],
        })),
    };
}

function createShiftDraft(index: number): ShiftDraft {
    return {
        id: `shift-${Date.now()}-${index}`,
        label: '',
        start: '06:00',
        end: '14:00',
        weekdays: [...ALL_WEEKDAY_KEYS],
    };
}

export default function TemporalSettingsTab({ onDirtyChange, saveRef }: TemporalSettingsTabProps) {
    const [draft, setDraft] = useState<TemporalSettingsDraft>(() => toDraft(readTemporalSettingsConfig()));
    const [saveError, setSaveError] = useState<string | null>(null);

    const normalizedDraft = useMemo(() => toConfig(draft), [draft]);

    const updateShift = (index: number, field: keyof ShiftDraft, value: string) => {
        setSaveError(null);
        setDraft((currentDraft) => ({
            ...currentDraft,
            shifts: currentDraft.shifts.map((shift, currentIndex) => (
                currentIndex === index
                    ? { ...shift, [field]: value }
                    : shift
            )),
        }));
        onDirtyChange?.(true);
    };

    const handleAddShift = () => {
        setSaveError(null);
        setDraft((currentDraft) => ({
            ...currentDraft,
            shifts: [...currentDraft.shifts, createShiftDraft(currentDraft.shifts.length + 1)],
        }));
        onDirtyChange?.(true);
    };

    const handleRemoveShift = (index: number) => {
        setSaveError(null);
        setDraft((currentDraft) => ({
            ...currentDraft,
            shifts: currentDraft.shifts.filter((_, currentIndex) => currentIndex !== index),
        }));
        onDirtyChange?.(true);
    };

    const toggleWeekday = (index: number, weekday: WeekdayKey) => {
        setSaveError(null);
        setDraft((currentDraft) => ({
            ...currentDraft,
            shifts: currentDraft.shifts.map((shift, currentIndex) => {
                if (currentIndex !== index) {
                    return shift;
                }

                return {
                    ...shift,
                    weekdays: shift.weekdays.includes(weekday)
                        ? shift.weekdays.filter((entry) => entry !== weekday)
                        : [...shift.weekdays, weekday].sort((left, right) => ALL_WEEKDAY_KEYS.indexOf(left) - ALL_WEEKDAY_KEYS.indexOf(right)),
                };
            }),
        }));
        onDirtyChange?.(true);
    };

    const moveShift = (index: number, direction: -1 | 1) => {
        const nextIndex = index + direction;

        setSaveError(null);
        setDraft((currentDraft) => {
            if (nextIndex < 0 || nextIndex >= currentDraft.shifts.length) {
                return currentDraft;
            }

            const shifts = [...currentDraft.shifts];
            const [shift] = shifts.splice(index, 1);

            if (!shift) {
                return currentDraft;
            }

            shifts.splice(nextIndex, 0, shift);
            return { ...currentDraft, shifts };
        });
        onDirtyChange?.(true);
    };

    useEffect(() => {
        if (!saveRef) {
            return;
        }

        saveRef.current = () => {
            const validationError = validateTemporalSettingsDraft(draft);

            if (validationError) {
                setSaveError(validationError);
                return;
            }

            const saved = saveTemporalSettingsConfig(normalizedDraft);

            if (!saved.ok) {
                setSaveError(saved.error.message === 'Each shift must apply to at least one weekday.'
                    ? 'Selecciona al menos un dia para cada turno antes de guardar.'
                    : saved.error.message === 'Shift windows cannot overlap after weekly expansion.'
                        ? 'Los turnos configurados no pueden superponerse en la semana.'
                        : 'No se pudieron guardar los ajustes temporales.');
                return;
            }

            setSaveError(null);
            setDraft(toDraft(saved.config));
            onDirtyChange?.(false);
        };

        return () => {
            saveRef.current = null;
        };
    }, [draft, normalizedDraft, onDirtyChange, saveRef]);

    return (
        <div className="space-y-4">
            <header>
                <h4 className="uppercase text-industrial-text">Ajustes</h4>
                <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Configura reglas temporales de visualizacion sin emitir escrituras operativas.
                </p>
                {saveError ? (
                    <p role="alert" className="mt-2 text-sm text-status-critical">
                        {saveError}
                    </p>
                ) : null}
            </header>

            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <label htmlFor="temporal-settings-timezone" className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                    Timezone de planta
                </label>
                <input
                    id="temporal-settings-timezone"
                    value={draft.plantTimezone}
                    onChange={(event) => {
                        setSaveError(null);
                        setDraft((currentDraft) => ({
                            ...currentDraft,
                            plantTimezone: event.target.value,
                        }));
                        onDirtyChange?.(true);
                    }}
                    placeholder="America/Argentina/Buenos_Aires"
                    className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                />
                <p className={`mt-1.5 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                    Se usa para visualizacion cuando el backend no informa timezone propio.
                </p>
            </section>

            <section className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h5 className="uppercase text-industrial-text">Turnos</h5>
                        <p className={`mt-1 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                            Define turnos globales, incluyendo cruces de medianoche.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={handleAddShift}
                        className={TEMPORAL_SETTINGS_ACTION_BUTTON_CLS}
                    >
                        Agregar turno
                    </button>
                </div>

                <div className="mt-4 space-y-4">
                    {draft.shifts.length === 0 ? (
                        <p className={ADMIN_SIDEBAR_HINT_CLS}>Todavia no hay turnos configurados.</p>
                    ) : draft.shifts.map((shift, index) => {
                        const rowNumber = index + 1;

                        return (
                            <div key={shift.id} className={TEMPORAL_SETTINGS_SHIFT_CARD_CLS}>
                                <div className="grid gap-3 md:grid-cols-3">
                                    <div>
                                        <label htmlFor={`shift-label-${shift.id}`} className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                                            {`Nombre del turno ${rowNumber}`}
                                        </label>
                                        <input
                                            id={`shift-label-${shift.id}`}
                                            value={shift.label}
                                            onChange={(event) => updateShift(index, 'label', event.target.value)}
                                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor={`shift-start-${shift.id}`} className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                                            {`Inicio del turno ${rowNumber}`}
                                        </label>
                                        <input
                                            id={`shift-start-${shift.id}`}
                                            type="time"
                                            value={shift.start}
                                            onChange={(event) => updateShift(index, 'start', event.target.value)}
                                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor={`shift-end-${shift.id}`} className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>
                                            {`Fin del turno ${rowNumber}`}
                                        </label>
                                        <input
                                            id={`shift-end-${shift.id}`}
                                            type="time"
                                            value={shift.end}
                                            onChange={(event) => updateShift(index, 'end', event.target.value)}
                                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                                        />
                                    </div>
                                </div>

                                <div className="mt-3 space-y-2">
                                    <p className={ADMIN_SIDEBAR_LABEL_CLS}>Dias de inicio</p>
                                    <div className="flex flex-wrap gap-3">
                                        {ALL_WEEKDAY_KEYS.map((weekday) => (
                                            <label key={`${shift.id}-${weekday}`} className="flex items-center gap-2 text-sm text-industrial-text">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`${WEEKDAY_LABELS[weekday]} turno ${rowNumber}`}
                                                    checked={shift.weekdays.includes(weekday)}
                                                    onChange={() => toggleWeekday(index, weekday)}
                                                />
                                                <span>{WEEKDAY_LABELS[weekday]}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-3 flex items-center justify-between gap-3">
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => moveShift(index, -1)}
                                            disabled={index === 0}
                                            className="text-sm text-industrial-muted transition-colors hover:text-industrial-text disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {`Mover arriba turno ${rowNumber}`}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveShift(index, 1)}
                                            disabled={index === draft.shifts.length - 1}
                                            className="text-sm text-industrial-muted transition-colors hover:text-industrial-text disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {`Mover abajo turno ${rowNumber}`}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveShift(index)}
                                        className="text-sm text-industrial-muted transition-colors hover:text-industrial-text"
                                    >
                                        Eliminar turno
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}

function validateTemporalSettingsDraft(draft: TemporalSettingsDraft): string | null {
    const hasInvalidShift = draft.shifts.some((shift) => {
        return shift.label.trim() === ''
            || !SHIFT_TIME_PATTERN.test(shift.start)
            || !SHIFT_TIME_PATTERN.test(shift.end);
    });

    if (hasInvalidShift) {
        return 'Completa todos los campos de cada turno antes de guardar.';
    }

    const weeklyValidation = validateWeeklyShiftSchedule(draft.shifts);

    if (!weeklyValidation.ok) {
        if (weeklyValidation.error === 'Each shift must apply to at least one weekday.') {
            return 'Selecciona al menos un dia para cada turno antes de guardar.';
        }

        if (weeklyValidation.error === 'Shift windows cannot overlap after weekly expansion.') {
            return 'Los turnos configurados no pueden superponerse en la semana.';
        }
    }

    return null;
}
