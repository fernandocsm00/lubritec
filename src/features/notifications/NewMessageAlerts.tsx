import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useNotifications } from './api';

/** Bip curto via Web Audio (sem asset). Pode não tocar antes de 1ª interação. */
function playPing() {
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // silencioso
  }
}

/**
 * Alerta global de nova mensagem no WhatsApp (app aberto): som + toast, e
 * notificação nativa do navegador quando a aba não está em foco. Reage às
 * notificações kind='new_message' que o backend emite. Montado no AppShell.
 */
export function NewMessageAlerts() {
  const navigate = useNavigate();
  const { data } = useNotifications();
  const seenRef = useRef<Set<string>>(new Set());
  const initedRef = useRef(false);

  // Pede permissão de notificação do navegador uma vez.
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const msgs = (data?.items ?? []).filter((n) => n.kind === 'new_message');

    // Primeira carga: marca tudo como visto (não alerta por notificações antigas).
    if (!initedRef.current) {
      msgs.forEach((n) => seenRef.current.add(n.id));
      initedRef.current = true;
      return;
    }

    const fresh = msgs.filter((n) => !n.readAt && !seenRef.current.has(n.id));
    fresh.forEach((n) => seenRef.current.add(n.id));
    if (fresh.length === 0) return;

    playPing();
    const n = fresh[0];
    const open = () => { if (n.actionUrl) navigate(n.actionUrl); };
    toast(n.title, {
      description: fresh.length > 1 ? `${fresh.length} novas mensagens` : n.body,
      action: { label: 'Abrir', onClick: open },
    });

    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const native = new Notification(n.title, { body: n.body, tag: 'wa-new-message' });
        native.onclick = () => { window.focus(); open(); native.close(); };
      } catch {
        // silencioso
      }
    }
  }, [data, navigate]);

  return null;
}
