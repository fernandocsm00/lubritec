import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  MessageSquarePlus,
  Image as ImageIcon,
  X,
  Trash2,
  CheckCircle2,
  Clock,
  Circle,
} from 'lucide-react';
import { useAuthStore } from '@/features/auth/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  useFeedback,
  useCreateFeedback,
  useUpdateFeedbackStatus,
  useDeleteFeedback,
  type FeedbackStatus,
  type ProjectFeedback,
} from './api';

const MAX_IMAGES = 5;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Aberto',
  doing: 'Em andamento',
  done: 'Resolvido',
  dismissed: 'Descartado',
};

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  doing: 'bg-sky-50 text-sky-700 border-sky-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dismissed: 'bg-slate-50 text-slate-500 border-slate-200',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function FeedbackSection() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const list = useFeedback();
  const create = useCreateFeedback();

  const [content, setContent] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const accepted: File[] = [];
    for (const f of incoming) {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        toast.error(`${f.name}: formato não suportado`);
        continue;
      }
      if (f.size > MAX_SIZE_BYTES) {
        toast.error(`${f.name}: tamanho excede 5 MB`);
        continue;
      }
      accepted.push(f);
    }
    setImages((prev) => {
      const merged = [...prev, ...accepted];
      if (merged.length > MAX_IMAGES) {
        toast.error(`Máximo de ${MAX_IMAGES} imagens por ajuste`);
        return merged.slice(0, MAX_IMAGES);
      }
      return merged;
    });
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (trimmed.length < 1) {
      toast.error('Escreva o ajuste antes de enviar.');
      return;
    }
    try {
      await create.mutateAsync({ content: trimmed, images });
      setContent('');
      setImages([]);
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Ajuste registrado.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao registrar ajuste.';
      toast.error(msg);
    }
  }

  const items = list.data ?? [];
  const open = items.filter((i) => i.status === 'open' || i.status === 'doing');
  const closed = items.filter((i) => i.status === 'done' || i.status === 'dismissed');

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <MessageSquarePlus className="h-4 w-4 text-lc-navy" style={{ color: 'var(--lc-navy)' }} />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Ajustes</h3>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Espaço compartilhado entre Orion e Lubritec. Registre sugestões, problemas ou melhorias com texto e prints.
        O time da Orion atualiza o status conforme resolve.
      </p>

      {/* FORM */}
      <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-slate-50/40 p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="Descreva o ajuste, problema ou sugestão…"
          className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-lc-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />

        {images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((f, idx) => (
              <div
                key={idx}
                className="group relative flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                <span className="max-w-[160px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="text-slate-400 hover:text-rose-600"
                  aria-label="Remover"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              multiple
              onChange={(e) => addFiles(e.target.files)}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={create.isPending || images.length >= MAX_IMAGES}
            >
              <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
              Adicionar imagem
            </Button>
            <span className="text-[11px] text-slate-500">
              até {MAX_IMAGES} imagens · 5 MB cada
            </span>
          </div>
          <Button type="submit" size="sm" disabled={create.isPending || content.trim().length === 0}>
            {create.isPending ? 'Enviando…' : 'Registrar ajuste'}
          </Button>
        </div>
      </form>

      {/* LIST */}
      <div className="mt-5 space-y-4">
        {list.isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
        {list.error && (
          <div className="text-sm text-rose-600">Não foi possível carregar os ajustes.</div>
        )}
        {!list.isLoading && items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-muted-foreground">
            Nenhum ajuste registrado ainda. Seja o primeiro.
          </div>
        )}

        {open.length > 0 && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Em aberto ({open.length})
            </div>
            <div className="space-y-3">
              {open.map((item) => (
                <FeedbackItem key={item.id} item={item} isAdmin={isAdmin} currentUserId={user?.id} />
              ))}
            </div>
          </div>
        )}

        {closed.length > 0 && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Fechados ({closed.length})
            </div>
            <div className="space-y-3">
              {closed.map((item) => (
                <FeedbackItem key={item.id} item={item} isAdmin={isAdmin} currentUserId={user?.id} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FeedbackItem({
  item,
  isAdmin,
  currentUserId,
}: {
  item: ProjectFeedback;
  isAdmin: boolean;
  currentUserId: string | undefined;
}) {
  const updateStatus = useUpdateFeedbackStatus();
  const remove = useDeleteFeedback();
  const canDelete = isAdmin || item.userId === currentUserId;
  const isClosed = item.status === 'done' || item.status === 'dismissed';

  async function setStatus(status: FeedbackStatus) {
    try {
      await updateStatus.mutateAsync({ id: item.id, status });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar.');
    }
  }

  async function onDelete() {
    if (!confirm('Excluir este ajuste?')) return;
    try {
      await remove.mutateAsync(item.id);
      toast.success('Ajuste excluído.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        isClosed ? 'border-slate-100 bg-slate-50/50 opacity-80' : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-lc-ink">{item.authorName}</span>
          <span className="text-[11px] text-slate-500">{formatDate(item.createdAt)}</span>
        </div>
        <Badge variant="outline" className={cn('font-normal', STATUS_STYLES[item.status])}>
          {STATUS_LABEL[item.status]}
        </Badge>
      </div>

      <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{item.content}</div>

      {item.images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.images.map((img, idx) => (
            <a
              key={idx}
              href={img.path}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-md border border-slate-200 transition-transform hover:scale-105"
              title={img.originalName}
            >
              <img
                src={img.path}
                alt={img.originalName}
                className="h-20 w-20 object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {isAdmin && item.status !== 'doing' && item.status !== 'done' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStatus('doing')}
            disabled={updateStatus.isPending}
          >
            <Clock className="mr-1 h-3.5 w-3.5" />
            Em andamento
          </Button>
        )}
        {isAdmin && item.status !== 'done' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStatus('done')}
            disabled={updateStatus.isPending}
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Marcar resolvido
          </Button>
        )}
        {isAdmin && item.status === 'done' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStatus('open')}
            disabled={updateStatus.isPending}
          >
            <Circle className="mr-1 h-3.5 w-3.5" />
            Reabrir
          </Button>
        )}
        {isAdmin && item.status === 'open' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStatus('dismissed')}
            disabled={updateStatus.isPending}
          >
            Descartar
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={remove.isPending}
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Excluir
          </Button>
        )}
      </div>
    </div>
  );
}
