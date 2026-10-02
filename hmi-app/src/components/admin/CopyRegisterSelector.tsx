import { useId } from 'react';

import type { CopyRegister } from '../../domain/copyRegister';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';

type CopyRegisterOption = {
    value: CopyRegister;
    label: string;
};

const COPY_REGISTER_OPTIONS: readonly CopyRegisterOption[] = [
    { value: 'usted', label: 'Usted (formal)' },
    { value: 'rioplatense', label: 'Rioplatense (vos)' },
    { value: 'neutro', label: 'Neutro (tú)' },
];

type CopyRegisterSelectorProps = {
    value: CopyRegister;
    onChange: (register: CopyRegister) => void;
};

export default function CopyRegisterSelector({ value, onChange }: CopyRegisterSelectorProps) {
    const headingId = useId();
    const hintId = useId();

    return (
        <section aria-labelledby={headingId} className={`${ADMIN_SIDEBAR_SECTION_CLS} p-4`}>
            <div id={headingId} className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                Trato al usuario
            </div>
            <p id={hintId} className={`mb-4 ${ADMIN_SIDEBAR_HINT_CLS}`}>
                Cambia cómo Leda se dirige a las personas en sus mensajes (Telegram, Canal A y Canal B). La HMI no cambia. Se aplica a todos los navegadores.
            </p>

            <div
                role="radiogroup"
                aria-label="Trato al usuario"
                aria-describedby={hintId}
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
                {COPY_REGISTER_OPTIONS.map((option) => {
                    const isSelected = option.value === value;

                    return (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            aria-label={option.label}
                            onClick={() => onChange(option.value)}
                            className={[
                                ADMIN_SIDEBAR_SECTION_CLS,
                                'flex items-center justify-between gap-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/40',
                                isSelected ? 'border-admin-accent/60 bg-admin-accent/5' : 'hover:border-white/20',
                            ].join(' ')}
                        >
                            <span className="text-white">{option.label}</span>
                            <span
                                aria-hidden="true"
                                className={[
                                    'h-3 w-3 shrink-0 rounded-full border',
                                    isSelected ? 'border-admin-accent bg-admin-accent' : 'border-white/30',
                                ].join(' ')}
                            />
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
