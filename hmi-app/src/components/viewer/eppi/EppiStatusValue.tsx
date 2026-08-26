import AdminTag, { type AdminTagProps } from '../../admin/AdminTag';

const STATUS_VARIANTS: Readonly<Record<string, AdminTagProps['variant']>> = {
    Activo: 'green',
    'En curso': 'cyan',
    'En proceso': 'cyan',
    'En proceso (en campaña)': 'cyan',
    Limpio: 'green',
    Pendiente: 'amber',
    'Para limpiar': 'amber',
    'Sin asignar': 'amber',
    Verificado: 'green',
};

export default function EppiStatusValue({ value }: { value: string }) {
    const variant = STATUS_VARIANTS[value];
    if (!variant) {
        return value;
    }

    if (value === 'En proceso (en campaña)') {
        return (
            <span className="inline-flex items-center gap-1" aria-label={value}>
                <AdminTag label="En proceso" variant={variant} />
                <span>(en campaña)</span>
            </span>
        );
    }

    return <AdminTag label={value} variant={variant} />;
}
