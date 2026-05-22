import { useState } from 'react';
import { Users } from 'lucide-react';
import { InstancesList } from '@/features/settings/whatsapp/InstancesList';
import { TemplatesListPage } from '@/features/settings/whatsapp/templates/TemplatesListPage';
import { WebhookDebugPanel } from '@/features/settings/whatsapp/WebhookDebugPanel';

export default function WhatsappConnectionTab() {
  const [tab, setTab] = useState<'lines' | 'templates'>('lines');

  return (
    <div className="max-w-4xl mx-auto h-full overflow-y-auto pb-6">
      <nav className="flex gap-2 border-b border-zinc-200 px-6 pt-4">
        <button
          onClick={() => setTab('lines')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'lines' ? 'border-lc-navy text-lc-navy' : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Linhas conectadas
        </button>
        <button
          onClick={() => setTab('templates')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'templates' ? 'border-lc-navy text-lc-navy' : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Templates HSM (Meta)
        </button>
      </nav>

      {tab === 'lines' && (
        <div className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Conexão de WhatsApp</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              Conecte uma ou mais linhas de WhatsApp ao LubriConnect. Cada linha pode usar
              um provedor diferente (UazAPI ou Meta Cloud API). A linha marcada como padrão
              é usada pelo Inbox e Campanhas quando nenhuma outra é selecionada.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <Users className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-medium">Acesso restrito a administradores</p>
              <p className="mt-1 text-amber-800">
                Apenas administradores podem adicionar, reconectar, arquivar ou excluir linhas.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <InstancesList />
          </div>
          <WebhookDebugPanel />
        </div>
      )}

      {tab === 'templates' && <TemplatesListPage />}
    </div>
  );
}
