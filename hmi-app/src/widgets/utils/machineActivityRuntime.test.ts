import { describe, expect, it } from 'vitest';

import {
    resolveMachineActivitySnapshotResult,
    resolveMachineActivityUnits,
} from './machineActivityRuntime';

describe('resolveMachineActivitySnapshotResult', () => {
    it('classifies stopped snapshots and zeroes the exported activity index below the stopped threshold', () => {
        const result = resolveMachineActivitySnapshotResult(0.1, {
            thresholdStopped: 0.15,
            thresholdProducing: 0.25,
            powerMin: 0,
            powerMax: 1,
        });

        expect(result).toMatchObject({
            productiveState: 'stopped',
            stateLabel: 'Detenida',
            activityIndex: 0,
            smoothedPower: 0.1,
            rawPower: 0.1,
            isValid: true,
        });
    });

    it('classifies setup snapshots between the stopped and producing thresholds', () => {
        const result = resolveMachineActivitySnapshotResult(0.2, {
            thresholdStopped: 0.15,
            thresholdProducing: 0.25,
            powerMin: 0,
            powerMax: 1,
        });

        expect(result).toMatchObject({
            productiveState: 'calibrating',
            stateLabel: 'Setup',
            activityIndex: 20,
            smoothedPower: 0.2,
            rawPower: 0.2,
            isValid: true,
        });
    });

    it('classifies producing snapshots at or above the producing threshold', () => {
        const result = resolveMachineActivitySnapshotResult(0.62, {
            thresholdStopped: 0.15,
            thresholdProducing: 0.25,
            powerMin: 0,
            powerMax: 1,
        });

        expect(result).toMatchObject({
            productiveState: 'producing',
            stateLabel: 'Produciendo',
            activityIndex: 62,
            smoothedPower: 0.62,
            rawPower: 0.62,
            isValid: true,
        });
    });
});

describe('resolveMachineActivityUnits', () => {
    it('falls back to kW for live bindings when no unit metadata exists', () => {
        expect(resolveMachineActivityUnits({
            isSimulatedBinding: false,
            resolvedUnit: undefined,
            bindingUnit: undefined,
            customUnit: '%',
            unitOverride: false,
        })).toEqual({
            displayUnit: 'kW',
            realUnit: 'kW',
        });
    });

    it('keeps the simulated binding unit for both display and real units when unit override is enabled', () => {
        expect(resolveMachineActivityUnits({
            isSimulatedBinding: true,
            resolvedUnit: 'Hz',
            bindingUnit: '%',
            customUnit: 'kW',
            unitOverride: true,
        })).toEqual({
            displayUnit: '%',
            realUnit: '%',
        });
    });
});
