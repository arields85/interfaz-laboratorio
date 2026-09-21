import { useId, useState } from 'react';

import { MAX_HMI_NAME_CHARACTERS } from '../../domain/hmiName';
import { readHmiName, saveHmiName } from '../../services/hmiName.service';
import { useAuthStore } from '../../store/auth.store';
import AdminActionButton from './AdminActionButton';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
} from './adminSidebarStyles';

export default function HmiNameSettings({ active }: { active: boolean }) {
    const session = useAuthStore((state) => state.session);
    const enabled = active && session.isAuthenticated
        && (session.user?.role.permissions.includes('admin:access') ?? false);

    // A gate transition remounts the local draft, discarding unsaved edits and feedback.
    return <HmiNameForm key={String(enabled)} enabled={enabled} />;
}

function HmiNameForm({ enabled }: { enabled: boolean }) {
    const inputId = useId();
    const hintId = useId();
    const [initial] = useState(() => enabled ? readHmiName() : { ok: true, name: null } as const);
    const [draft, setDraft] = useState(initial.name ?? '');
    const [feedback, setFeedback] = useState(initial.ok ? '' : 'No se pudo leer el nombre guardado.');

    const save = () => {
        const { session } = useAuthStore.getState();
        if (!enabled || !session.isAuthenticated
            || !session.user?.role.permissions.includes('admin:access')) return;
        const result = saveHmiName(draft);
        if (!result.ok) {
            setFeedback(result.error === 'invalid'
                ? `No se pudo guardar: ingresá un nombre válido de hasta ${MAX_HMI_NAME_CHARACTERS} caracteres.`
                : 'No se pudo guardar el nombre en este navegador.');
            return;
        }
        setDraft(result.name ?? '');
        setFeedback('Nombre guardado en este navegador');
    };

    return (
        <section className={`${ADMIN_SIDEBAR_SECTION_CLS} space-y-3 p-4`}>
            <h3 className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>Prisma · Nombre de HMI</h3>
            <label htmlFor={inputId} className={ADMIN_SIDEBAR_HINT_CLS}>Nombre de esta HMI</label>
            <input
                id={inputId}
                className={ADMIN_SIDEBAR_INPUT_CLS}
                aria-describedby={hintId}
                value={draft}
                disabled={!enabled}
                onChange={(event) => {
                    setDraft(event.target.value);
                    setFeedback('');
                }}
            />
            <p id={hintId} className={`text-xs ${ADMIN_SIDEBAR_HINT_CLS}`}>
                Se guarda en este navegador y se usa al confirmar esta HMI desde el teléfono.
                Dejalo vacío para quitar el nombre.
            </p>
            <AdminActionButton type="button" variant="secondary" disabled={!enabled} onClick={save}>
                Guardar nombre
            </AdminActionButton>
            <p aria-live="polite" className={`text-xs ${ADMIN_SIDEBAR_HINT_CLS}`}>{feedback}</p>
        </section>
    );
}
