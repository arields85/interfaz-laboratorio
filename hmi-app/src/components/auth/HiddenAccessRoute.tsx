import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { setHiddenAccessRevealed } from '../../services/hiddenAccess.service';
import { useLoginOverlayStore } from '../../store/loginOverlay.store';

// The /acceso entry: reveals the users icon and the Leda control in this browser, opens the
// login and leaves the address bar on "/" so the hidden URL is not kept in the history.
export default function HiddenAccessRoute() {
    const navigate = useNavigate();

    useEffect(() => {
        setHiddenAccessRevealed(true);
        useLoginOverlayStore.getState().setOpen(true);
        navigate('/', { replace: true });
    }, [navigate]);

    return null;
}
