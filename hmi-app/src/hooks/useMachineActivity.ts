import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { MachineActivityDisplayOptions, ProductiveState } from '../domain/admin.types';
import {
    calculateActivityIndex,
    determineProductiveState,
    getStateVisuals,
    smoothValue,
    type StateVisuals,
} from '../widgets/utils/machineActivity';

export interface MachineActivityResult {
    activityIndex: number;
    productiveState: ProductiveState;
    stateLabel: string;
    stateVisuals: StateVisuals;
    smoothedPower: number;
    rawPower: number | null;
    isValid: boolean;
}

export interface UseMachineActivityOptions {
    readonly sourceKey?: string;
    readonly simulated?: boolean;
}

interface MachineActivityInitialization {
    valueBuffer: number[];
    confirmedState: ProductiveState;
    pendingState: ProductiveState | null;
    pendingSince: number | null;
    lastProcessedRawPower: number | null;
    result: MachineActivityResult;
}

const DEFAULTS = {
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

function coerceRawValue(rawValue: number | string | null | undefined): number | null {
    if (rawValue == null) {
        return null;
    }

    if (typeof rawValue === 'number') {
        return Number.isNaN(rawValue) ? null : rawValue;
    }

    const parsed = parseFloat(rawValue);
    return Number.isNaN(parsed) ? null : parsed;
}

function resolveStateLabel(state: ProductiveState, displayOptions: MachineActivityDisplayOptions): string {
    if (state === 'stopped') {
        return displayOptions.labelStopped ?? DEFAULTS.labelStopped;
    }

    if (state === 'calibrating') {
        return displayOptions.labelCalibrating ?? DEFAULTS.labelCalibrating;
    }

    return displayOptions.labelProducing ?? DEFAULTS.labelProducing;
}

function areResultsEqual(previous: MachineActivityResult, next: MachineActivityResult): boolean {
    return previous.activityIndex === next.activityIndex
        && previous.productiveState === next.productiveState
        && previous.stateLabel === next.stateLabel
        && previous.smoothedPower === next.smoothedPower
        && previous.rawPower === next.rawPower
        && previous.isValid === next.isValid
        && previous.stateVisuals.primary === next.stateVisuals.primary
        && previous.stateVisuals.gradientColors[0] === next.stateVisuals.gradientColors[0]
        && previous.stateVisuals.gradientColors[1] === next.stateVisuals.gradientColors[1]
        && previous.stateVisuals.glowColor === next.stateVisuals.glowColor
        && previous.stateVisuals.animationDuration === next.stateVisuals.animationDuration;
}

function buildResult(
    rawValue: number | string | null | undefined,
    displayOptions: MachineActivityDisplayOptions,
    options: UseMachineActivityOptions,
    valueBufferRef: MutableRefObject<number[]>,
    confirmedStateRef: MutableRefObject<ProductiveState>,
    pendingStateRef: MutableRefObject<ProductiveState | null>,
    pendingSinceRef: MutableRefObject<number | null>,
    lastProcessedRawPowerRef: MutableRefObject<number | null>,
): MachineActivityResult {
    const rawPower = coerceRawValue(rawValue);
    const isSimulated = options.simulated === true;

    if (rawPower === null) {
        valueBufferRef.current = [];
        confirmedStateRef.current = 'stopped';
        pendingStateRef.current = null;
        pendingSinceRef.current = null;
        lastProcessedRawPowerRef.current = null;

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

    const smoothingWindow = isSimulated
        ? 1
        : Math.max(1, displayOptions.smoothingWindow ?? DEFAULTS.smoothingWindow);

    if (lastProcessedRawPowerRef.current !== rawPower) {
        valueBufferRef.current = [...(valueBufferRef.current ?? []), rawPower].slice(-smoothingWindow);
        lastProcessedRawPowerRef.current = rawPower;
    }

    const smoothedPower = isSimulated
        ? rawPower
        : smoothValue(valueBufferRef.current ?? [], smoothingWindow);
    const candidateState = determineProductiveState(
        smoothedPower,
        {
            stopped: displayOptions.thresholdStopped ?? DEFAULTS.thresholdStopped,
            producing: displayOptions.thresholdProducing ?? DEFAULTS.thresholdProducing,
        },
        displayOptions.hysteresis ?? DEFAULTS.hysteresis,
        confirmedStateRef.current ?? 'stopped',
    );

    const confirmationTime = isSimulated ? 0 : (displayOptions.confirmationTime ?? DEFAULTS.confirmationTime);
    const now = Date.now();

    if (isSimulated) {
        confirmedStateRef.current = candidateState;
        pendingStateRef.current = null;
        pendingSinceRef.current = null;
    } else if (candidateState === confirmedStateRef.current) {
        pendingStateRef.current = null;
        pendingSinceRef.current = null;
    } else if (pendingStateRef.current !== candidateState) {
        pendingStateRef.current = candidateState;
        pendingSinceRef.current = now;
    } else if (pendingSinceRef.current !== null && now - pendingSinceRef.current >= confirmationTime) {
        confirmedStateRef.current = candidateState;
        pendingStateRef.current = null;
        pendingSinceRef.current = null;
    }

    const productiveState = confirmedStateRef.current;
    const activityIndex = calculateActivityIndex(
        smoothedPower,
        displayOptions.powerMin ?? DEFAULTS.powerMin,
        displayOptions.powerMax ?? DEFAULTS.powerMax,
    );
    const finalActivityIndex = productiveState === 'stopped' ? 0 : activityIndex;

    return {
        activityIndex: finalActivityIndex,
        productiveState,
        stateLabel: resolveStateLabel(productiveState, displayOptions),
        stateVisuals: getStateVisuals(productiveState),
        smoothedPower,
        rawPower,
        isValid: true,
    };
}

function initializeMachineActivity(
    rawValue: number | string | null | undefined,
    displayOptions: MachineActivityDisplayOptions,
    options: UseMachineActivityOptions,
): MachineActivityInitialization {
    const rawPower = coerceRawValue(rawValue);
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
        : Math.max(1, displayOptions.smoothingWindow ?? DEFAULTS.smoothingWindow);
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
            stopped: displayOptions.thresholdStopped ?? DEFAULTS.thresholdStopped,
            producing: displayOptions.thresholdProducing ?? DEFAULTS.thresholdProducing,
        },
        displayOptions.hysteresis ?? DEFAULTS.hysteresis,
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
        displayOptions.powerMin ?? DEFAULTS.powerMin,
        displayOptions.powerMax ?? DEFAULTS.powerMax,
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
            stateLabel: resolveStateLabel(productiveState, displayOptions),
            stateVisuals: getStateVisuals(productiveState),
            smoothedPower,
            rawPower,
            isValid: true,
        },
    };
}

