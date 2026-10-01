import { useLinkCornerAccentsStore } from '../store/linkCornerAccents.store';
import { useThemeStylePresetStore } from '../store/themeStylePreset.store';

/**
 * Single decision point of "may the viewer draw the link corner accents": the setting is on and the
 * active preset is Clasico (the other presets have their own frame accents). Whether a given widget
 * gets them is decided per widget (effective navigation target, frame).
 */
export function useLinkCornerAccentsActive(): boolean {
    const enabled = useLinkCornerAccentsStore((state) => state.enabled);
    const classic = useThemeStylePresetStore((state) => state.classic);

    return enabled && classic;
}
