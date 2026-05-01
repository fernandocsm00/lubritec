import { useState } from 'react';
import { Paperclip } from 'lucide-react';
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
import type { MessageKind } from './types';

interface Props {
  onPick: (input: { kind: MessageKind; mediaUrl: string; mediaMime?: string; caption?: string }) => void;
}

// IMPORTANTE: a estratégia de produção é fazer upload direto pro UazAPI antes de
// enviar a mensagem (ver spec). Esta v1 aceita uma URL já pública — suficiente
// para validar fluxo enquanto a integração de upload é implementada como sub-tarefa.
export function MediaUpload({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<MessageKind>('image');
  const [caption, setCaption] = useState('');

  function submit() {
    if (!url.trim()) return;
    onPick({ kind, mediaUrl: url.trim(), caption: caption.trim() || undefined });
    setOpen(false);
    setUrl(''); setCaption(''); setKind('image');
  }

  return (
    <>
      <Button type="button" variant="ghost" size="icon" title="Anexar mídia" onClick={() => setOpen(true)}>
        <Paperclip className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexar mídia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as MessageKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="document">Documento</SelectItem>
                  <SelectItem value="video">Vídeo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>URL pública da mídia</Label>
              <Input
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                A v1 aceita URL pública. Upload direto pro UazAPI será adicionado em sub-tarefa futura.
              </p>
            </div>
            <div>
              <Label>Legenda (opcional)</Label>
              <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={!url.trim()}>Anexar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
