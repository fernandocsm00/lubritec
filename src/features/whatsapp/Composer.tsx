import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from './EmojiPicker';
import { TemplatePicker } from './TemplatePicker';
import { MediaUpload, type MediaUploadHandle } from './MediaUpload';
import { useSendMessage } from './api';

interface Props { conversationId: string }

export function Composer({ conversationId }: Props) {
  const [text, setText] = useState('');
  const send = useSendMessage(conversationId);
  const mediaUploadRef = useRef<MediaUploadHandle>(null);

  async function sendText() {
    const body = text.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ kind: 'text', body });
      setText('');
    } catch {
      toast.error('Falha ao enviar mensagem.');
    }
  }

  async function sendMedia(input: { kind: 'image' | 'document' | 'video' | 'audio'; mediaUrl: string; mediaMime?: string; caption?: string }) {
    try {
      await send.mutateAsync({
        kind: input.kind,
        mediaUrl: input.mediaUrl,
        mediaMime: input.mediaMime,
        body: input.caption,
      });
      toast.success('Mídia enviada.');
    } catch {
      toast.error('Falha ao enviar mídia.');
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  }

  // Listener global de paste: permite Ctrl+V de imagem/arquivo em qualquer
  // lugar da tela da conversa, não só dentro da textarea. Atendente tira print
  // (Win+Shift+S) e cola direto sem precisar focar o campo antes. Texto puro
  // não é interceptado — segue o paste normal.
  useEffect(() => {
    function handlePaste(e: globalThis.ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== 'file') continue;
        const raw = item.getAsFile();
        if (!raw) continue;
        e.preventDefault();
        const ext = raw.type.split('/')[1]?.split('+')[0] || 'bin';
        const named = new File([raw], `colado-${Date.now()}.${ext}`, { type: raw.type });
        mediaUploadRef.current?.openWithFile(named);
        return;
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  return (
    <div className="border-t border-border bg-background px-3 py-2 flex items-end gap-2">
      <TemplatePicker onPick={(body) => setText((t) => t + body)} />
      <EmojiPicker onPick={(e) => setText((t) => t + e)} />
      <MediaUpload
        ref={mediaUploadRef}
        onPick={(input) => sendMedia({
          kind: input.kind as 'image' | 'document' | 'video' | 'audio',
          mediaUrl: input.mediaUrl,
          mediaMime: input.mediaMime,
          caption: input.caption,
        })}
      />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Digite uma mensagem (Enter envia, Shift+Enter quebra linha, Ctrl+V cola imagens)"
        className="flex-1 min-h-[40px] max-h-32 resize-none"
        rows={1}
      />
      <Button
        type="button"
        size="icon"
        onClick={sendText}
        disabled={!text.trim() || send.isPending}
        className="rounded-full"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
