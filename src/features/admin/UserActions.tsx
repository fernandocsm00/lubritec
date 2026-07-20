import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { EditUserDialog } from './EditUserDialog';
import { SetPasswordDialog } from './SetPasswordDialog';
import { useUpdateUser, useResendInvite } from './api';
import { translateError } from './translateError';
import type { AdminUser } from '@shared/types';

export function UserActions({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  const [setPasswordOpen, setSetPasswordOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const update = useUpdateUser();
  const resend = useResendInvite();

  async function toggleActive() {
    try {
      await update.mutateAsync({ id: user.id, is_active: !user.is_active });
      toast.success(user.is_active ? 'Usuário desativado.' : 'Usuário reativado.');
    } catch (e) {
      toast.error(translateError(e));
    }
  }

  async function onResend() {
    try {
      await resend.mutateAsync(user.id);
      toast.success(`Convite reenviado para ${user.email}.`);
    } catch (e) {
      toast.error(translateError(e));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Ações para ${user.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Editar</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSetPasswordOpen(true)}>
            Definir senha
          </DropdownMenuItem>
          {user.is_active ? (
            <DropdownMenuItem
              disabled={isSelf}
              onSelect={() => !isSelf && setDeactivateOpen(true)}
            >
              {isSelf ? 'Desativar (você não pode)' : 'Desativar'}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={isSelf} onSelect={() => !isSelf && toggleActive()}>
              Reativar
            </DropdownMenuItem>
          )}
          {!user.has_password && (
            <DropdownMenuItem onSelect={onResend} disabled={resend.isPending}>
              Reenviar convite
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUserDialog
        user={user}
        isSelf={isSelf}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <SetPasswordDialog
        user={user}
        open={setPasswordOpen}
        onOpenChange={setSetPasswordOpen}
      />

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as sessões dele serão encerradas imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={toggleActive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
