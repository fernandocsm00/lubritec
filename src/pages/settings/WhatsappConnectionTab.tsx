import { Users } from 'lucide-react';
import { useInstanceStatus } from '@/features/settings/whatsapp/api';
import { StatusBadges } from '@/features/settings/whatsapp/StatusBadges';
import { ConnectionControls } from '@/features/settings/whatsapp/ConnectionControls';
import { InstanceStatusCard } from '@/features/settings/whatsapp/InstanceStatusCard';

export default function WhatsappConnectionTab() {
  const { data, isLoading, isError } = useInstanceStatus();

  return (
    <div className="max-w-3xl mx-auto space-y-6 overflow-y-auto h-full pb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Conexão de WhatsApp</h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Siga os passos para criar a instância, conectar o número e publicar seus
            agentes com visibilidade clara do status do canal.
          </p>
        </div>
        <StatusBadges
          status={data?.status ?? 'disconnected'}
          webhookSynced={data?.webhookSynced ?? false}
        />
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <Users className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-medium">Número compartilhado por toda a equipe</p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            O WhatsApp conectado aqui será usado por todos os usuários do LubriConnect
            (Inbox, Campanhas e Disparos). Apenas administradores podem conectar,
            desconectar ou trocar o número.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <ConnectionControls data={data} />
        <InstanceStatusCard data={data} isLoading={isLoading} />
        {isError && (
          <div className="text-sm text-destructive">
            Falha ao carregar status da instância. Verifique sua conexão.
          </div>
        )}
      </div>
    </div>
  );
}
