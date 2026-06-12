import type { CampaignRecipientStatus, CampaignStatus, LossReason } from './types';

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em execução',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export const CAMPAIGN_STATUS_TONES: Record<CampaignStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  running: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  paused: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  completed: 'bg-primary/15 text-primary border-primary/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export const RECIPIENT_STATUS_LABELS: Record<CampaignRecipientStatus, string> = {
  pending: 'Pendente',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
  skipped: 'Ignorado',
};

export const RECIPIENT_STATUS_TONES: Record<CampaignRecipientStatus, string> = {
  pending: 'bg-muted text-muted-foreground border-border',
  sending: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  sent: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  failed: 'bg-destructive/15 text-destructive border-destructive/30',
  skipped: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
};

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  condicoes_comerciais: 'Condições comerciais',
  preco: 'Preço',
  sem_retorno: 'Sem retorno',
  fora_do_perfil: 'Fora do perfil',
};

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatPercent(num: number, total: number): string {
  if (total === 0) return '0%';
  return `${((num / total) * 100).toFixed(1)}%`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
