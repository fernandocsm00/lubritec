import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plug, PlugZap, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/features/auth/store';
import { useConnect, useDisconnect, useDeleteInstance } from './api';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { InstanceStatusResponse } from './types';

interface Props {
  data: InstanceStatusResponse | undefined;
}

export function ConnectionControls({ data }: Props) {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const connect = useConnect();
  const disconnect = useDisconnect();
  const deleteFn = useDeleteInstance();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const configured = !!data?.configured;
  const isConnected = data?.status === 'connected';

  async function doConnect() {
    try {
      await connect.mutateAsync({});
      toast.success(configured ? 'Conexão atualizada.' : 'Instância criada — escaneie o QR.');
    } catch (err) {
      toast.error(`Falha ao conectar instância: ${errorMessage(err)}`);
    }
  }

  async function doDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast.success('Desconectado.');
    } catch (err) {
      toast.error(`Falha ao desconectar: ${errorMessage(err)}`);
    }
  }

  async function doDelete() {
    try {
      await deleteFn.mutateAsync();
      toast.success('Instância apagada.');
      setConfirmOpen(false);
    } catch (err) {
      toast.error(`Falha ao apagar: ${errorMessage(err)}`);
    }
  }

  function errorMessage(err: unknown): string {
    if (err instanceof Error && err.message) return err.message;
    return 'erro desconhecido';
  }

  return (
    <div className="space-y-3">
      {isAdmin ? (
        <>
          <Button
            size="lg"
            className="w-full"
            onClick={doConnect}
            disabled={connect.isPending}
          >
            {connect.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plug className="h-4 w-4 mr-2" />
            )}
            {connect.isPending ? 'Conectando…' : 'Conectar Instância'}
          </Button>

          {configured && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={doDisconnect}
                disabled={!isConnected || disconnect.isPending}
              >
                <PlugZap className="h-4 w-4 mr-2" />
                Desconectar
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setConfirmOpen(true)}
                disabled={deleteFn.isPending}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Apagar
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          Apenas administradores podem conectar, desconectar ou trocar o número de
          WhatsApp da equipe.
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Credenciais protegidas no servidor
      </div>

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={doDelete}
        pending={deleteFn.isPending}
      />
    </div>
  );
}
