export type VoiceSaveStatus = 'dirty' | 'saving' | 'saved' | 'error' | null;

export const VOICE_SAVE_STATUS_UI: Record<Exclude<VoiceSaveStatus, null>, { label: string; className: string }> = {
    dirty: { label: 'Cambios sin guardar', className: 'text-status-warning' },
    saving: { label: 'Guardando...', className: 'text-admin-accent' },
    saved: { label: 'Guardado', className: 'text-status-normal' },
    error: { label: 'Error al guardar', className: 'text-status-critical' },
};
