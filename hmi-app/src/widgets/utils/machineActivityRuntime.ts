import type { MachineActivityDisplayOptions, ProductiveState } from '../../domain/admin.types';
import { calculateActivityIndex, determineProductiveState, getStateVisuals, smoothValue } from './machineActivity';

export interface MachineActivityComputedResult {
    activityIndex: number;
    productiveState: ProductiveState;
    stateLabel: string;
    stateVisuals: ReturnType<typeof getStateVisuals>;
    smoothedPower: number;
    rawPower: number | null;
    isValid: boolean;
}

export interface MachineActivityInitializationState {
    valueBuffer: number[];
    confirmedState: ProductiveState;
    pendingState: ProductiveState | null;
    pendingSince: number | null;
    lastProcessedRawPower: number | null;
    result: MachineActivityComputedResult;
}

export interface ResolveMachineActivityUnitsInput {
    isSimulatedBinding: boolean;
    resolvedUnit?: string | null;
    bindingUnit?: string | null;
    customUnit?: string | null;
    unitOverride?: boolean;
}

export const MACHINE_ACTIVITY_DEFAULTS = {
    thresholdStopped: 0.15,
    thresholdProducing: 0.25,
    hysteresis: 0.05,
    confirmationTime: 2000,
    smoothingWindow: 5,
    powerMin: 0,
    powerMax: 1,
    labelStopped: 'Detenida',
    labelCalibrating: 'Setup',
    labelProducing: 'Produciendo',
} as const;

export function coerceMachineActivityRawValue(rawValue: number | string | null | undefined): number | null {
    if (rawValue == null) {
        return null;
    }

    if (typeof rawValue === 'number') {
        return Number.isNaN(rawValue) ? null : rawValue;
    }

    const parsed = parseFloat(rawValue);
    return Number.isNaN(parsed) ? null : parsed;
}

export function resolveMachineActivityStateLabel(
    state: ProductiveState,
    displayOptions: MachineActivityDisplayOptions,
): string {
    if (state === 'stopped') {
        return displayOptions.labelStopped ?? MACHINE_ACTIVITY_DEFAULTS.labelStopped;
    }

    if (state === 'calibrating') {
        return displayOptions.labelCalibrating ?? MACHINE_ACTIVITY_DEFAULTS.labelCalibrating;
    }

    return displayOptions.labelProducing ?? MACHINE_ACTIVITY_DEFAULTS.labelProducing;
}

export function resolveMachineActivitySnapshotResult(
    rawValue: number | string | null | undefined,
    displayOptions: MachineActivityDisplayOptions,
): MachineActivityComputedResult {
    const rawPower = coerceMachineActivityRawValue(rawValue);

    if (rawPower === null) {
        return {
            activityIndex: 0,
            productiveState: 'stopped',
            stateLabel: 'Sin datos',
            stateVisuals: getStateVisuals('stopped'),
            smoothedPower: 0,
            rawPower: null,
            isValid: false,
        };
    }

    const productiveState = determineProductiveState(
        rawPower,
        {
            stopped: displayOptions.thresholdStopped ?? MACHINE_ACTIVITY_DEFAULTS.thresholdStopped,
            producing: displayOptions.thresholdProducing ?? MACHINE_ACTIVITY_DEFAULTS.thresholdProducing,
        },
        displayOptions.hysteresis ?? MACHINE_ACTIVITY_DEFAULTS.hysteresis,
        'stopped',
    );
    const activityIndex = calculateActivityIndex(
        rawPower,
        displayOptions.powerMin ?? MACHINE_ACTIVITY_DEFAULTS.powerMin,
        displayOptions.powerMax ?? MACHINE_ACTIVITY_DEFAULTS.powerMax,
    );

    return {
        activityIndex: productiveState === 'stopped' ? 0 : activityIndex,
        productiveState,
        stateLabel: resolveMachineActivityStateLabel(productiveState, displayOptions),
        stateVisuals: getStateVisuals(productiveState),
        smoothedPower: rawPower,
        rawPower,
        isValid: true,
    };
}

