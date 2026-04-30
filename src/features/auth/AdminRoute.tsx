import { Outlet } from 'react-router-dom';
import { useAuthStore } from './store';

export function AdminRoute() {
  const { user } = useAuthStore();
  if (user?.role !== 'admin') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-semibold">403 — Acesso negado</h1>
        <p className="text-muted-foreground">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }
  return <Outlet />;
}
