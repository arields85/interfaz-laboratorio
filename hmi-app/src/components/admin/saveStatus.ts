export type SaveStatus = 'dirty' | 'saving' | 'saved' | 'error' | null;

export const SAVE_STATUS_UI: Record<Exclude<SaveStatus, null>, { label: string; className: string }> = {
    dirty: { label: 'Cambios sin guardar', className: 'text-status-warning' },
    saving: { label: 'Guardando...', className: 'text-admin-accent' },
    saved: { label: 'Guardado', className: 'text-status-normal' },
    error: { label: 'Error al guardar', className: 'text-status-critical' },
};