export function initializeMachineActivityState(
    rawValue: number | string | null | undefined,
    displayOptions: MachineActivityDisplayOptions,
    options: { simulated?: boolean } = {},
): MachineActivityInitializationState {
    const rawPower = coerceMachineActivityRawValue(rawValue);
    const isSimulated = options.simulated === true;

    if (rawPower === null) {
        return {
            valueBuffer: [],
            confirmedState: 'stopped',
            pendingState: null,
            pendingSince: null,
            lastProcessedRawPower: null,
            result: {
                activityIndex: 0,
                productiveState: 'stopped',
                stateLabel: 'Sin datos',
                stateVisuals: getStateVisuals('stopped'),
                smoothedPower: 0,
                rawPower: null,
                isValid: false,
            },
        };
    }

    const smoothingWindow = isSimulated
        ? 1
        : Math.max(1, displayOptions.smoothingWindow ?? MACHINE_ACTIVITY_DEFAULTS.smoothingWindow);
    const valueBuffer = [rawPower].slice(-smoothingWindow);
    const smoothedPower = isSimulated
        ? rawPower
        : smoothValue(valueBuffer, smoothingWindow);
    let confirmedState: ProductiveState = 'stopped';
    let pendingState: ProductiveState | null = null;
    let pendingSince: number | null = null;

    const candidateState = determineProductiveState(
        smoothedPower,
        {
            stopped: displayOptions.thresholdStopped ?? MACHINE_ACTIVITY_DEFAULTS.thresholdStopped,
            producing: displayOptions.thresholdProducing ?? MACHINE_ACTIVITY_DEFAULTS.thresholdProducing,
        },
        displayOptions.hysteresis ?? MACHINE_ACTIVITY_DEFAULTS.hysteresis,
        confirmedState,
    );

    if (isSimulated) {
        confirmedState = candidateState;
    } else if (candidateState !== confirmedState) {
        pendingState = candidateState;
        pendingSince = Date.now();
    }

    const activityIndex = calculateActivityIndex(
        smoothedPower,
        displayOptions.powerMin ?? MACHINE_ACTIVITY_DEFAULTS.powerMin,
        displayOptions.powerMax ?? MACHINE_ACTIVITY_DEFAULTS.powerMax,
    );
    const productiveState = confirmedState;

    return {
        valueBuffer,
        confirmedState,
        pendingState,
        pendingSince,
        lastProcessedRawPower: rawPower,
        result: {
            activityIndex: productiveState === 'stopped' ? 0 : activityIndex,
            productiveState,
            stateLabel: resolveMachineActivityStateLabel(productiveState, displayOptions),
            stateVisuals: getStateVisuals(productiveState),
            smoothedPower,
            rawPower,
            isValid: true,
        },
    };
}

export function resolveMachineActivityUnits({
    isSimulatedBinding,
    resolvedUnit,
    bindingUnit,
    customUnit,
    unitOverride,
}: ResolveMachineActivityUnitsInput): { displayUnit: string; realUnit: string } {
    const trimmedResolvedUnit = resolvedUnit?.trim() ?? '';
    const trimmedBindingUnit = bindingUnit?.trim() ?? '';
    const trimmedCustomUnit = customUnit?.trim() ?? '';
    const simulatedUnit = trimmedBindingUnit || trimmedCustomUnit;
    const liveUnit = isSimulatedBinding
        ? simulatedUnit
        : (trimmedResolvedUnit || trimmedBindingUnit);
    const fallbackRealUnit = isSimulatedBinding ? (simulatedUnit || 'kW') : (liveUnit || 'kW');
    const displayUnit = unitOverride
        ? (isSimulatedBinding ? (simulatedUnit || '%') : (trimmedCustomUnit || '%'))
        : (liveUnit || fallbackRealUnit);
    const realUnit = fallbackRealUnit;

    return { displayUnit, realUnit };
}
