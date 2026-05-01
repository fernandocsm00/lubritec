import { useState, type KeyboardEvent } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from './EmojiPicker';
import { TemplatePicker } from './TemplatePicker';
import { useSendMessage } from './api';

interface Props { conversationId: string }

export function Composer({ conversationId }: Props) {
  const [text, setText] = useState('');
  const send = useSendMessage(conversationId);

  async function doSend() {
    const body = text.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ kind: 'text', body });
      setText('');
    } catch {
      toast.error('Falha ao enviar mensagem.');
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  return (
    <div className="border-t border-border bg-background px-3 py-2 flex items-end gap-2">
      <TemplatePicker onPick={(body) => setText((t) => t + body)} />
      <EmojiPicker onPick={(e) => setText((t) => t + e)} />
      <Button type="button" variant="ghost" size="icon" disabled title="Anexar (Task 17)">
        <Paperclip className="h-5 w-5" />
      </Button>
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
        onClick={doSend}
        disabled={!text.trim() || send.isPending}
        className="rounded-full"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
