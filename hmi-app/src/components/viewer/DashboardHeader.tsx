import { Edit2 } from 'lucide-react';
import { useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react';
import type { Dashboard, DashboardView, WidgetType } from '../../domain/admin.types';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { HierarchyContext } from '../../widgets/resolvers/hierarchyResolver';
import HoverTooltip from '../ui/HoverTooltip';
import AdminTag from '../admin/AdminTag';
import { getDashboardHeaderSubtitle, getDashboardHeaderTitle } from '../../utils/dashboardHeader';
import { getDashboardViewIconComponent } from '../../utils/dashboardViewIcons';
import { resolveDashboardViewIconKey } from '../../utils/dashboardViewPresentation';
import HeaderWidgetCanvas from './HeaderWidgetCanvas';
import { HEADER_VIEW_ICON_BUTTON_ACTIVE_CLS, HEADER_VIEW_ICON_BUTTON_CLS } from '../layout/topbarIconButtonStyles';

// =============================================================================
// DashboardHeader
// Header configurable del dashboard público (Visor Operativo) y del
// Builder Admin (modo preview).
// =============================================================================

interface InlineEditableTextProps {
    value?: string;
    fallback?: string;
    placeholder: string;
    onCommit: (value: string) => void;
    className: string;
    emptyClassName?: string;
    inputClassName: string;
    multiline?: boolean;
    textStyle?: CSSProperties;
    inputStyle?: CSSProperties;
    showPlaceholderWhenEmpty?: boolean;
}

function InlineEditableText({
    value,
    fallback,
    placeholder,
    onCommit,
    className,
    emptyClassName,
    inputClassName,
    multiline = false,
    textStyle,
    inputStyle,
    showPlaceholderWhenEmpty = true,
}: InlineEditableTextProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [draftValue, setDraftValue] = useState(value ?? '');

    const displayValue = value ?? fallback ?? '';

    const commit = () => {
        onCommit(draftValue);
        setIsEditing(false);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !multiline) {
            event.preventDefault();
            commit();
        }

        if (event.key === 'Escape') {
            setDraftValue(value ?? '');
            setIsEditing(false);
        }
    };

    if (isEditing) {
        if (multiline) {
            return (
                <textarea
                    autoFocus
                    rows={2}
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    onBlur={commit}
                    onKeyDown={handleKeyDown}
                    placeholder={fallback ?? placeholder}
                    className={inputClassName}
                    style={inputStyle}
                />
            );
        }

        return (
            <input
                autoFocus
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                onBlur={commit}
                onKeyDown={handleKeyDown}
                placeholder={fallback ?? placeholder}
                className={inputClassName}
                style={inputStyle}
            />
        );
    }

    return (
        <button
            type="button"
            onClick={() => {
                setDraftValue(value ?? '');
                setIsEditing(true);
            }}
            className="group flex items-center gap-2 text-left"
            title="Editar directamente en el preview"
        >
            <span className={`${className} ${!displayValue ? emptyClassName ?? '' : ''}`} style={textStyle}>
                {displayValue || (showPlaceholderWhenEmpty ? placeholder : '')}
            </span>
            <Edit2 size={14} className="shrink-0 text-industrial-muted/50 transition-colors group-hover:text-admin-accent" />
        </button>
    );
}

interface DashboardHeaderViewerProps {
    mode?: 'viewer';
    dashboard: Dashboard;
    activeViewId?: string;
    equipmentMap: Map<string, EquipmentSummary>;
    connection?: ConnectionHealth;
    machines?: ContractMachine[];
    onTitleChange?: never;
    onSubtitleChange?: never;
    onHeaderDragEnter?: never;
    onHeaderDragOver?: never;
    onHeaderDragLeave?: never;
    onHeaderDrop?: never;
    onRemoveHeaderWidget?: never;
    onDeleteHeaderWidget?: never;
    onMoveHeaderWidget?: never;
    selectedWidgetId?: never;
    onSelectHeaderWidget?: never;
    isHeaderDropActive?: never;
    canDropHeaderWidget?: never;
    onAddHeaderWidget?: never;
    onDropWidgetAtSlot?: never;
    onNavigateDashboard?: (dashboardId: string) => void;
    onSelectView?: (viewId: string) => void;
    hierarchyContext?: HierarchyContext;
}

