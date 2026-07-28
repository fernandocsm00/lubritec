import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Send, Mic, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from './EmojiPicker';
import { TemplatePicker } from './TemplatePicker';
import { MediaUpload, type MediaUploadHandle } from './MediaUpload';
import { useSendMessage, useUploadConversationMedia } from './api';
import { ApiError } from '@/lib/apiClient';

function pickRecordMime(): string {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const c of cands) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function sendErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    // Backend já manda mensagens prontas pro usuário (ex.: janela 24h fechada,
    // erro do provedor). Repassa direto em vez de mostrar fallback genérico.
    if (err.message && err.message !== 'Request failed') return err.message;
  }
  return fallback;
}

interface Props { conversationId: string }

export function Composer({ conversationId }: Props) {
  const [text, setText] = useState('');
  const send = useSendMessage(conversationId);
  const upload = useUploadConversationMedia();
  const mediaUploadRef = useRef<MediaUploadHandle>(null);

  // ── Gravação de voz ──
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  function cleanupRecording() {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
    setElapsed(0);
  }

  // Cleanup se o componente desmontar no meio da gravação.
  useEffect(() => () => cleanupRecording(), []);

  async function startRecording() {
    if (recording || send.isPending || upload.isPending) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecordMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        cleanupRecording();
        if (cancelledRef.current || chunksRef.current.length === 0) return;
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([new Blob(chunksRef.current, { type })], `audio-${Date.now()}.${ext}`, { type });
        try {
          const r = await upload.mutateAsync(file);
          await sendMedia({ kind: 'audio', mediaUrl: r.mediaUrl, mediaMime: r.mediaMime });
        } catch (err) {
          toast.error(sendErrorMessage(err, 'Falha ao enviar áudio.'));
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone. Verifique a permissão.');
    }
  }

  function stopAndSend() { cancelledRef.current = false; recorderRef.current?.stop(); }
  function cancelRecording() { cancelledRef.current = true; recorderRef.current?.stop(); }

  async function sendText() {
    const body = text.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ kind: 'text', body });
      setText('');
    } catch (err) {
      toast.error(sendErrorMessage(err, 'Falha ao enviar mensagem.'));
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
    } catch (err) {
      toast.error(sendErrorMessage(err, 'Falha ao enviar mídia.'));
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
      {recording ? (
        <>
          <Button
            type="button" variant="ghost" size="icon"
            onClick={cancelRecording}
            title="Cancelar gravação"
            className="rounded-full text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
          <div className="flex-1 flex items-center gap-2 text-sm text-destructive px-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
            Gravando… {fmtSecs(elapsed)}
          </div>
          <Button
            type="button" size="icon"
            onClick={stopAndSend}
            disabled={upload.isPending || send.isPending}
            title="Enviar áudio"
            className="rounded-full"
          >
            <Send className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <>
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
          {text.trim() ? (
            <Button
              type="button" size="icon"
              onClick={sendText}
              disabled={send.isPending}
              className="rounded-full"
            >
              <Send className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button" variant="ghost" size="icon"
              onClick={startRecording}
              disabled={send.isPending || upload.isPending}
              title="Gravar áudio"
              className="rounded-full"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
