import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/features/auth/store';
import { useLogout } from '@/features/auth/api';
import { useNavigate, useLocation } from 'react-router-dom';
import { NotificationBell } from '@/features/notifications/NotificationBell';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  whatsapp: 'WhatsApp Inbox',
  'inside-sales': 'Inside Sales',
  cadastros: 'Cadastros',
  admin: 'Admin',
  settings: 'Configurações',
};

export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  const seg = location.pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
  const crumb = ROUTE_LABELS[seg] ?? seg;

  const initials = user?.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="h-[60px] px-6 border-b border-border bg-card flex items-center gap-4">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-muted-foreground font-medium">LubriConnect</span>
        <span className="text-border">/</span>
        <span className="text-foreground font-semibold">{crumb}</span>
      </div>

      <div className="flex-1" />

      <div
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted border border-border text-[11px] font-mono"
        style={{ color: 'var(--lc-navy-deep)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'hsl(var(--success))' }} />
        operação online · 12s atrás
      </div>

      <NotificationBell />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{
                background: 'linear-gradient(135deg, var(--lc-ruby), var(--lc-navy-soft))',
              }}
            >
              {initials}
            </div>
            <span className="hidden sm:inline text-sm font-medium">{user?.name}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/settings')}>Configurações</DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              await logout.mutateAsync();
              navigate('/login');
            }}
          >
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
