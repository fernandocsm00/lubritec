import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { useInstancesList } from './api';
import { InstanceCard } from './InstanceCard';
import { AddInstanceWizard } from './AddInstanceWizard';

export function InstancesList() {
  const { data, isLoading, isError, error } = useInstancesList();
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Números de WhatsApp</h2>
          <p className="text-sm text-zinc-500">Conecte e gerencie as linhas usadas pelo SaaS.</p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-lc-navy text-white rounded hover:opacity-90"
        >
          <Plus size={16} /> Adicionar número
        </button>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Carregando linhas...
        </div>
      )}

      {isError && (
        <div className="text-red-600 text-sm">
          Erro ao carregar: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="border border-dashed border-zinc-300 rounded-lg p-8 text-center text-zinc-500">
          Nenhum número conectado. Clique em "Adicionar número" pra começar.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map((inst) => (
            <InstanceCard key={inst.id} instance={inst} />
          ))}
        </div>
      )}

      <AddInstanceWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => {
          /* list re-fetches automatically via invalidate */
        }}
      />
    </section>
  );
}
