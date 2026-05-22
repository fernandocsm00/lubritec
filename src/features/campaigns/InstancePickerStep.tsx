import { useInstancesList } from '@/features/settings/whatsapp/api';
import { Loader2 } from 'lucide-react';
import type { InstanceListItem } from '@shared/types';

interface Props {
  selectedInstanceId: string | null;
  onSelect: (instance: InstanceListItem) => void;
}

export function InstancePickerStep({ selectedInstanceId, onSelect }: Props) {
  const { data, isLoading } = useInstancesList();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Carregando linhas...
      </div>
    );
  }

  const items = (data?.items ?? []).filter((i) => !i.isArchived);

  if (items.length === 0) {
    return (
      <div className="border border-dashed border-zinc-300 rounded-lg p-8 text-center text-zinc-500">
        Nenhuma linha de WhatsApp conectada. Conecte uma linha em Configurações → WhatsApp.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        Escolha qual linha de WhatsApp vai disparar esta campanha.
      </p>
      <div className="space-y-2">
        {items.map((inst) => {
          const selected = inst.id === selectedInstanceId;
          return (
            <button
              key={inst.id}
              type="button"
              onClick={() => onSelect(inst)}
              className={`w-full border rounded-lg p-4 text-left transition ${
                selected ? 'border-lc-navy bg-lc-navy/5' : 'border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{inst.displayName}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  inst.provider === 'uazapi' ? 'bg-zinc-100 text-zinc-700' : 'bg-lc-navy/10 text-lc-navy'
                }`}>
                  {inst.provider === 'uazapi' ? 'UazAPI' : 'Meta Cloud'}
                </span>
                {inst.isDefault && (
                  <span className="text-xs text-zinc-500 italic">padrão</span>
                )}
              </div>
              <div className="text-sm text-zinc-500 mt-1">
                {inst.phoneNumber ?? 'Sem número'}
                {inst.profileName ? ` — ${inst.profileName}` : ''}
              </div>
              {inst.provider === 'meta_cloud' && (
                <div className="text-xs text-amber-700 mt-2">
                  Linhas Meta exigem template HSM aprovado (sem texto livre fora da janela de 24h).
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
