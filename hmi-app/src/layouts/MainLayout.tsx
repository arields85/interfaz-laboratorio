import { Outlet } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import EventHorizonBackground from '../components/ui/EventHorizonBackground';

export default function MainLayout() {
    return (
        <div className="relative flex flex-col w-full h-viewport">
            <EventHorizonBackground />
            <Topbar />
            <main className="relative z-10 flex-1 overflow-y-auto hmi-scrollbar p-4 pb-20 md:p-6 md:pb-6">
                <Outlet />
            </main>
        </div>
    );
}
