import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import AdminLayout from '../layouts/AdminLayout';
import RequirePermission from '../components/auth/RequirePermission';
import DashboardManagerPage from '../pages/admin/DashboardManagerPage';
import DashboardBuilderPage from '../pages/admin/DashboardBuilderPage';
import HierarchyPage from '../pages/admin/HierarchyPage';
import Dashboard from '../pages/Dashboard';
import EquipmentDetail from '../pages/EquipmentDetail';
import AlertsPage from '../pages/AlertsPage';
import TrendsPage from '../pages/TrendsPage';
import ExplorerPage from '../pages/ExplorerPage';
import TraceabilityPage from '../pages/TraceabilityPage';
import OverviewPage from '../pages/OverviewPage';
import DiagnosticsPage from '../pages/DiagnosticsPage';
import LogsPage from '../pages/LogsPage';
import EppiViewer from '../components/viewer/eppi/EppiViewer';

// =============================================================================
// APP ROUTER
// Definición centralizada de rutas, separada de App.tsx.
// Usa createBrowserRouter (autocontenido — no requiere BrowserRouter externo).
// Arquitectura Técnica v1.3 §7.1 y §10
// =============================================================================

const router = createBrowserRouter([
    {
        path: '/',
        element: <MainLayout />,
        children: [
            { index: true, element: <Dashboard /> },
            { path: 'equipment/:equipmentId', element: <EquipmentDetail /> },
            { path: 'alerts', element: <AlertsPage /> },
            { path: 'trends', element: <TrendsPage /> },
            { path: 'explorer', element: <ExplorerPage /> },
            { path: 'traceability', element: <TraceabilityPage /> },
            { path: 'overview', element: <OverviewPage /> },
            { path: 'diagnostics', element: <DiagnosticsPage /> },
            { path: 'logs', element: <LogsPage /> },
            { path: 'eppi/*', element: <EppiViewer /> },
        ],
    },
    {
        path: '/admin',
        element: (
            <RequirePermission permission="admin:access">
                <AdminLayout />
            </RequirePermission>
        ),
        children: [
            { index: true, element: <Navigate to="dashboards" replace /> },
            { path: 'dashboards', element: <DashboardManagerPage /> },
            { path: 'builder/:id', element: <DashboardBuilderPage /> },
            { path: 'hierarchy', element: <HierarchyPage /> },
        ],
    },
]);

export default function AppRouter() {
    return <RouterProvider router={router} />;
}
