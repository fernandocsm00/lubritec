import type { InstanceStatus } from './types';

export const STATUS_LABELS: Record<InstanceStatus, string> = {
  disconnected: 'Canal Desconectado',
  pairing: 'Pareando',
  connected: 'Canal Conectado',
  error: 'Erro de Conexão',
};

export const STATUS_TONES: Record<InstanceStatus, string> = {
  disconnected: 'bg-muted text-muted-foreground',
  pairing: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  connected: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  error: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function formatPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return phone;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'agora';
  if (diffSec < 60) return `há ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
