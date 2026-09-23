import { AlertCircle, RefreshCw } from 'lucide-react';

// =============================================================================
// ErrorState
// Error visual consistente. Se renderiza cuando una query falla (isError: true)
// o cuando un servicio no responde.
// Arquitectura Técnica v1.3 §9.9 — Directiva Maestra §14.2
// =============================================================================

interface ErrorStateProps {
    title?: string;
    message?: string;
    onRetry?: () => void;
    className?: string;
}

export default function ErrorState({
    title = 'Error de conexión',
    message = 'No se pudo obtener la información. Verifique la fuente de datos.',
    onRetry,
    className = '',
}: ErrorStateProps) {
    return (
        <div className={`flex flex-col items-center justify-center py-16 px-6 gap-4 text-center ${className}`}>
            <div className="w-14 h-14 rounded-2xl bg-accent-ruby/10 border border-accent-ruby/30 flex items-center justify-center">
                <AlertCircle size={24} className="text-accent-ruby" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-1">
                <p className="text-industrial-text">{title}</p>
                {message && (
                    <p className="text-industrial-muted max-w-xs">{message}</p>
                )}
            </div>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-industrial-hover border border-industrial-border text-industrial-muted hover:text-industrial-text hover:bg-industrial-surface transition-colors"
                >
                    <RefreshCw size={14} />
                    Reintentar
                </button>
            )}
        </div>
    );
}
