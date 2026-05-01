import { useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from './EmojiPicker';
import { TemplatePicker } from './TemplatePicker';
import { MediaUpload } from './MediaUpload';
import { useSendMessage } from './api';

interface Props { conversationId: string }

export function Composer({ conversationId }: Props) {
  const [text, setText] = useState('');
  const send = useSendMessage(conversationId);

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

  return (
    <div className="border-t border-border bg-background px-3 py-2 flex items-end gap-2">
      <TemplatePicker onPick={(body) => setText((t) => t + body)} />
      <EmojiPicker onPick={(e) => setText((t) => t + e)} />
      <MediaUpload
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
        placeholder="Digite uma mensagem (Enter envia, Shift+Enter quebra linha)"
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
