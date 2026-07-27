import type { CampaignRecipientStatus, CampaignStatus } from '@shared/types';

export const RECIPIENT_STATUS_LABEL: Record<CampaignRecipientStatus, string> = {
  pending: 'Pendente',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
  skipped: 'Pulado',
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em andamento',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};