interface DashboardHeaderPreviewProps {
    mode: 'preview';
    dashboard: Dashboard;
    activeViewId?: string;
    equipmentMap: Map<string, EquipmentSummary>;
    connection?: ConnectionHealth;
    machines?: ContractMachine[];
    onTitleChange?: (value: string) => void;
    onSubtitleChange?: (value: string) => void;
    onHeaderDragEnter?: (event: DragEvent<HTMLDivElement>) => void;
    onHeaderDragOver?: (event: DragEvent<HTMLDivElement>) => void;
    onHeaderDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
    onHeaderDrop?: (event: DragEvent<HTMLDivElement>) => void;
    onRemoveHeaderWidget?: (widgetId: string) => void;
    onDeleteHeaderWidget?: (widgetId: string) => void;
    onMoveHeaderWidget?: (widgetId: string, targetColumn: number) => void;
    selectedWidgetId?: string;
    onSelectHeaderWidget?: (widgetId: string) => void;
    isHeaderDropActive?: boolean;
    canDropHeaderWidget?: boolean;
    /** Crea un widget nuevo del tipo dado y lo asigna al header en el slot indicado */
    onAddHeaderWidget?: (type: WidgetType, slotIndex: number) => void;
    /** Asigna un widget existente (arrastrado desde el grid) al slot indicado */
    onDropWidgetAtSlot?: (widgetId: string, slotIndex: number) => void;
    onNavigateDashboard?: never;
    onSelectView?: (viewId: string) => void;
    hierarchyContext?: HierarchyContext;
}

type DashboardHeaderProps = DashboardHeaderViewerProps | DashboardHeaderPreviewProps;

interface DashboardHeaderSubtitleRowProps {
    activeViewName?: string;
    subtitle?: string;
    isEditablePreview: boolean;
    subtitleFallback?: string;
    onSubtitleChange?: (value: string) => void;
}

function DashboardHeaderSubtitleRow({
    activeViewName,
    subtitle,
    isEditablePreview,
    subtitleFallback,
    onSubtitleChange,
}: DashboardHeaderSubtitleRowProps) {
    if (!activeViewName && !subtitle && !isEditablePreview) {
        return null;
    }

    const subtitleText = subtitle?.trim();
    const shouldRenderSeparator = Boolean(activeViewName && subtitleText);

    return (
        <div className="mt-1 flex flex-wrap items-center gap-2">
            {activeViewName ? <AdminTag label={activeViewName} variant="admin" /> : null}
            {shouldRenderSeparator ? <span className="text-industrial-muted uppercase">-</span> : null}
            {isEditablePreview ? (
                <InlineEditableText
                    value={subtitleText}
                    fallback={subtitleFallback}
                    placeholder="Subtítulo del header"
                    onCommit={(value) => onSubtitleChange?.(value)}
                    className="text-industrial-muted uppercase"
                    emptyClassName="text-industrial-muted/50"
                    inputClassName="w-full min-w-[20rem] resize-none bg-transparent text-industrial-muted uppercase border-b border-white/10 focus:border-admin-accent/60 focus:outline-none"
                    multiline
                    showPlaceholderWhenEmpty={false}
                />
            ) : subtitleText ? (
                <span className="text-industrial-muted uppercase">{subtitleText}</span>
            ) : null}
        </div>
    );
}

function DashboardViewNavigation({
    views,
    activeViewId,
    onSelectView,
}: {
    views: DashboardView[];
    activeViewId: string;
    onSelectView?: (viewId: string) => void;
}) {
    return (
        <div role="group" className="flex flex-wrap items-center gap-2" aria-label="Internal dashboard views">
            {views.map((view) => {
                const isActiveView = view.id === activeViewId;
                const Icon = getDashboardViewIconComponent(resolveDashboardViewIconKey(view));

                return (
                    <HoverTooltip key={view.id} label={view.name} position="bottom" className="flex">
                        <button
                            type="button"
                            aria-label={view.name}
                            aria-pressed={isActiveView}
                            onClick={() => onSelectView?.(view.id)}
                            className={[
                                HEADER_VIEW_ICON_BUTTON_CLS,
                                isActiveView ? HEADER_VIEW_ICON_BUTTON_ACTIVE_CLS : '',
                            ].filter(Boolean).join(' ')}
                        >
                            <Icon size={18} aria-hidden="true" />
                        </button>
                    </HoverTooltip>
                );
            })}
        </div>
    );
}

