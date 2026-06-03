import { useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  useTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
} from './api';
import type { PublicMessageTemplate } from '@shared/types';

/**
 * UI de gestão dos snippets de resposta rápida (atalho ⚡ no chat).
 *
 * Mostra os mesmos templates consumidos pelo TemplatePicker no Inbox.
 * Qualquer usuário logado pode criar/editar/excluir — alinha com a permissão
 * do backend (routes/messageTemplates.ts usa só authGuard, sem role check).
 */
export function QuickReplyManager() {
  const { data, isLoading } = useTemplates();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const del = useDeleteTemplate();

  // null = nenhum form aberto. 'new' = criando. uuid = editando esse template.
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const openNew = () => {
    setEditing('new');
    setTitle('');
    setBody('');
  };

  const openEdit = (t: PublicMessageTemplate) => {
    setEditing(t.id);
    setTitle(t.title);
    setBody(t.body);
  };

  const cancel = () => {
    setEditing(null);
    setTitle('');
    setBody('');
    create.reset();
    update.reset();
  };

  const canSave = title.trim().length > 0 && body.trim().length > 0;
  const isSaving = create.isPending || update.isPending;

  const save = () => {
    if (!canSave) return;
    const payload = { title: title.trim(), body: body.trim() };
    if (editing === 'new') {
      create.mutate(payload, { onSuccess: () => cancel() });
    } else if (editing) {
      update.mutate({ id: editing, ...payload }, { onSuccess: () => cancel() });
    }
  };

  const handleDelete = (t: PublicMessageTemplate) => {
    if (!confirm(`Excluir resposta rápida "${t.title}"?`)) return;
    del.mutate(t.id);
  };

  const items = data?.items ?? [];

  return (
    <section className="max-w-3xl mx-auto space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Respostas rápidas</h2>
          <p className="text-sm text-muted-foreground">
            Atalhos de mensagem disponíveis no botão <span className="inline-flex items-baseline gap-1"><span aria-hidden>⚡</span></span> do chat. Cada atendente pode criar e usar.
          </p>
        </div>
        {editing === null && (
          <Button type="button" onClick={openNew} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Nova resposta
          </Button>
        )}
      </header>

      {editing !== null && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium">
            {editing === 'new' ? 'Nova resposta rápida' : 'Editar resposta rápida'}
          </h3>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="qr-title">
              Título <span className="text-red-500">*</span>
            </label>
            <Input
              id="qr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ex: Saudação"
              maxLength={120}
              disabled={isSaving}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="qr-body">
              Mensagem <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="qr-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Texto que será inserido na caixa de digitação ao escolher o atalho."
              rows={5}
              maxLength={4000}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground text-right">{body.length}/4000</p>
          </div>
          {(create.isError || update.isError) && (
            <p className="text-xs text-red-600">
              Erro ao salvar. Tente novamente.
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={isSaving}>
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={!canSave || isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              {editing === 'new' ? 'Criar' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      )}

      {!isLoading && items.length === 0 && editing === null && (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          Nenhuma resposta rápida cadastrada. Clique em "Nova resposta" pra criar.
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="border border-border rounded-lg p-4 flex items-start gap-4 bg-card"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t.title}</div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap mt-1 line-clamp-3">
                  {t.body}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Criado por {t.createdBy.name}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  disabled={editing !== null}
                  className="p-2 rounded text-muted-foreground hover:bg-muted disabled:opacity-50"
                  aria-label="Editar"
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  disabled={editing !== null || del.isPending}
                  className="p-2 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
                  aria-label="Excluir"
                  title="Excluir"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
