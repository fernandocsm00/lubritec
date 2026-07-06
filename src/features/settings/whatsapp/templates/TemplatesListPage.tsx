import { useState } from 'react';
import { Plus, RefreshCw, Loader2, Trash2, Pencil, Clock, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useInstancesList } from '../api';
import { useTemplates, useDeleteTemplate, useSyncTemplates } from './api';
import { TemplateStatusBadge } from './TemplateStatusBadge';
import { TemplateEditor } from './TemplateEditor';
import { TemplatePreview } from './TemplatePreview';
import type { HsmTemplateRecord } from './types';

// Templates em PENDING há muito tempo são suspeitos — geralmente Meta resolve
// em até algumas horas; > 48h sugere webhook quebrado ou caso pra abrir
// suporte na Meta. O sync manual valida; este threshold só dispara o aviso.
const PENDING_STUCK_HOURS = 48;

function relativeSync(iso: string | null): string {
  if (!iso) return 'nunca';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? 'ontem' : `há ${diffD} dias`;
}

function hoursSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export function TemplatesListPage() {
  const { data: instances } = useInstancesList();
  const metaInstances = (instances?.items ?? []).filter((i) => i.provider === 'meta_cloud');
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HsmTemplateRecord | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Pick the first Meta instance as default when data loads
  const effectiveInstanceId = selectedInstanceId ?? metaInstances[0]?.id ?? null;

  const { data, isLoading } = useTemplates(effectiveInstanceId);
  const sync = useSyncTemplates(effectiveInstanceId ?? '');
  const del = useDeleteTemplate(effectiveInstanceId ?? '');

  const handleDelete = (tpl: HsmTemplateRecord) => {
    if (!confirm(`Excluir "${tpl.name}"? Esta ação também apaga o template na Meta.`)) return;
    del.mutate(tpl.id);
  };

  if (metaInstances.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-8 text-center text-zinc-500">
        <p>Nenhuma linha Meta Cloud conectada.</p>
        <p className="text-sm mt-2">
          Conecte uma linha Meta em <strong>Configurações → WhatsApp</strong> para gerenciar
          templates HSM.
        </p>
      </div>
    );
  }

  return (
    <section className="max-w-4xl mx-auto space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Templates HSM (Meta)</h1>
          <p className="text-sm text-zinc-500">
            Templates aprovados pela Meta — usados em campanhas e em respostas fora da janela de 24h.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {metaInstances.length > 1 && (
            <select
              value={effectiveInstanceId ?? ''}
              onChange={(e) => setSelectedInstanceId(e.target.value)}
              className="border border-zinc-300 rounded px-3 py-2 text-sm"
            >
              {metaInstances.map((i) => (
                <option key={i.id} value={i.id}>{i.displayName}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !effectiveInstanceId}
            className="inline-flex items-center gap-2 px-3 py-2 border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50 text-sm"
          >
            <RefreshCw size={14} className={sync.isPending ? 'animate-spin' : ''} />
            Sincronizar
          </button>
          <button
            onClick={() => { setEditingTemplate(null); setEditorOpen(true); }}
            disabled={!effectiveInstanceId}
            className="inline-flex items-center gap-2 px-4 py-2 bg-lc-navy text-white rounded hover:opacity-90 disabled:opacity-50 text-sm"
          >
            <Plus size={14} /> Novo template
          </button>
        </div>
      </header>

      {sync.data && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          Sincronização: {sync.data.synced} templates Meta, {sync.data.created} criados localmente, {sync.data.updated} atualizados.
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Carregando...
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="border border-dashed border-zinc-300 rounded-lg p-8 text-center text-zinc-500">
          Nenhum template ainda. Clique em "Novo template" para criar.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="space-y-2">
          {data.items.map((tpl) => {
            const pendingStuck = tpl.status === 'PENDING' && hoursSince(tpl.lastSyncedAt) > PENDING_STUCK_HOURS;
            const isOpen = expanded.has(tpl.id);
            return (
            <div key={tpl.id} className="border border-zinc-200 rounded-lg">
              <div className="p-4 flex items-center gap-3">
                <button
                  onClick={() => toggleExpanded(tpl.id)}
                  className="p-1 -ml-1 rounded text-zinc-500 hover:bg-zinc-100 shrink-0"
                  aria-label={isOpen ? 'Ocultar mensagem' : 'Ver mensagem'}
                  aria-expanded={isOpen}
                  title={isOpen ? 'Ocultar mensagem' : 'Ver mensagem'}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-medium">{tpl.name}</span>
                  <TemplateStatusBadge status={tpl.status} />
                  <span className="text-xs text-zinc-500">{tpl.language}</span>
                  <span className="text-xs text-zinc-500">· {tpl.category}</span>
                  {tpl.variableCount > 0 && (
                    <span className="text-xs text-zinc-500">· {tpl.variableCount} variáveis</span>
                  )}
                  <span
                    className="inline-flex items-center gap-1 text-xs text-zinc-400 ml-auto"
                    title={tpl.lastSyncedAt ? `Sincronizado com a Meta em ${new Date(tpl.lastSyncedAt).toLocaleString('pt-BR')}` : 'Nunca sincronizado com a Meta'}
                  >
                    <Clock size={11} /> Sync {relativeSync(tpl.lastSyncedAt)}
                  </span>
                </div>
                {tpl.rejectionReason && (
                  <div className="text-xs text-red-600 mt-1">Rejeitado: {tpl.rejectionReason}</div>
                )}
                {pendingStuck && (
                  <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} />
                    Em aprovação há mais de {PENDING_STUCK_HOURS}h — clique em Sincronizar ou verifique direto no Business Manager da Meta.
                  </div>
                )}
              </div>
              {tpl.status === 'DRAFT' && (
                <button
                  onClick={() => { setEditingTemplate(tpl); setEditorOpen(true); }}
                  className="p-2 rounded text-zinc-600 hover:bg-zinc-100"
                  aria-label="Editar rascunho"
                  title="Editar rascunho"
                >
                  <Pencil size={16} />
                </button>
              )}
              <button
                onClick={() => handleDelete(tpl)}
                className="p-2 rounded text-red-600 hover:bg-red-50"
                aria-label="Excluir"
              >
                <Trash2 size={16} />
              </button>
              </div>
              {isOpen && (
                <div className="border-t border-zinc-100 px-4 py-4 bg-zinc-50/50">
                  <p className="text-xs font-medium text-zinc-500 mb-2">
                    Mensagem {tpl.status === 'APPROVED' ? 'aprovada' : tpl.status === 'REJECTED' ? 'rejeitada' : 'enviada'} à Meta
                  </p>
                  <TemplatePreview components={tpl.components} />
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {effectiveInstanceId && (
        <TemplateEditor
          open={editorOpen}
          instanceId={effectiveInstanceId}
          template={editingTemplate}
          onClose={() => { setEditorOpen(false); setEditingTemplate(null); }}
        />
      )}
    </section>
  );
}
