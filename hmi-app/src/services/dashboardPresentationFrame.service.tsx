/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DashboardPresentationFrame, WidgetPresentationEntry } from '../domain/dashboardPresentation.types';

interface PresentationFrameContext {
    frame: DashboardPresentationFrame;
    registerEntry: (entry: WidgetPresentationEntry) => void;
}

const EMPTY_FRAME: DashboardPresentationFrame = { dashboardId: '', viewId: '', profileRevision: 0, revisionKey: 'profile:0', expectedWidgetIds: [], entries: new Map(), ready: false };
const FrameContext = createContext<PresentationFrameContext>({ frame: EMPTY_FRAME, registerEntry: () => undefined });

interface PresentationEntriesState {
    revisionKey: string;
    entries: Map<string, WidgetPresentationEntry>;
}

export interface DashboardPresentationFrameProviderProps { dashboardId: string; viewId: string; profileRevision: number; expectedWidgetIds: readonly string[]; children: ReactNode; }

export function DashboardPresentationFrameProvider({ dashboardId, viewId, profileRevision, expectedWidgetIds, children }: DashboardPresentationFrameProviderProps) {
    const revisionKey = `${dashboardId}:${viewId}:${profileRevision}`;
    const [entryState, setEntryState] = useState<PresentationEntriesState>(() => ({ revisionKey, entries: new Map() }));
    const registerEntry = useCallback((entry: WidgetPresentationEntry) => {
        if (entry.revisionKey !== revisionKey) return;
        setEntryState((current) => {
            const currentEntries = current.revisionKey === revisionKey ? current.entries : new Map<string, WidgetPresentationEntry>();
            const next = new Map([...currentEntries].filter(([, item]) => item.revisionKey === revisionKey));
            if (current.revisionKey === revisionKey && next.get(entry.widgetId) === entry) {
                return current;
            }

            next.set(entry.widgetId, entry);
            return { revisionKey, entries: next };
        });
    }, [revisionKey]);
    const currentEntries = useMemo(
        () => entryState.revisionKey === revisionKey
            ? new Map([...entryState.entries].filter(([, entry]) => entry.revisionKey === revisionKey))
            : new Map(),
        [entryState, revisionKey],
    );
    const ready = expectedWidgetIds.every((id) => currentEntries.has(id));
    const frame = Object.freeze({ dashboardId, viewId, profileRevision, revisionKey, expectedWidgetIds: [...expectedWidgetIds], entries: currentEntries, ready });
    return <FrameContext.Provider value={{ frame, registerEntry }}>{children}</FrameContext.Provider>;
}

export function useDashboardPresentationFrame(): DashboardPresentationFrame {
    return useContext(FrameContext).frame;
}

export function usePresentationRegistration(entry: WidgetPresentationEntry): void {
    const { registerEntry } = useContext(FrameContext);
    useEffect(() => registerEntry(entry), [entry, registerEntry]);
}
