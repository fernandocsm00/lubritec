import { CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import type { DashboardAttentionResponse, DashboardWhatsappStats } from '@shared/types';
import { formatCurrency } from '@/lib/utils';

interface Props {
  attention: DashboardAttentionResponse | undefined;
  whatsapp: DashboardWhatsappStats | undefined;
  currentMonthSales?: number;
}

/**
 * Status ribbon at the very top of the dashboard. Derives operation health
 * from attention items + WhatsApp instance status.
 *
 * Estados:
 * - red (CRÍTICO): WhatsApp desconectado OU >=1 attention severity=critical
 * - yellow (ATENÇÃO): >=1 attention severity=warning
 * - green (OK): nenhum critical/warning
 *
 * Dimensiona altura e cor pro usuário "bater o olho" em < 2 seg.
 */
export function StatusRibbon({ attention, whatsapp, currentMonthSales }: Props) {
  const items = attention?.items ?? [];
  const criticalCount = items.filter((i) => i.severity === 'critical').length;
  const warningCount = items.filter((i) => i.severity === 'warning').length;
  const whatsappDown = whatsapp && !whatsapp.instanceConnected;

  const level: 'red' | 'yellow' | 'green' = whatsappDown || criticalCount > 0
    ? 'red'
    : warningCount > 0
      ? 'yellow'
      : 'green';

  const tones = {
    red: {
      bg: 'bg-destructive/10 border-destructive/40',
      text: 'text-destructive',
      icon: <AlertOctagon className="h-5 w-5" />,
      pulse: 'animate-[pulse_2s_ease-in-out_infinite]',
    },
    yellow: {
      bg: 'bg-amber-500/10 border-amber-500/40',
      text: 'text-amber-700 dark:text-amber-400',
      icon: <AlertTriangle className="h-5 w-5" />,
      pulse: '',
    },
    green: {
      bg: 'bg-emerald-500/10 border-emerald-500/40',
      text: 'text-emerald-700 dark:text-emerald-400',
      icon: <CheckCircle2 className="h-5 w-5" />,
      pulse: '',
    },
  };
  const tone = tones[level];

  const headline = buildHeadline({ level, criticalCount, warningCount, whatsappDown, currentMonthSales });

  return (
    <div className={`rounded-lg border-2 ${tone.bg} ${tone.text} px-4 py-3 flex items-center gap-3`}>
      <div className={tone.pulse}>{tone.icon}</div>
      <div className="font-semibold text-sm flex-1">{headline}</div>
    </div>
  );
}

function buildHeadline(opts: {
  level: 'red' | 'yellow' | 'green';
  criticalCount: number;
  warningCount: number;
  whatsappDown: boolean | undefined;
  currentMonthSales: number | undefined;
}): string {
  if (opts.level === 'red') {
    if (opts.whatsappDown) return 'WhatsApp desconectado — verificar instância';
    return `Ação imediata: ${opts.criticalCount} situaç${opts.criticalCount === 1 ? 'ão crítica' : 'ões críticas'} aberta${opts.criticalCount === 1 ? '' : 's'}`;
  }
  if (opts.level === 'yellow') {
    return `Atenção: ${opts.warningCount} ponto${opts.warningCount === 1 ? '' : 's'} pedindo cuidado`;
  }
  // Green
  if (opts.currentMonthSales != null && opts.currentMonthSales > 0) {
    return `Operação rodando bem · ${formatCurrency(opts.currentMonthSales)} este mês`;
  }
  return 'Operação rodando bem';
}