export default function DashboardHeader({
    mode = 'viewer',
    dashboard,
    activeViewId,
    equipmentMap,
    connection,
    machines,
    onTitleChange,
    onSubtitleChange,
    onHeaderDragEnter,
    onHeaderDragOver,
    onHeaderDragLeave,
    onHeaderDrop,
    onRemoveHeaderWidget,
    onDeleteHeaderWidget,
    onMoveHeaderWidget,
    selectedWidgetId,
    onSelectHeaderWidget,
    isHeaderDropActive,
    canDropHeaderWidget,
    onAddHeaderWidget,
    onDropWidgetAtSlot,
    onNavigateDashboard,
    onSelectView,
    hierarchyContext,
}: DashboardHeaderProps) {
    const headerConfig = dashboard.headerConfig;
    const title = getDashboardHeaderTitle(dashboard);
    const subtitle = getDashboardHeaderSubtitle(dashboard);

    const widgetMap = new Map(dashboard.widgets.map(widget => [widget.id, widget]));
    const headerWidgets = (headerConfig?.widgetSlots ?? [])
        .map(slot => widgetMap.get(slot.widgetId))
        .filter(Boolean) as typeof dashboard.widgets;

    // Mapa widgetId → columna (0-indexed). Cuando el slot tiene `column` explícita
    // se usa ese valor; si no, se usa la posición del slot en el array como fallback.
    const widgetColumnMap = new Map<string, number>(
        (headerConfig?.widgetSlots ?? []).map((slot, idx) => [
            slot.widgetId,
            slot.column ?? idx,
        ])
    );

    const isPreview = mode === 'preview';
    const isEditablePreview = isPreview && Boolean(onTitleChange) && Boolean(onSubtitleChange);
    const hasMultipleViews = (dashboard.views?.length ?? 0) > 1;
    const resolvedActiveViewId = activeViewId ?? dashboard.activeViewId ?? dashboard.views?.[0]?.id;
    const activeView = dashboard.views?.find((view) => view.id === resolvedActiveViewId) ?? dashboard.views?.[0];
    const hasInternalViewNavigation = hasMultipleViews && (!isPreview || Boolean(onSelectView));
    const activeViewName = activeView && hasMultipleViews ? activeView.name : undefined;
    const resolvedSubtitle = hasMultipleViews
        ? activeView?.subtitle?.trim() || subtitle?.trim()
        : subtitle?.trim();
    const previewSubtitleValue = hasMultipleViews
        ? activeView?.subtitle?.trim() || subtitle?.trim()
        : headerConfig?.subtitle || dashboard.description;
    const dashboardTitleTypography: CSSProperties = {
        fontFamily: 'var(--font-dashboard-title)',
        fontWeight: 'var(--font-weight-dashboard-title)',
        fontSize: 'var(--font-size-dashboard-title)',
        letterSpacing: 'var(--tracking-dashboard-title)',
    };

    return (
        <div className="flex shrink-0 items-start justify-between gap-6">
            <div data-testid="dashboard-header-title-block" className="min-w-0 flex-1">
                {isEditablePreview ? (
                    <div className="space-y-1.5">
                        <div>
                            <InlineEditableText
                                value={title}
                                placeholder="Título del header"
                                onCommit={(value) => onTitleChange?.(value)}
                                className="text-industrial-text leading-none"
                                emptyClassName="text-industrial-muted/60"
                                inputClassName="w-full min-w-[20rem] bg-transparent text-industrial-text leading-none border-b border-white/10 focus:border-admin-accent/60 focus:outline-none"
                                textStyle={dashboardTitleTypography}
                                inputStyle={dashboardTitleTypography}
                            />
                        </div>
                        <DashboardHeaderSubtitleRow
                            activeViewName={activeViewName}
                            subtitle={previewSubtitleValue}
                            isEditablePreview
                            subtitleFallback={dashboard.description}
                            onSubtitleChange={onSubtitleChange}
                        />
                    </div>
                ) : (
                    <>
                        <h1 className="text-industrial-text mb-1 leading-none" style={dashboardTitleTypography}>
                            {title}
                        </h1>
                        <DashboardHeaderSubtitleRow activeViewName={activeViewName} subtitle={resolvedSubtitle} isEditablePreview={false} />
                    </>
                )}

            </div>

            <div data-testid="dashboard-header-actions" className="flex items-center gap-3 self-center">
                {hasInternalViewNavigation && dashboard.views && resolvedActiveViewId && (
                    <DashboardViewNavigation
                        views={dashboard.views}
                        activeViewId={resolvedActiveViewId}
                        onSelectView={onSelectView}
                    />
                )}
                {(isPreview || headerWidgets.length > 0) && (
                        <HeaderWidgetCanvas
                            widgets={headerWidgets}
                            widgetColumnMap={widgetColumnMap}
                            equipmentMap={equipmentMap}
                            connection={connection}
                            machines={machines}
                            mode={isPreview ? 'preview' : 'viewer'}
                            onNavigateDashboard={onNavigateDashboard}
                            selectedWidgetId={selectedWidgetId}
                            onWidgetSelect={onSelectHeaderWidget}
                        onMoveWidget={onMoveHeaderWidget}
                        onRemoveWidget={onRemoveHeaderWidget}
                        onDeleteWidget={onDeleteHeaderWidget}
                        onHeaderDragEnter={onHeaderDragEnter}
                        onHeaderDragOver={onHeaderDragOver}
                        onHeaderDragLeave={onHeaderDragLeave}
                        onHeaderDrop={onHeaderDrop}
                        isHeaderDropActive={isHeaderDropActive}
                        canDropHeaderWidget={canDropHeaderWidget}
                        onAddHeaderWidget={onAddHeaderWidget}
                        onDropWidgetAtSlot={onDropWidgetAtSlot}
                        hierarchyContext={hierarchyContext}
                    />
                )}
            </div>
        </div>
    );
}
