import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePrismaVoiceConfigDraft } from './usePrismaVoiceConfigDraft';
import { createDefaultPrismaVoiceConfig } from '../domain/prismaVoiceConfig';

describe('usePrismaVoiceConfigDraft', () => {
    it('owns an in-memory default draft and tracks committed changes', () => {
        const { result } = renderHook(() => usePrismaVoiceConfigDraft());

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
        const { result } = renderHook(() => usePrismaVoiceConfigDraft());
        const remote = createDefaultPrismaVoiceConfig();
        remote.effectIntensity = 42;

        act(() => result.current.initializeFromRemote(remote));

        expect(result.current.draft.effectIntensity).toBe(42);
        expect(result.current.isDirty).toBe(false);
        expect(result.current.baselineGeneration).toBe(1);
    });

    it('does not let a late remote response replace a locally edited draft', () => {
        const { result } = renderHook(() => usePrismaVoiceConfigDraft());
        const remote = createDefaultPrismaVoiceConfig();
        remote.effectIntensity = 42;

        act(() => result.current.updateField('effectIntensity', 65));
        act(() => result.current.initializeFromRemote(remote));

        expect(result.current.draft.effectIntensity).toBe(65);
        expect(result.current.isDirty).toBe(true);
        expect(result.current.baselineGeneration).toBe(0);
    });

    it('does not adopt a late remote response after local edits were committed', () => {
        const { result } = renderHook(() => usePrismaVoiceConfigDraft());
        const remote = createDefaultPrismaVoiceConfig();
        remote.effectIntensity = 42;

        act(() => result.current.updateField('effectIntensity', 65));
        act(() => result.current.commitDraft());
        act(() => result.current.initializeFromRemote(remote));

        expect(result.current.draft.effectIntensity).toBe(65);
        expect(result.current.isDirty).toBe(false);
        expect(result.current.baselineGeneration).toBe(0);
    });

    it('rebases edits made during PUT onto the normalized server response', () => {
        const initial = createDefaultPrismaVoiceConfig();
        const { result } = renderHook(() => usePrismaVoiceConfigDraft(initial));

        act(() => result.current.updateField('effectIntensity', 65));
        const sentSnapshot = result.current.draft;
        act(() => result.current.updateField('preset', 'clean'));
        const normalized = createDefaultPrismaVoiceConfig();
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
