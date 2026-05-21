import { useState } from 'react';
import { Settings2, CircleAlert, Loader2, CheckCircle2, PowerOff } from 'lucide-react';
import { useUpdateInstance, useDeleteInstanceById, useConnectInstanceById } from './api';
import type { InstanceListItem } from './types';

interface Props {
  instance: InstanceListItem;
}

function StatusDot({ status }: { status: string | null }) {
  const map: Record<string, { color: string; Icon: typeof CheckCircle2; label: string }> = {
    connected: { color: 'text-emerald-500', Icon: CheckCircle2, label: 'Conectado' },
    pairing: { color: 'text-amber-500', Icon: Loader2, label: 'Pareando' },
    disconnected: { color: 'text-zinc-400', Icon: PowerOff, label: 'Desconectado' },
    error: { color: 'text-red-500', Icon: CircleAlert, label: 'Erro' },
  };
  const info = map[status ?? 'disconnected'] ?? map.disconnected;
  const Icon = info.Icon;
  const spin = status === 'pairing' ? 'animate-spin' : '';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${info.color}`}>
      <Icon size={16} className={spin} />
      {info.label}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: 'uazapi' | 'meta_cloud' }) {
  const label = provider === 'uazapi' ? 'UazAPI' : 'Meta Cloud';
  const cls = provider === 'uazapi'
    ? 'bg-zinc-100 text-zinc-700'
    : 'bg-lc-navy/10 text-lc-navy';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}

export function InstanceCard({ instance }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const updateMut = useUpdateInstance();
  const deleteMut = useDeleteInstanceById();
  const connectMut = useConnectInstanceById();

  const handleSetDefault = () => updateMut.mutate({ id: instance.id, patch: { isDefault: true } });
  const handleArchive = () => updateMut.mutate({ id: instance.id, patch: { isArchived: true } });
  const handleDelete = () => {
    if (!confirm(`Excluir a linha "${instance.displayName}"? Esta ação não pode ser desfeita.`)) return;
    deleteMut.mutate(instance.id);
  };
  const handleReconnect = () => connectMut.mutate(instance.id);

  return (
    <div className="border border-zinc-200 rounded-lg p-4 flex items-center gap-4">
      <StatusDot status={instance.lastStatus} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{instance.displayName}</span>
          <ProviderBadge provider={instance.provider} />
          {instance.isDefault && (
            <span className="text-xs text-zinc-500 italic">padrão</span>
          )}
        </div>
        <div className="text-sm text-zinc-500 truncate">
          {instance.phoneNumber ?? 'Sem número conectado'}
          {instance.profileName ? ` — ${instance.profileName}` : ''}
        </div>
      </div>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="p-2 rounded hover:bg-zinc-100"
          aria-label="Opções"
        >
          <Settings2 size={18} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded shadow-md z-10 min-w-[180px]">
            <button onClick={() => { setMenuOpen(false); handleReconnect(); }}
              className="w-full px-3 py-2 text-left hover:bg-zinc-50">Reconectar</button>
            {!instance.isDefault && (
              <button onClick={() => { setMenuOpen(false); handleSetDefault(); }}
                className="w-full px-3 py-2 text-left hover:bg-zinc-50">Definir como padrão</button>
            )}
            <button onClick={() => { setMenuOpen(false); handleArchive(); }}
              className="w-full px-3 py-2 text-left hover:bg-zinc-50">Arquivar</button>
            <button onClick={() => { setMenuOpen(false); handleDelete(); }}
              className="w-full px-3 py-2 text-left text-red-600 hover:bg-red-50">Excluir</button>
          </div>
        )}
      </div>
    </div>
  );
}
