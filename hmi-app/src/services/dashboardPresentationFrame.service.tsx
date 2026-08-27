/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DashboardPresentationFrame, WidgetPresentationEntry } from '../domain/dashboardPresentation.types';

interface PresentationFrameContext {
    frame: DashboardPresentationFrame;
    registerEntry: (entry: WidgetPresentationEntry) => void;
}

const EMPTY_FRAME: DashboardPresentationFrame = { dashboardId: '', viewId: '', profileRevision: 0, revisionKey: 'profile:0', expectedWidgetIds: [], entries: new Map(), ready: false };
const FrameContext = createContext<PresentationFrameContext>({ frame: EMPTY_FRAME, registerEntry: () => undefined });

export interface DashboardPresentationFrameProviderProps { dashboardId: string; viewId: string; profileRevision: number; expectedWidgetIds: readonly string[]; children: ReactNode; }

export function DashboardPresentationFrameProvider({ dashboardId, viewId, profileRevision, expectedWidgetIds, children }: DashboardPresentationFrameProviderProps) {
    const revisionKey = `${dashboardId}:${viewId}:${profileRevision}`;
    const [entries, setEntries] = useState<Map<string, WidgetPresentationEntry>>(new Map());
    const registerEntry = useCallback((entry: WidgetPresentationEntry) => {
        if (entry.revisionKey !== revisionKey) return;
        setEntries((current) => {
            const next = new Map([...current].filter(([, item]) => item.revisionKey === revisionKey));
            return next.get(entry.widgetId) === entry ? current : next.set(entry.widgetId, entry);
        });
    }, [revisionKey]);
    const ready = expectedWidgetIds.every((id) => entries.get(id)?.revisionKey === revisionKey);
    const frame = Object.freeze({ dashboardId, viewId, profileRevision, revisionKey, expectedWidgetIds: [...expectedWidgetIds], entries: new Map(entries), ready });
    return <FrameContext.Provider value={{ frame, registerEntry }}>{children}</FrameContext.Provider>;
}

export function useDashboardPresentationFrame(): DashboardPresentationFrame {
    return useContext(FrameContext).frame;
}

export function usePresentationRegistration(entry: WidgetPresentationEntry): void {
    const { registerEntry } = useContext(FrameContext);
    useEffect(() => registerEntry(entry), [entry, registerEntry]);
}
