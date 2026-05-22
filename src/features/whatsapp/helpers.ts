import type { MessageKind } from './types';

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function formatPhoneBR(phone: string): string {
  const d = normalizePhone(phone);
  if (d.length === 13) {
    // 5511987654321 → +55 11 98765-4321
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return phone;
}

export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'ontem';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'HOJE';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'ONTEM';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function mediaPlaceholder(kind: MessageKind): string {
  switch (kind) {
    case 'image': return '[imagem]';
    case 'audio': return '[áudio]';
    case 'video': return '[vídeo]';
    case 'document': return '[documento]';
    default: return '[mídia]';
  }
}

/**
 * Calcula minutos esperando na fila desde `enteredQueueAt`.
 * Retorna `null` se a coluna nao existir (conversa historica anterior ao backfill).
 */
export function waitingMinutes(enteredQueueAt: string | null): number | null {
  if (!enteredQueueAt) return null;
  const ms = Date.now() - new Date(enteredQueueAt).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

/**
 * Codificacao de cor por tempo de espera na fila Comercial.
 * <5min cinza (ok), 5-10min amarelo (atencao), >10min vermelho (escalado).
 */
export function waitingToneClasses(minutes: number | null): string {
  if (minutes == null) return 'text-muted-foreground';
  if (minutes < 5) return 'text-muted-foreground';
  if (minutes < 10) return 'text-lc-amber';
  return 'text-destructive font-medium';
}

export function formatWaitingLabel(minutes: number | null): string {
  if (minutes == null) return '';
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return '?';
  if (/^\d+$/.test(name.replace(/\D/g, ''))) return '?';
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
