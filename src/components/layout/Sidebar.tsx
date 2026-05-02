import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Briefcase,
  Users,
  ShieldCheck,
  Settings as SettingsIcon,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/features/auth/store';
import { BrandLockup } from '@/components/brand/BrandMark';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  group: 'op' | 'sys';
  adminOnly?: boolean;
  salesOnly?: boolean;
}

const items: NavItem[] = [
  { to: '/dashboard',    label: 'Dashboard',     icon: LayoutDashboard, group: 'op' },
  { to: '/whatsapp',     label: 'WhatsApp Inbox', icon: MessageSquare,  group: 'op' },
  { to: '/inside-sales', label: 'Inside Sales',  icon: Briefcase,      group: 'op', salesOnly: true },
  { to: '/cadastros',    label: 'Cadastros',     icon: Users,          group: 'op' },
  { to: '/admin',        label: 'Admin',         icon: ShieldCheck,    group: 'sys', adminOnly: true },
  { to: '/settings',     label: 'Configurações', icon: SettingsIcon,   group: 'sys' },
];

export function Sidebar() {
  const role = useAuthStore((s) => s.user?.role);
  const user = useAuthStore((s) => s.user);
  const visible = items.filter((i) => {
    if (i.adminOnly && role !== 'admin') return false;
    if (i.salesOnly && role !== 'admin' && role !== 'comercial') return false;
    return true;
  });
  const ops = visible.filter((i) => i.group === 'op');
  const sys = visible.filter((i) => i.group === 'sys');

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside
      className="hidden md:flex md:flex-col w-[248px] relative overflow-hidden text-white/90"
      style={{ background: 'var(--lc-navy)' }}
    >
      <div className="lc-hex-pattern absolute inset-0 pointer-events-none opacity-100" />

      {/* Brand */}
      <div className="px-[18px] pt-5 pb-4 relative">
        <BrandLockup size={26} dark />
      </div>

      {/* Search hint */}
      <div className="px-[14px] pb-3.5 relative">
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-white/[0.06] border border-white/[0.08] text-xs text-white/55">
          <Search className="h-3.5 w-3.5" />
          <span>Buscar lead, deal…</span>
          <span className="ml-auto font-mono text-[10px] px-1.5 py-px rounded bg-white/[0.08]">⌘K</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 relative flex flex-col gap-0.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/55 px-2 pt-2.5 pb-1.5">
          Operação
        </div>
        {ops.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}

        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/55 px-2 pt-3.5 pb-1.5">
          Sistema
        </div>
        {sys.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>

      {/* Footer status + user */}
      <div className="p-3 relative">
        <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: 'hsl(var(--success))', boxShadow: '0 0 8px hsl(var(--success))' }}
            />
            <span className="text-[11px] font-semibold text-white">WhatsApp conectado</span>
          </div>
          <div className="text-[10px] text-white/55 font-mono">uazAPI · last sync 12s</div>
        </div>

        <div className="flex items-center gap-2.5 mt-3 px-1">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--lc-ruby), var(--lc-navy-soft))',
            }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-white leading-tight truncate">{user?.name}</div>
            <div className="text-[10px] text-white/55 font-mono">{role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-colors',
          isActive
            ? 'bg-[rgba(232,163,23,0.12)] text-white font-semibold'
            : 'text-white/85 font-medium hover:bg-white/[0.06]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute -left-2.5 top-1.5 bottom-1.5 w-[3px] rounded"
              style={{ background: 'var(--lc-amber)' }}
            />
          )}
          <item.icon
            className="h-4 w-4 shrink-0"
            style={{ color: isActive ? 'var(--lc-amber)' : '#9CB0C7' }}
          />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}
