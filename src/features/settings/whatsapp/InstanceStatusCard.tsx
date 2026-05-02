import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { QrDisplay } from './QrDisplay';
import { formatPhoneBR, relativeTime } from './helpers';
import type { InstanceStatusResponse } from './types';

interface Props {
  data: InstanceStatusResponse | undefined;
  isLoading: boolean;
}

export function InstanceStatusCard({ data, isLoading }: Props) {
  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Empty state — sem instância configurada
  if (!data.configured) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <span className="text-3xl">📱</span>
        </div>
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-2">Pronto para Conectar</h3>
        <p className="text-xs text-muted-foreground max-w-md">
          Assim que você criar ou reconectar a instância, o QR e os detalhes de conexão aparecem aqui.
        </p>
      </div>
    );
  }

  // Pairing — mostra QR
  if (data.status === 'pairing' && data.qrCode) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <QrDisplay qrCode={data.qrCode} />
      </div>
    );
  }

  // Connected — info do número pareado
  if (data.status === 'connected') {
    return (
      <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-4">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
            {(data.profileName ?? '?').slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base truncate">
            {data.profileName ?? 'WhatsApp Conectado'}
          </h3>
          {data.phoneNumber && (
            <p className="text-sm text-muted-foreground">{formatPhoneBR(data.phoneNumber)}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Última verificação: {relativeTime(data.lastStatusAt)}
          </p>
        </div>
      </div>
    );
  }

  // Error — falha de comunicação com UazAPI
  if (data.status === 'error') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <h3 className="text-sm font-semibold text-destructive mb-2">Erro de comunicação com UazAPI</h3>
        <p className="text-xs text-muted-foreground">
          Não conseguimos consultar o status da instância. Tentando novamente automaticamente.
        </p>
      </div>
    );
  }

  // Disconnected (configured mas sem pareamento)
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-8 text-center">
      <h3 className="text-sm font-semibold mb-2">Instância configurada, desconectada</h3>
      <p className="text-xs text-muted-foreground">
        Clique em <strong>Conectar instância</strong> para gerar um novo QR.
      </p>
    </div>
  );
}
