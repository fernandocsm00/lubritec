import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useStartConversation } from './api';
import type { MessageKind } from './types';

interface Props {
  onCreated?: (conversationId: string) => void;
}

type MediaKind = Exclude<MessageKind, 'text' | 'unknown' | 'audio'>;
const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento',
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export function NewConversationDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [includeMedia, setIncludeMedia] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKind>('image');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaMime, setMediaMime] = useState('');

  const start = useStartConversation();

  function reset() {
    setPhone('');
    setName('');
    setText('');
    setIncludeMedia(false);
    setMediaKind('image');
    setMediaUrl('');
    setMediaMime('');
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    const phoneDigits = digitsOnly(phone);
    if (phoneDigits.length < 10) {
      toast.error('Telefone inválido. Use DDI+DDD+número (ex: 5511987654321).');
      return;
    }
    if (includeMedia && !mediaUrl.trim()) {
      toast.error('Informe a URL da mídia.');
      return;
    }
    if (!includeMedia && !text.trim()) {
      toast.error('Digite uma mensagem ou anexe uma mídia.');
      return;
    }

    const payload = includeMedia
      ? {
          phone: phoneDigits,
          name: name.trim() || undefined,
          kind: mediaKind as MessageKind,
          mediaUrl: mediaUrl.trim(),
          mediaMime: mediaMime.trim() || undefined,
          body: text.trim() || undefined,
        }
      : {
          phone: phoneDigits,
          name: name.trim() || undefined,
          kind: 'text' as MessageKind,
          body: text.trim(),
        };

    try {
      const res = await start.mutateAsync(payload);
      toast.success('Conversa iniciada.');
      const convId = res.conversation.id;
      close();
      onCreated?.(convId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao iniciar conversa.';
      toast.error(msg);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <MessageSquarePlus className="h-4 w-4" />
        Nova conversa
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova conversa</DialogTitle>
            <DialogDescription>
              Inicie uma conversa enviando a primeira mensagem para um número de WhatsApp.
              Se já existir conversa com esse número, ela será reutilizada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="nc-phone">Telefone (com DDI e DDD)</Label>
              <Input
                id="nc-phone"
                placeholder="55 11 98765-4321"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Apenas dígitos são enviados. Ex.: 5511987654321.
              </p>
            </div>

            <div>
              <Label htmlFor="nc-name">Nome do contato (opcional)</Label>
              <Input
                id="nc-name"
                placeholder="João Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Se vazio e o lead ainda não existir, usaremos o telefone como nome.
              </p>
            </div>

            <div>
              <Label htmlFor="nc-text">
                Mensagem {includeMedia && <span className="text-muted-foreground font-normal">(legenda da mídia, opcional)</span>}
              </Label>
              <Textarea
                id="nc-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={includeMedia ? 'Legenda opcional da mídia' : 'Digite a primeira mensagem'}
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="nc-media-toggle"
                type="checkbox"
                checked={includeMedia}
                onChange={(e) => setIncludeMedia(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="nc-media-toggle" className="cursor-pointer font-normal">
                Anexar mídia (imagem, vídeo ou documento)
              </Label>
            </div>

            {includeMedia && (
              <div className="space-y-3 rounded-md border border-border p-3 bg-muted/30">
                <div>
                  <Label>Tipo de mídia</Label>
                  <Select value={mediaKind} onValueChange={(v) => setMediaKind(v as MediaKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MEDIA_KIND_LABEL) as MediaKind[]).map((k) => (
                        <SelectItem key={k} value={k}>{MEDIA_KIND_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="nc-media-url">URL pública da mídia</Label>
                  <Input
                    id="nc-media-url"
                    placeholder="https://…"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="nc-media-mime">MIME type (opcional)</Label>
                  <Input
                    id="nc-media-mime"
                    placeholder="image/jpeg, video/mp4, application/pdf…"
                    value={mediaMime}
                    onChange={(e) => setMediaMime(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={start.isPending}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={start.isPending}>
              {start.isPending ? 'Enviando…' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
