import { describe, expect, it } from 'vitest';
import {
    DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND,
    DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE,
    DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
    DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE,
    resolveActualSpeedFromScale,
    resolveStoredTravelingTopCapActualSpeedRange,
    resolveStoredTravelingTopCapSpeedScale,
} from './travelingTopCapSpeed';

describe('travelingTopCapSpeed', () => {
    it('owns the requested 1..10 default speed scale', () => {
        expect(DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE).toBe(3);
        expect(DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE).toBe(9);
    });

    it('derives runtime speed defaults from the requested scale defaults', () => {
        expect(DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND).toBe(
            resolveActualSpeedFromScale(DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE),
        );
        expect(DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND).toBe(
            resolveActualSpeedFromScale(DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE),
        );
        expect(resolveStoredTravelingTopCapActualSpeedRange()).toEqual({
            min: DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
            max: DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND,
        });
    });

    it('resolves missing stored values back to the default scale', () => {
        expect(resolveStoredTravelingTopCapSpeedScale(
            undefined,
            DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
        )).toBe(DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE);
        expect(resolveStoredTravelingTopCapSpeedScale(
            undefined,
            DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND,
        )).toBe(DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE);
    });
});
