import { useMemo, useState } from 'react';
import { useUsers } from '@/features/admin/api';
import { UsersTable } from '@/features/admin/UsersTable';
import { InviteUserDialog } from '@/features/admin/InviteUserDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserPlus } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store';
import type { AdminUser } from '@shared/types';

type Filter = 'all' | 'active' | 'pending' | 'inactive';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'pending', label: 'Convite pendente' },
  { value: 'inactive', label: 'Inativos' },
];

function matchesFilter(u: AdminUser, f: Filter) {
  if (f === 'all') return true;
  if (f === 'active') return u.is_active && u.has_password;
  if (f === 'pending') return u.is_active && !u.has_password;
  return !u.is_active;
}

export default function AdminPage() {
  const { data: users, isLoading, isError, refetch } = useUsers();
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => matchesFilter(u, filter))
      .filter(
        (u) =>
          q === '' ||
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      );
  }, [users, search, filter]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuários</h1>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Convidar usuário
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por nome ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={filter === f.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-center gap-3 rounded-md border bg-card p-12">
          <p className="text-sm text-muted-foreground">Erro ao carregar usuários.</p>
          <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : !isLoading && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border bg-card p-12">
          <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
          {users?.length === 0 && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Convidar o primeiro
            </Button>
          )}
        </div>
      ) : (
        <UsersTable
          users={filtered}
          isLoading={isLoading}
          currentUserId={me?.id ?? ''}
        />
      )}

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
