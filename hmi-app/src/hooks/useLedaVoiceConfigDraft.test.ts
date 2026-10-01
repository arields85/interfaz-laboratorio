import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLedaVoiceConfigDraft } from './useLedaVoiceConfigDraft';
import { createDefaultLedaVoiceConfig } from '../domain/ledaVoiceConfig';

describe('useLedaVoiceConfigDraft', () => {
    it('owns an in-memory default draft and tracks committed changes', () => {
        const { result } = renderHook(() => useLedaVoiceConfigDraft());

        expect(result.current.draft.preset).toBe('robotic_medium_light');
        expect(result.current.isDirty).toBe(false);

        act(() => result.current.updateField('effectIntensity', 65));
        act(() => result.current.updateRoboticField('modulationHz', 35));

        expect(result.current.draft.effectIntensity).toBe(65);
        expect(result.current.draft.robotic.modulationHz).toBe(35);
        expect(result.current.isDirty).toBe(true);

        act(() => result.current.commitDraft());
        expect(result.current.isDirty).toBe(false);
    });

    it('adopts a remote config as a clean draft and baseline', () => {
        const { result } = renderHook(() => useLedaVoiceConfigDraft());
        const remote = createDefaultLedaVoiceConfig();
        remote.effectIntensity = 42;

        act(() => result.current.initializeFromRemote(remote));

        expect(result.current.draft.effectIntensity).toBe(42);
        expect(result.current.isDirty).toBe(false);
        expect(result.current.baselineGeneration).toBe(1);
    });

    it('does not let a late remote response replace a locally edited draft', () => {
        const { result } = renderHook(() => useLedaVoiceConfigDraft());
        const remote = createDefaultLedaVoiceConfig();
        remote.effectIntensity = 42;

        act(() => result.current.updateField('effectIntensity', 65));
        act(() => result.current.initializeFromRemote(remote));

        expect(result.current.draft.effectIntensity).toBe(65);
        expect(result.current.isDirty).toBe(true);
        expect(result.current.baselineGeneration).toBe(0);
    });

    it('does not adopt a late remote response after local edits were committed', () => {
        const { result } = renderHook(() => useLedaVoiceConfigDraft());
        const remote = createDefaultLedaVoiceConfig();
        remote.effectIntensity = 42;

        act(() => result.current.updateField('effectIntensity', 65));
        act(() => result.current.commitDraft());
        act(() => result.current.initializeFromRemote(remote));

        expect(result.current.draft.effectIntensity).toBe(65);
        expect(result.current.isDirty).toBe(false);
        expect(result.current.baselineGeneration).toBe(0);
    });

    it('tracks a manual playbackBuffer field edit as dirty and commits it', () => {
        const { result } = renderHook(() => useLedaVoiceConfigDraft());

        expect(result.current.draft.playbackBuffer).toEqual({ mode: 'automatic', manualSeconds: 0.2 });

        act(() => result.current.updatePlaybackBufferField('mode', 'manual'));
        act(() => result.current.updatePlaybackBufferField('manualSeconds', 1.5));

        expect(result.current.draft.playbackBuffer).toEqual({ mode: 'manual', manualSeconds: 1.5 });
        expect(result.current.isDirty).toBe(true);

        act(() => result.current.commitDraft());
        expect(result.current.isDirty).toBe(false);
    });

    it('rebases a playbackBuffer edit made during PUT onto the normalized server response', () => {
        const initial = createDefaultLedaVoiceConfig();
        const { result } = renderHook(() => useLedaVoiceConfigDraft(initial));

        act(() => result.current.updatePlaybackBufferField('mode', 'manual'));
        const sentSnapshot = result.current.draft;
        act(() => result.current.updatePlaybackBufferField('manualSeconds', 0.9));
        const normalized = createDefaultLedaVoiceConfig();
        normalized.playbackBuffer = { mode: 'manual', manualSeconds: 0.4 };

        act(() => result.current.commitRemote(sentSnapshot, normalized));

        // `mode` was not touched since the sent snapshot -> adopts the server value.
        expect(result.current.draft.playbackBuffer.mode).toBe('manual');
        // `manualSeconds` diverged locally after the sent snapshot -> local edit wins.
        expect(result.current.draft.playbackBuffer.manualSeconds).toBe(0.9);
        expect(result.current.isDirty).toBe(true);
    });

    it('rebases edits made during PUT onto the normalized server response', () => {
        const initial = createDefaultLedaVoiceConfig();
        const { result } = renderHook(() => useLedaVoiceConfigDraft(initial));

        act(() => result.current.updateField('effectIntensity', 65));
        const sentSnapshot = result.current.draft;
        act(() => result.current.updateField('preset', 'clean'));
        const normalized = createDefaultLedaVoiceConfig();
        normalized.effectIntensity = 64;
        normalized.robotic.modulationHz = 36;

        act(() => result.current.commitRemote(sentSnapshot, normalized));

        expect(result.current.draft.effectIntensity).toBe(64);
        expect(result.current.draft.robotic.modulationHz).toBe(36);
        expect(result.current.draft.preset).toBe('clean');
        expect(result.current.isDirty).toBe(true);
        expect(result.current.baselineGeneration).toBe(1);
    });
});
