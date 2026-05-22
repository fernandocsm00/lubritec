import { Users } from 'lucide-react';
import { InstancesList } from '@/features/settings/whatsapp/InstancesList';
import { WebhookDebugPanel } from '@/features/settings/whatsapp/WebhookDebugPanel';

export default function WhatsappConnectionTab() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 overflow-y-auto h-full pb-6">
      <div>
        <h2 className="text-lg font-semibold">Conexão de WhatsApp</h2>
        <p className="text-sm text-muted-foreground max-w-xl">
          Conecte uma ou mais linhas de WhatsApp ao LubriConnect. Cada linha pode usar
          um provedor diferente (UazAPI ou Meta Cloud API). A linha marcada como padrão
          é usada pelo Inbox e Campanhas quando nenhuma outra é selecionada.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <Users className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-medium">Acesso restrito a administradores</p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Apenas administradores podem adicionar, reconectar, arquivar ou excluir
            linhas. Operadores veem o status mas não fazem alterações.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <InstancesList />
      </div>

      <WebhookDebugPanel />
    </div>
  );
}
