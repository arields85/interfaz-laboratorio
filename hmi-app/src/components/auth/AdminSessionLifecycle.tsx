import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import { adminSessionController } from '../../services/adminSession.controller';

interface AdminSessionLifecycleProps {
    controller?: typeof adminSessionController;
}

// Leaving /admin (Ver viewer, browser history, or any other admin -> non-admin
// route transition) must not end the admin session (user decision 2026-09-23,
// reversing the 2026-09-18 PAC-4B design). The admin session now ends only via
// "Cerrar sesion", LoginOverlay's explicit exit, backend expiry/revocation, or
// another existing non-navigation path -- never as a side effect of navigation.
export default function AdminSessionLifecycle({ controller = adminSessionController }: AdminSessionLifecycleProps) {
    useEffect(() => {
        controller.start();
        return () => controller.stop();
    }, [controller]);

    return <Outlet />;
}
