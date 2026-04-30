import type { AdminUser } from '@shared/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { UserActions } from './UserActions';

const ROLE_LABEL: Record<AdminUser['role'], string> = {
  admin: 'Admin',
  comercial: 'Comercial',
  recepcao: 'Recepção',
};

const ROLE_VARIANT: Record<AdminUser['role'], 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  comercial: 'secondary',
  recepcao: 'outline',
};

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Nunca';
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.round(days / 30);
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

export function UsersTable({
  users,
  isLoading,
  currentUserId,
}: {
  users: AdminUser[];
  isLoading: boolean;
  currentUserId: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Último login</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => {
          const status = !u.is_active
            ? { label: 'Inativo', className: 'bg-muted text-muted-foreground' }
            : !u.has_password
              ? { label: 'Convite pendente', className: 'bg-yellow-100 text-yellow-900' }
              : { label: 'Ativo', className: 'bg-green-100 text-green-900' };
          return (
            <TableRow key={u.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {initials(u.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={ROLE_VARIANT[u.role]}>{ROLE_LABEL[u.role]}</Badge>
              </TableCell>
              <TableCell>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${status.className}`}>
                  {status.label}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatRelative(u.last_login_at)}
              </TableCell>
              <TableCell>
                <UserActions user={u} isSelf={u.id === currentUserId} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
