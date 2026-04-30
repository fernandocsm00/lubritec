import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Briefcase,
  Users,
  ShieldCheck,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/features/auth/store';

const items = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { to: '/inside-sales', label: 'Inside Sales', icon: Briefcase },
  { to: '/cadastros', label: 'Cadastros', icon: Users },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
  { to: '/settings', label: 'Configurações', icon: SettingsIcon },
];

export function Sidebar() {
  const role = useAuthStore((s) => s.user?.role);
  const visible = items.filter((i) => !i.adminOnly || role === 'admin');

  return (
    <aside className="hidden w-60 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center px-5 font-semibold text-primary">
        LubriConnect
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