export function useMachineActivity(
    rawValue: number | string | null | undefined,
    displayOptions: MachineActivityDisplayOptions,
    options: UseMachineActivityOptions = {},
): MachineActivityResult {
    const simulated = options.simulated;
    const sourceKey = options.sourceKey;
    const [initialState] = useState<MachineActivityInitialization>(() => initializeMachineActivity(
        rawValue,
        displayOptions,
        { simulated, sourceKey },
    ));
    const valueBufferRef = useRef<number[]>(initialState.valueBuffer);
    const confirmedStateRef = useRef<ProductiveState>(initialState.confirmedState);
    const pendingStateRef = useRef<ProductiveState | null>(initialState.pendingState);
    const pendingSinceRef = useRef<number | null>(initialState.pendingSince);
    const lastProcessedRawPowerRef = useRef<number | null>(initialState.lastProcessedRawPower);
    const hasMountedRef = useRef(false);
    const sourceKeyRef = useRef<string | undefined>(sourceKey);
    const computeResult = useCallback(() => buildResult(
        rawValue,
        displayOptions,
        { simulated, sourceKey },
        valueBufferRef,
        confirmedStateRef,
        pendingStateRef,
        pendingSinceRef,
        lastProcessedRawPowerRef,
    ), [displayOptions, rawValue, simulated, sourceKey]);

    const [result, setResult] = useState<MachineActivityResult>(initialState.result);

    useEffect(() => {
        if (sourceKeyRef.current === sourceKey) {
            return;
        }

        valueBufferRef.current = [];
        confirmedStateRef.current = 'stopped';
        pendingStateRef.current = null;
        pendingSinceRef.current = null;
        lastProcessedRawPowerRef.current = null;
        sourceKeyRef.current = sourceKey;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- source changes must reset the activity state immediately.
        setResult(computeResult());
    }, [computeResult, sourceKey]);

    useEffect(() => {
        if (hasMountedRef.current) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- derived activity state is recomputed from async/value changes.
            setResult((previous) => {
                const next = computeResult();

                return areResultsEqual(previous, next) ? previous : next;
            });
        } else {
            hasMountedRef.current = true;
        }

        if (pendingStateRef.current === null || pendingSinceRef.current === null) {
            return undefined;
        }

        const confirmationTime = simulated === true
            ? 0
            : (displayOptions.confirmationTime ?? DEFAULTS.confirmationTime);
        const elapsed = Date.now() - pendingSinceRef.current;
        const remaining = Math.max(confirmationTime - elapsed, 0);
        const timeoutId = window.setTimeout(() => {
            setResult((previous) => {
                const next = computeResult();

                return areResultsEqual(previous, next) ? previous : next;
            });
        }, remaining);

        return () => window.clearTimeout(timeoutId);
    }, [computeResult, displayOptions.confirmationTime, simulated]);

    return result;
}
