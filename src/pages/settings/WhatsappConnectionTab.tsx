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
