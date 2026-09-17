import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MoreVertical, Pencil, Trash2, Check, X, CornerUpLeft, RotateCw } from 'lucide-react';
import { INBOUND_MEDIA_FALLBACK_LABEL, INBOUND_MEDIA_KINDS, isInboundMediaFallbackLabel } from '@shared/types';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/features/auth/store';
import { ImageLightbox } from './ImageLightbox';
import { useDeleteMessage, useEditMessage, useRetryInboundMedia } from './api';
import { deliveryTick, DELIVERY_TICK_CLASS } from './deliveryTicks';
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

const KIND_LABEL: Record<string, string> = {
  image: '📷 Imagem', audio: '🎤 Áudio', video: '🎬 Vídeo', document: '📄 Documento',
};

/** Texto curto da mensagem citada (body ou rótulo de mídia). */
function quoteText(reply: NonNullable<PublicMessage['replyTo']>): string {
  if (reply.body?.trim()) return reply.body;
  return KIND_LABEL[reply.kind] ?? 'Mensagem';
}

export function MessageBubble({ msg, onReply }: { msg: PublicMessage; onReply?: (m: PublicMessage) => void }) {
  const isOut = msg.direction === 'out';
  const tick = deliveryTick(msg);
  const time = new Date(msg.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  // Autor = quem enviou; mensagens da IA tem sentByUser=null e nessas so admin pode mexer.
  const isAuthor = msg.sentByUser?.id === user?.id && msg.sentByUser?.id != null;
  const canMutate = isOut && !msg.deletedAt && (isAuthor || isAdmin);
  const ageMs = Date.now() - new Date(msg.sentAt).getTime();
  const canEdit = canMutate && msg.kind === 'text' && ageMs <= EDIT_WINDOW_MS;
  const canDelete = canMutate && ageMs <= DELETE_WINDOW_MS;
  // "Responder citando": disponível pra qualquer mensagem (in ou out).
  const canReply = !!onReply;
  const showMenu = canReply || canEdit || canDelete;

  // Recebida com arquivo que não baixou (token vencido, mídia expirada...): em vez
  // de "Mensagem não suportada", diz o que o cliente mandou e deixa tentar de novo.
  const mediaMissing = !isOut && !msg.mediaUrl
    && (INBOUND_MEDIA_KINDS as readonly string[]).includes(msg.kind);
  // O rótulo fallback ("🎵 Áudio") vira redundante com o aviso; legenda real fica.
  const visibleBody = mediaMissing && isInboundMediaFallbackLabel(msg.body) ? null : msg.body;

  const del = useDeleteMessage();
  const edit = useEditMessage();
  const retryMedia = useRetryInboundMedia();

  async function handleRetryMedia() {
    try {
      const updated = await retryMedia.mutateAsync({ conversationId: msg.conversationId, messageId: msg.id });
      if (updated.mediaUrl) toast.success('Arquivo carregado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao baixar o arquivo.');
    }
  }
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
                {canReply && (
                  <DropdownMenuItem onSelect={() => onReply?.(msg)}>
                    <CornerUpLeft className="h-3.5 w-3.5 mr-2" /> Responder
                  </DropdownMenuItem>
                )}
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

        {/* Citação ("responder citando") */}
        {msg.replyTo && (
          <div className="mb-1 border-l-2 border-primary/70 pl-2 py-0.5 bg-black/15 rounded text-xs">
            <div className="font-medium text-primary/90">
              {msg.replyTo.direction === 'out' ? 'Você' : 'Cliente'}
            </div>
            <div className="truncate max-w-[240px] text-muted-foreground">
              {quoteText(msg.replyTo)}
            </div>
          </div>
        )}

        {msg.kind === 'image' && msg.mediaUrl && (
          <ImageLightbox src={msg.mediaUrl} />
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
            {mediaMissing && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-0.5">
                <p className="text-sm italic text-muted-foreground/90 leading-snug">
                  {msg.body === INBOUND_MEDIA_FALLBACK_LABEL.sticker
                    ? INBOUND_MEDIA_FALLBACK_LABEL.sticker
                    : INBOUND_MEDIA_FALLBACK_LABEL[msg.kind as keyof typeof INBOUND_MEDIA_FALLBACK_LABEL]}
                  {' — não foi possível carregar'}
                </p>
                <button
                  type="button"
                  onClick={handleRetryMedia}
                  disabled={retryMedia.isPending}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded border border-border/60 hover:bg-black/5 disabled:opacity-60"
                >
                  <RotateCw className={`h-3 w-3 ${retryMedia.isPending ? 'animate-spin' : ''}`} />
                  {retryMedia.isPending ? 'Baixando…' : 'Tentar de novo'}
                </button>
              </div>
            )}
            {visibleBody && (
              <p className="text-sm whitespace-pre-wrap break-words leading-snug">
                {renderWhatsappBold(visibleBody)}
              </p>
            )}
            {!msg.body && !msg.mediaUrl && !mediaMissing && (
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
            {tick && (
              <span className={`ml-1 ${DELIVERY_TICK_CLASS[tick.tone]}`} title={tick.label}>
                {tick.glyph}
              </span>
            )}
          </div>
        )}
        {tick?.tone === 'failed' && (
          <div className="mt-1 text-[10px] text-red-500">{tick.label}</div>
        )}
      </div>
    </div>
  );
}
