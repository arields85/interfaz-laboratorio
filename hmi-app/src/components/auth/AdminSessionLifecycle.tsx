import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { adminSessionController } from '../../services/adminSession.controller';

interface AdminSessionLifecycleProps {
    controller?: typeof adminSessionController;
}

export default function AdminSessionLifecycle({ controller = adminSessionController }: AdminSessionLifecycleProps) {
    const location = useLocation();
    const previousPath = useRef(location.pathname);

    useEffect(() => {
        controller.start();
        return () => controller.stop();
    }, [controller]);

    useEffect(() => {
        const previousWasAdmin = previousPath.current.startsWith('/admin');
        const currentIsAdmin = location.pathname.startsWith('/admin');
        previousPath.current = location.pathname;
        if (previousWasAdmin && !currentIsAdmin) void controller.exit();
    }, [controller, location.pathname]);

    return <Outlet />;
}
