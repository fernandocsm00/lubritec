import { useTemplates } from '@/features/settings/whatsapp/templates/api';
import { TemplatePreview } from '@/features/settings/whatsapp/templates/TemplatePreview';
import { TemplateStatusBadge } from '@/features/settings/whatsapp/templates/TemplateStatusBadge';
import { Loader2 } from 'lucide-react';
import type { HsmTemplateRecord } from '@shared/types';

interface Props {
  instanceId: string;
  selectedTemplateId: string | null;
  onSelect: (tpl: HsmTemplateRecord) => void;
}

export function HsmTemplatePickerStep({ instanceId, selectedTemplateId, onSelect }: Props) {
  const { data, isLoading } = useTemplates(instanceId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Carregando templates...
      </div>
    );
  }

  const approved = (data?.items ?? []).filter((t) => t.status === 'APPROVED');

  if (approved.length === 0) {
    return (
      <div className="border border-dashed border-zinc-300 rounded-lg p-6 text-center text-zinc-500 text-sm">
        Nenhum template APROVADO disponível nesta linha. Crie e aprove um template HSM em
        Configurações → WhatsApp → Templates HSM.
      </div>
    );
  }

  const selected = approved.find((t) => t.id === selectedTemplateId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-zinc-700">
          Templates aprovados ({approved.length})
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
          {approved.map((tpl) => {
            const sel = tpl.id === selectedTemplateId;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onSelect(tpl)}
                className={`w-full text-left border rounded p-3 transition ${
                  sel ? 'border-lc-navy bg-lc-navy/5' : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{tpl.name}</span>
                  <TemplateStatusBadge status={tpl.status} />
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {tpl.language} · {tpl.category} · {tpl.variableCount} variáveis
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="text-sm font-medium text-zinc-700 mb-2">Preview</div>
        {selected ? (
          <TemplatePreview components={selected.components} />
        ) : (
          <div className="text-xs text-zinc-500 italic">Selecione um template à esquerda.</div>
        )}
      </div>
    </div>
  );
}
