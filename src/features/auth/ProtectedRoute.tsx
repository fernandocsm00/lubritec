import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store';
import { useMe } from './api';

export function ProtectedRoute() {
  const { status, accessToken } = useAuthStore();
  const location = useLocation();

  // Tenta hidratar via cookie de refresh na primeira render.
  // Guarda contra StrictMode double-invoke lendo status ao vivo do store.
  useEffect(() => {
    if (useAuthStore.getState().status !== 'idle') return;
    useAuthStore.setState({ status: 'authenticating' });
    fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) useAuthStore.getState().setAuth(data.user, data.accessToken);
        else useAuthStore.getState().clear();
      })
      .catch(() => useAuthStore.getState().clear());
  }, []);

  // Re-fetch /me quando autenticado para garantir dados atualizados
  useMe(status === 'authenticated' && !!accessToken);

  if (status === 'idle' || status === 'authenticating') {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando…</div>;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
