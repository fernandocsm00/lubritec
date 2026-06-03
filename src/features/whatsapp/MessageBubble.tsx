import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MoreVertical, Pencil, Trash2, Check, X } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/features/auth/store';
import { useDeleteMessage, useEditMessage } from './api';
import type { PublicMessage } from './types';

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

function renderWhatsappBold(text: string) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function MessageBubble({ msg }: { msg: PublicMessage }) {
  const isOut = msg.direction === 'out';
  const time = new Date(msg.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  // Autor = quem enviou; mensagens da IA tem sentByUser=null e nessas so admin pode mexer.
  const isAuthor = msg.sentByUser?.id === user?.id && msg.sentByUser?.id != null;
  const canMutate = isOut && !msg.deletedAt && (isAuthor || isAdmin);
  const ageMs = Date.now() - new Date(msg.sentAt).getTime();
  const canEdit = canMutate && msg.kind === 'text' && ageMs <= EDIT_WINDOW_MS;
  const canDelete = canMutate && ageMs <= DELETE_WINDOW_MS;
  const showMenu = canEdit || canDelete;

  const del = useDeleteMessage();
  const edit = useEditMessage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body ?? '');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(msg.body ?? '');
      // Foca + posiciona cursor no fim na proxima tick.
      setTimeout(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      }, 0);
    }
  }, [editing, msg.body]);

  async function handleDelete() {
    if (!confirm('Apagar esta mensagem pra todos? O cliente vai ver "Esta mensagem foi apagada" no WhatsApp.')) return;
    try {
      await del.mutateAsync({ conversationId: msg.conversationId, messageId: msg.id });
      toast.success('Mensagem apagada.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao apagar.');
    }
  }

  async function handleSaveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error('Texto vazio.');
      return;
    }
    if (trimmed === (msg.body ?? '')) {
      setEditing(false);
      return;
    }
    try {
      await edit.mutateAsync({ conversationId: msg.conversationId, messageId: msg.id, body: trimmed });
      toast.success('Mensagem editada.');
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao editar.');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    }
  }

  // Bubble deletada: vira placeholder italic, sem mais nada acionavel.
  if (msg.deletedAt) {
    return (
      <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
        <div
          className={`max-w-[65%] px-3 py-1.5 shadow-sm italic text-muted-foreground ${
            isOut
              ? 'bg-emerald-900/20 rounded-lg rounded-tr-none'
              : 'bg-card border border-border/40 rounded-lg rounded-tl-none'
          }`}
        >
          <p className="text-sm leading-snug">🚫 Esta mensagem foi apagada</p>
          <div className="text-[10px] text-right mt-0.5">{time}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`relative max-w-[65%] px-3 py-1.5 shadow-sm ${
          isOut
            ? 'bg-emerald-900/40 rounded-lg rounded-tr-none'
            : 'bg-card border border-border/40 rounded-lg rounded-tl-none'
        }`}
      >
        {/* Menu de acao — so aparece pra outbound editavel/deletavel */}
        {showMenu && !editing && (
          <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Ações da mensagem"
                  className="rounded p-0.5 hover:bg-black/10"
                >
                  <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canEdit && (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    onSelect={handleDelete}
                    className="text-red-600 focus:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Apagar pra todos
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {msg.kind === 'image' && msg.mediaUrl && (
          <img src={msg.mediaUrl} alt="imagem" className="rounded mb-1 max-w-full max-h-64 object-cover" />
        )}
        {msg.kind === 'audio' && msg.mediaUrl && (
          <audio controls src={msg.mediaUrl} className="mb-1 max-w-full" />
        )}
        {msg.kind === 'video' && msg.mediaUrl && (
          <video controls src={msg.mediaUrl} className="rounded mb-1 max-w-full max-h-64" />
        )}
        {msg.kind === 'document' && msg.mediaUrl && (
          <a href={msg.mediaUrl} target="_blank" rel="noreferrer" className="block text-xs underline mb-1">
            Abrir documento
          </a>
        )}

        {/* Texto: modo edit OU view */}
        {editing ? (
          <div className="space-y-1.5 min-w-[240px]">
            <Textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              maxLength={4000}
              disabled={edit.isPending}
              className="text-sm bg-background"
            />
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={edit.isPending}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-black/10 text-muted-foreground"
              >
                <X className="h-3 w-3" /> Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={edit.isPending || !draft.trim()}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Salvar
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/80">Enter envia · Shift+Enter quebra linha · Esc cancela</p>
          </div>
        ) : (
          <>
            {msg.body && (
              <p className="text-sm whitespace-pre-wrap break-words leading-snug">
                {renderWhatsappBold(msg.body)}
              </p>
            )}
            {!msg.body && !msg.mediaUrl && (
              <p className="text-sm italic text-muted-foreground/80 leading-snug">
                📎 Mensagem não suportada
              </p>
            )}
          </>
        )}

        {!editing && (
          <div className="text-[10px] text-muted-foreground/80 text-right mt-0.5">
            {msg.editedAt && <span className="mr-1 italic">(editado)</span>}
            {time}
            {isOut && <span className="ml-1 text-sky-400">✓✓</span>}
          </div>
        )}
      </div>
    </div>
  );
}
