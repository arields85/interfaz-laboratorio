import type { QueryClient } from '@tanstack/react-query';

import { applyThemeOverrides, resetThemeOverridesOnDocument } from '../components/admin/DesignSettingsTab';
import {
    ACTIVITY_SERIES_ENDPOINT_STORAGE_KEY,
    BASE_URL_STORAGE_KEY,
    ENDPOINT_STORAGE_KEY,
    HISTORY_ENDPOINT_STORAGE_KEY,
} from '../config/dataConnection.config';
import { ACTIVITY_SERIES_QUERY_KEY_PREFIX } from '../queries/useActivitySeries';
import { DATA_HISTORY_QUERY_KEY_PREFIX } from '../queries/useDataHistory';
import { DATA_OVERVIEW_QUERY_KEY } from '../queries/useDataOverview';
import { DESIGN_COLOR_STORAGE_KEY, DESIGN_FONT_STORAGE_KEY } from '../services/designSettingsStorage.service';
import { applyFrameShapeOverrides, FRAME_SHAPE_STORAGE_KEY } from '../services/frameShape.service';
import { applyIconCutoutOverride, ICON_CUTOUT_STORAGE_KEY } from '../services/iconCutout.service';
import {
    applyLinkAccentGeometryOverride,
    applyLinkAccentLengthsOverride,
    applyLinkCornerAccentsOverride,
    LINK_ACCENT_GEOMETRY_STORAGE_KEY,
    LINK_ACCENT_LENGTHS_STORAGE_KEY,
    LINK_CORNER_ACCENTS_STORAGE_KEY,
} from '../services/linkCornerAccents.service';
import { deferWhileHeld, setHeldChangesHandler } from '../services/sharedConfigReapplyHold.service';
import { sharedConfigStorage } from '../services/sharedConfigStorage.service';
import {
    applyThemeStyleOverrides,
    FRAME_RADIUS_STORAGE_KEY,
    resetThemeStyleOnDocument,
    THEME_STYLE_STORAGE_KEY,
} from '../services/themeStyle.service';
import { applyViewerEntranceOverrides, VIEWER_ENTRANCE_STORAGE_KEY } from '../services/viewerEntranceStyle.service';
import { SHADER_PARAMS_STORAGE_KEY, useShaderParamsStore } from '../store/shaderParams.store';

// =============================================================================
// Shared configuration appliers
// What the administrator configures is applied to the document once at boot and again
// whenever another browser changes it (the adapter's remote-change subscription). A
// group re-applies only when one of its own keys changed. While an editor with unsaved
// drafts is open it holds the re-apply, so a remote change never overwrites the live
// preview of those edits; the held changes are applied when the last hold is released.
// =============================================================================

const DATA_CONNECTION_KEYS: readonly string[] = [
    BASE_URL_STORAGE_KEY,
    ENDPOINT_STORAGE_KEY,
    HISTORY_ENDPOINT_STORAGE_KEY,
    ACTIVITY_SERIES_ENDPOINT_STORAGE_KEY,
];

interface ApplierContext {
    queryClient?: QueryClient;
}

interface ApplierGroup {
    keys: readonly string[];
    /** Applies the group; used at boot too unless `boot` is false. */
    apply: (context: ApplierContext) => void;
    boot?: boolean;
}

// Applying never writes: a viewer has no session, so a write on read would stay pending.
// The theme groups first clear what the previous value left on the document, so a value
// another browser removed does not linger.
const APPLIER_GROUPS: readonly ApplierGroup[] = [
    {
        keys: [DESIGN_FONT_STORAGE_KEY, DESIGN_COLOR_STORAGE_KEY],
        apply: () => {
            resetThemeOverridesOnDocument();
            applyThemeOverrides();
        },
    },
    {
        keys: [THEME_STYLE_STORAGE_KEY, FRAME_RADIUS_STORAGE_KEY],
        apply: () => {
            resetThemeStyleOnDocument();
            applyThemeStyleOverrides();
        },
    },
    { keys: [VIEWER_ENTRANCE_STORAGE_KEY], apply: applyViewerEntranceOverrides },
    { keys: [FRAME_SHAPE_STORAGE_KEY], apply: applyFrameShapeOverrides },
    { keys: [ICON_CUTOUT_STORAGE_KEY], apply: applyIconCutoutOverride },
    { keys: [LINK_CORNER_ACCENTS_STORAGE_KEY], apply: applyLinkCornerAccentsOverride },
    { keys: [LINK_ACCENT_LENGTHS_STORAGE_KEY], apply: applyLinkAccentLengthsOverride },
    { keys: [LINK_ACCENT_GEOMETRY_STORAGE_KEY], apply: applyLinkAccentGeometryOverride },
    // The persisted store hydrates when it is created, before the document is loaded.
    { keys: [SHADER_PARAMS_STORAGE_KEY], apply: () => { void useShaderParamsStore.persist.rehydrate(); } },
    {
        keys: DATA_CONNECTION_KEYS,
        boot: false,
        apply: ({ queryClient }) => {
            // Same invalidations as saving the connection: observers re-read the endpoints.
            void queryClient?.invalidateQueries({ queryKey: DATA_OVERVIEW_QUERY_KEY });
            void queryClient?.invalidateQueries({ queryKey: DATA_HISTORY_QUERY_KEY_PREFIX });
            void queryClient?.invalidateQueries({ queryKey: ACTIVITY_SERIES_QUERY_KEY_PREFIX });
        },
    },
];

/** Boot: applies every stored configuration value to the document. Call after the document loaded. */
export function applySharedConfigToDocument(): void {
    for (const group of APPLIER_GROUPS) {
        if (group.boot !== false) group.apply({});
    }
}

function applyChangedKeys(changedKeys: Iterable<string>, context: ApplierContext): void {
    const changed = new Set(changedKeys);
    for (const group of APPLIER_GROUPS) {
        if (group.keys.some((key) => changed.has(key))) group.apply(context);
    }
}

/** Re-applies the configuration whenever another browser changes it. Returns the unsubscribe. */
export function startSharedConfigReapply(context: ApplierContext = {}): () => void {
    setHeldChangesHandler((keys) => applyChangedKeys(keys, context));
    const unsubscribe = sharedConfigStorage.subscribe(({ changedKeys }) => {
        if (deferWhileHeld(changedKeys)) return;
        applyChangedKeys(changedKeys, context);
    });
    return () => {
        unsubscribe();
        setHeldChangesHandler(null);
    };
}
