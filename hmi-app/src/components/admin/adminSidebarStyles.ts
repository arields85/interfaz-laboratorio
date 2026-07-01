// =============================================================================
// Admin sidebar style primitives
// Base visual contract for admin property sidebars and compact inspector panels.
// Reference source: PropertyDock.
// =============================================================================

export const ADMIN_SIDEBAR_PANEL_CLS = 'h-full w-full overflow-y-auto hmi-scrollbar bg-industrial-surface';
export const ADMIN_SIDEBAR_PANEL_HEADER_CLS = 'sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-industrial-surface px-4 py-3';
export const ADMIN_SIDEBAR_PANEL_TITLE_CLS = 'uppercase text-industrial-muted';
export const ADMIN_CONTEXT_BAR_LABEL_CLS = 'uppercase text-industrial-muted';
export const ADMIN_SIDEBAR_PANEL_STACK_CLS = 'flex flex-col gap-3 p-3';

export const ADMIN_SIDEBAR_SECTION_CLS = 'rounded-lg border border-white/10 bg-black/10';
export const ADMIN_SIDEBAR_SECTION_BUTTON_CLS = 'flex w-full items-center justify-between px-3 py-2';
export const ADMIN_SIDEBAR_SECTION_BODY_CLS = 'flex flex-col gap-2 px-3 pb-3';
export const ADMIN_SIDEBAR_SECTION_HEADER_CLS = 'mb-2 flex items-center gap-1.5 uppercase text-industrial-muted';
export const ADMIN_SIDEBAR_LABEL_CLS = 'w-14 whitespace-nowrap text-industrial-muted';
export const ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS = 'w-24 max-w-full shrink-0';
export const ADMIN_SIDEBAR_INPUT_CLS = 'w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-white transition-colors focus:border-admin-accent/50 focus:outline-none';
export const ADMIN_SIDEBAR_INPUT_TRIGGER_CLS = `${ADMIN_SIDEBAR_INPUT_CLS} flex items-center justify-between gap-1`;
export const ADMIN_SIDEBAR_INPUT_TRIGGER_DISABLED_CLS = 'cursor-not-allowed opacity-50 text-white/40';
export const ADMIN_SIDEBAR_INPUT_TRIGGER_ENABLED_CLS = 'hover:border-white/20';
export const ADMIN_SIDEBAR_HINT_CLS = 'text-industrial-muted';
export const ADMIN_SIDEBAR_INLINE_ROW_CLS = 'flex min-w-0 items-center gap-2';
export const ADMIN_SIDEBAR_INLINE_LABEL_CLS = 'shrink-0 whitespace-nowrap text-industrial-muted';
export const ADMIN_SIDEBAR_DISCLOSURE_BUTTON_CLS = 'flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/5';
export const ADMIN_SIDEBAR_DISCLOSURE_BODY_CLS = 'ml-2 border-l border-white/10 pl-2';
export const ADMIN_SIDEBAR_DROPDOWN_PANEL_CLS = 'rounded-md border border-white/10 py-1 shadow-xl';
export const ADMIN_SIDEBAR_INFO_LIST_CLS = 'flex flex-col gap-2';
export const ADMIN_SIDEBAR_INFO_ITEM_CLS = 'px-3 py-1.5';
export const ADMIN_SIDEBAR_INFO_TITLE_CLS = 'text-white';
