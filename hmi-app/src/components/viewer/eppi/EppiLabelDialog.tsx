import { type KeyboardEvent, type MouseEvent } from 'react';
import { Printer } from 'lucide-react';
import AdminActionButton from '../../admin/AdminActionButton';
import HmiButton from '../../ui/HmiButton';
import RuntimeDialog from '../../ui/RuntimeDialog';
import RuntimeField from '../../ui/RuntimeField';
import EppiStatusValue from './EppiStatusValue';

type EppiLabelKind = 'Limpio' | 'Para limpiar' | 'En proceso' | 'En proceso (en campaña)';

interface EppiLabelField {
    label: string;
    type?: 'date' | 'datetime-local' | 'text';
    value?: string;
    multiline?: boolean;
}

interface EppiLabelDialogProps {
    kind: EppiLabelKind | 'select' | null;
    onClose: () => void;
    onSelect: (kind: EppiLabelKind) => void;
}

const LABEL_KINDS: readonly EppiLabelKind[] = ['Limpio', 'Para limpiar', 'En proceso', 'En proceso (en campaña)'];

const FIELD_SETS: Readonly<Record<EppiLabelKind, readonly EppiLabelField[]>> = {
    Limpio: [
        { label: 'Producto anterior' },
        { label: 'Lote anterior' },
        { label: 'Orden anterior' },
        { label: 'Ambiente/Equipo' },
        { label: 'Tag' },
        { label: 'Fecha/Hora', type: 'datetime-local', value: '2026-08-24T10:54' },
        { label: 'Validez', type: 'date', value: '2026-08-27' },
        { label: 'Realizó' },
        { label: 'Verificó' },
        { label: 'Observaciones', multiline: true },
    ],
    'Para limpiar': [
        { label: 'Producto' },
        { label: 'Lote/Partida' },
        { label: 'Orden' },
        { label: 'Ambiente/Equipo' },
        { label: 'Tag' },
        { label: 'Responsable' },
        { label: 'Fecha/Hora', type: 'datetime-local', value: '2026-08-24T10:55' },
        { label: 'Observaciones', multiline: true },
    ],
    'En proceso': [
        { label: 'Producto' },
        { label: 'Lote/Partida' },
        { label: 'Orden' },
        { label: 'Ambiente/Equipo' },
        { label: 'Tag' },
        { label: 'Producto anterior' },
        { label: 'Fecha/Hora', type: 'datetime-local', value: '2026-08-24T10:55' },
        { label: 'Realizó' },
        { label: 'Verificó' },
        { label: 'Observaciones', multiline: true },
    ],
    'En proceso (en campaña)': [
        { label: 'Producto' },
        { label: 'Lote/Partida' },
        { label: 'Orden' },
        { label: 'Ambiente/Equipo' },
        { label: 'Tag' },
        { label: 'Producto anterior' },
        { label: 'Fecha/Hora', type: 'datetime-local', value: '2026-08-24T10:55' },
        { label: 'Realizó' },
        { label: 'Verificó' },
        { label: 'Observaciones', multiline: true, value: 'Producto en campaña' },
    ],
};

function suppressUnavailableClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
}

function suppressUnavailableKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
    }
}

export default function EppiLabelDialog({ kind, onClose, onSelect }: EppiLabelDialogProps) {
    const selectedKind = kind === 'select' ? null : kind;

    return (
        <RuntimeDialog
            open={kind !== null}
            title={selectedKind ?? 'Seleccionar tipo de rótulo'}
            onClose={onClose}
        >
            {selectedKind === null ? (
                <div>
                    <p className="pb-5 font-system text-industrial-muted">
                        Elegí la plantilla que querés completar e imprimir.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        {LABEL_KINDS.map((labelKind) => (
                            <HmiButton
                                key={labelKind}
                                variant="secondary"
                                className="min-h-16"
                                aria-label={labelKind}
                                onClick={() => onSelect(labelKind)}
                            >
                                <EppiStatusValue value={labelKind} />
                            </HmiButton>
                        ))}
                    </div>
                </div>
            ) : (
                <form
                    className="grid grid-cols-2 gap-3.5"
                    onSubmit={(event) => event.preventDefault()}
                >
                    {FIELD_SETS[selectedKind].map((field) => (
                        <RuntimeField
                            key={field.label}
                            label={field.label}
                            type={field.type}
                            multiline={field.multiline}
                            defaultValue={field.value}
                        />
                    ))}
                    <div className="col-span-2 flex justify-end pt-1.5">
                        <AdminActionButton
                            variant="primary"
                            aria-label="Imprimir Rótulo"
                            aria-disabled="true"
                            data-unavailable="true"
                            title="No disponible en modo de consulta"
                            onClick={suppressUnavailableClick}
                            onKeyDown={suppressUnavailableKey}
                            onKeyUp={suppressUnavailableKey}
                        >
                            <Printer size={14} strokeWidth={2} aria-hidden="true" />
                            Imprimir
                        </AdminActionButton>
                    </div>
                </form>
            )}
        </RuntimeDialog>
    );
}

export type { EppiLabelDialogProps, EppiLabelKind };
