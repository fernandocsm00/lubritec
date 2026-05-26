import type { DealStage, LossReason, DealActivityKind } from './types';
import type { LeadQualityFeedback } from '@shared/types';

export function formatCurrency(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function parseCurrencyInput(s: string): number | null {
  const cleaned = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isFinite(n) && n >= 0 ? n : null;
}

export const STAGE_LABELS: Record<DealStage, string> = {
  lead_no_comercial: 'Lead no Comercial',
  proposta_enviada: 'Proposta enviada',
  em_negociacao: 'Em negociação',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

export const STAGE_COLORS: Record<DealStage, string> = {
  lead_no_comercial: 'text-muted-foreground',
  proposta_enviada: 'text-primary',
  em_negociacao: 'text-primary',
  ganho: 'text-emerald-500',
  perdido: 'text-destructive',
};

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  condicoes_comerciais: 'Condições comerciais',
  preco: 'Preço',
  sem_retorno: 'Sem retorno',
  fora_do_perfil: 'Fora do perfil',
};

export const LEAD_QUALITY_FEEDBACK_LABELS: Record<LeadQualityFeedback, string> = {
  good: 'Bom',
  bad: 'Ruim',
};

export const ACTIVITY_ICONS: Record<DealActivityKind, string> = {
  created: '+',
  stage_changed: '↔',
  value_changed: '💰',
  note_added: '📝',
  won: '✅',
  lost: '❌',
  reactivated: '🔄',
  owner_changed: '👤',
  quality_feedback: '⭐',
};

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'ontem';
  if (diffD < 7) return `há ${diffD} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (/^\d+$/.test(name.replace(/\D/g, ''))) return '?';
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
