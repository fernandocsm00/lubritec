import type { HsmStatus } from './types';

const STYLES: Record<HsmStatus, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-600',
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  PAUSED: 'bg-orange-100 text-orange-700',
  DISABLED: 'bg-zinc-200 text-zinc-500',
};

const LABELS: Record<HsmStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING: 'Em aprovação',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  DISABLED: 'Desativado',
};

export function TemplateStatusBadge({ status }: { status: HsmStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
