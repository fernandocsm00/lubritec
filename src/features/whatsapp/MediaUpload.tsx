import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Paperclip, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useUploadConversationMedia } from './api';
import type { MessageKind } from './types';

interface Props {
  onPick: (input: { kind: MessageKind; mediaUrl: string; mediaMime?: string; caption?: string }) => void;
}

export interface MediaUploadHandle {
  /** Abre o dialog já com um arquivo (ex.: imagem colada via Ctrl+V). */
  openWithFile: (file: File) => void;
}

type Source = 'file' | 'url';

function kindFromMime(mime: string): MessageKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

const ACCEPT_BY_KIND: Record<Exclude<MessageKind, 'text' | 'unknown'>, string> = {
  image: 'image/jpeg,image/png,image/webp,image/gif',
  video: 'video/mp4,video/webm,video/quicktime,video/3gpp',
  audio: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm',
  document: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip',
};

export const MediaUpload = forwardRef<MediaUploadHandle, Props>(function MediaUpload(
  { onPick }: Props,
  ref,
) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>('file');
  const [kind, setKind] = useState<MessageKind>('image');
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadConversationMedia();

  function reset() {
    setUrl(''); setCaption(''); setKind('image');
    setFile(null); setSource('file');
  }

  useImperativeHandle(ref, () => ({
    openWithFile(f: File) {
      reset();
      setFile(f);
      setKind(kindFromMime(f.type));
      setSource('file');
      setOpen(true);
    },
  }), []);

  async function submit() {
    if (source === 'url') {
      if (!url.trim()) return;
      onPick({ kind, mediaUrl: url.trim(), caption: caption.trim() || undefined });
      setOpen(false);
      reset();
      return;
    }

    if (!file) return;
    try {
      const r = await upload.mutateAsync(file);
      onPick({
        kind,
        mediaUrl: r.mediaUrl,
        mediaMime: r.mediaMime,
        caption: caption.trim() || undefined,
      });
      setOpen(false);
      reset();
    } catch {
      toast.error('Falha ao enviar arquivo. Verifique tipo e tamanho (máx. 25MB).');
    }
  }

  const accept = kind === 'text' || kind === 'unknown'
    ? undefined
    : ACCEPT_BY_KIND[kind];

  const canSubmit = source === 'url' ? !!url.trim() : !!file;

  return (
    <>
      <Button type="button" variant="ghost" size="icon" title="Anexar mídia" onClick={() => setOpen(true)}>
        <Paperclip className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexar mídia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
              <button
                type="button"
                className={`rounded py-1.5 transition ${source === 'file' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                onClick={() => setSource('file')}
              >
                Do computador
              </button>
              <button
                type="button"
                className={`rounded py-1.5 transition ${source === 'url' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                onClick={() => setSource('url')}
              >
                Por URL
              </button>
            </div>

            <div>
              <Label>Tipo</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as MessageKind);
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="document">Documento</SelectItem>
                  <SelectItem value="video">Vídeo</SelectItem>
                  <SelectItem value="audio">Áudio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {source === 'file' ? (
              <div>
                <Label>Arquivo</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={accept}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <span className="truncate flex-1">{file.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      aria-label="Remover"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" /> Escolher arquivo
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Tamanho máximo: 25MB. O arquivo é enviado pro servidor e a URL é gerada automaticamente.
                </p>
              </div>
            ) : (
              <div>
                <Label>URL pública da mídia</Label>
                <Input
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Cole uma URL pública acessível (já hospedada).
                </p>
              </div>
            )}

            <div>
              <Label>Legenda (opcional)</Label>
              <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancelar</Button>
            <Button onClick={submit} disabled={!canSubmit || upload.isPending}>
              {upload.isPending ? 'Enviando…' : 'Anexar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
