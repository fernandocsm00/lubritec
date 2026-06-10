import { useSearchParams } from 'react-router-dom';
import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

const WhatsappConnectionTab = lazyWithRetry(() => import('./WhatsappConnectionTab'));
const OrganizationTab = lazyWithRetry(() => import('./OrganizationTab'));
const AiTab = lazyWithRetry(() => import('./AiTab'));

const Loader = () => <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;

type Tab = 'whatsapp' | 'organization' | 'ai';

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) || 'whatsapp';

  function setTab(t: Tab) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Configurações do sistema</p>
      </div>

      <div className="flex gap-1 border-b border-border mb-4">
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'whatsapp'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('whatsapp')}
        >
          Conexão WhatsApp
        </button>
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'organization'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('organization')}
        >
          Organização
        </button>
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'ai'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('ai')}
        >
          IA de Atendimento
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<Loader />}>
          {tab === 'whatsapp' && <WhatsappConnectionTab />}
          {tab === 'organization' && <OrganizationTab />}
          {tab === 'ai' && <AiTab />}
        </Suspense>
      </div>
    </div>
  );
}
