import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { NewMessageAlerts } from '@/features/notifications/NewMessageAlerts';

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Alerta global de nova mensagem no WhatsApp (som + toast + notificação). */}
      <NewMessageAlerts />
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
