import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Wifi,
  Clock,
  Inbox,
} from 'lucide-react';
import type {
  DashboardAttentionResponse,
  DashboardAttentionItem,
  DashboardWhatsappStats,
} from '@shared/types';
import { formatCurrency } from '@/lib/utils';
import { buildAttentionHref } from './attentionHref';

interface Props {
  attention: DashboardAttentionResponse | undefined;
  whatsapp: DashboardWhatsappStats | undefined;
  currentMonthSales?: number;
}

/**
 * Status ribbon — semaforo da operacao no topo do /dashboard.
 *
 * Clicavel: ao clicar, expande inline e lista as situacoes que estao
 * causando o estado (criticas + warnings + whatsapp desconectado), cada
 * uma com um link "Ir resolver" pro destino apropriado. Quando a situacao
 * eh resolvida, o ribbon volta pra verde no proximo poll (15-30s).
 *
 * Niveis:
 *  - red (CRITICO): WhatsApp desconectado OU >=1 attention severity=critical
 *  - yellow (ATENCAO): >=1 attention severity=warning
 *  - green (OK): nada quebrado
 */
export function StatusRibbon({ attention, whatsapp, currentMonthSales }: Props) {
  const items = attention?.items ?? [];
  const criticalItems = items.filter((i) => i.severity === 'critical');
  const warningItems = items.filter((i) => i.severity === 'warning');
  const whatsappDown = whatsapp != null && !whatsapp.instanceConnected;

  const level: 'red' | 'yellow' | 'green' =
    whatsappDown || criticalItems.length > 0
      ? 'red'
      : warningItems.length > 0
        ? 'yellow'
        : 'green';

  // Lista unificada das situacoes expansiveis (so populada nos niveis red/yellow)
  const issues = buildIssues({ criticalItems, warningItems, whatsappDown });
  const expandable = issues.length > 0;
  const [open, setOpen] = useState(false);

  const tones = {
    red: {
      bg: 'bg-destructive/10 border-destructive/40 hover:bg-destructive/15',
      text: 'text-destructive',
      icon: <AlertOctagon className="h-5 w-5" />,
      pulse: 'animate-[pulse_2s_ease-in-out_infinite]',
    },
    yellow: {
      bg: 'bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/15',
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
  const headline = buildHeadline({
    level,
    criticalCount: criticalItems.length,
    warningCount: warningItems.length,
    whatsappDown,
    currentMonthSales,
  });

  // Quando nao tem nada pra expandir (estado verde), renderiza um div estatico
  // pra evitar feedback visual de botao sem acao.
  if (!expandable) {
    return (
      <div className={`rounded-lg border-2 ${tone.bg} ${tone.text} px-4 py-3 flex items-center gap-3`}>
        <div className={tone.pulse}>{tone.icon}</div>
        <div className="font-semibold text-sm flex-1">{headline}</div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border-2 ${tone.bg} ${tone.text} transition-colors`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
        aria-expanded={open}
        aria-controls="status-ribbon-details"
      >
        <div className={tone.pulse}>{tone.icon}</div>
        <div className="font-semibold text-sm flex-1">{headline}</div>
        <div className="flex items-center gap-1.5 text-xs opacity-80">
          {open ? 'Ocultar' : 'Ver detalhes'}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {open && (
        <div
          id="status-ribbon-details"
          className="border-t border-current/20 px-4 py-3 space-y-2"
        >
          {issues.map((issue) => (
            <IssueRow key={issue.key} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Issue {
  key: string;
  severity: 'critical' | 'warning';
  icon: React.ReactNode;
  label: string;
  route: string;
  cta: string;
}

function buildIssues(opts: {
  criticalItems: DashboardAttentionItem[];
  warningItems: DashboardAttentionItem[];
  whatsappDown: boolean;
}): Issue[] {
  const issues: Issue[] = [];

  if (opts.whatsappDown) {
    issues.push({
      key: 'whatsapp_down',
      severity: 'critical',
      icon: <Wifi className="h-4 w-4" />,
      label: 'Instância WhatsApp desconectada — disparos e respostas pausados',
      route: '/settings?tab=whatsapp',
      cta: 'Reconectar',
    });
  }

  for (const item of [...opts.criticalItems, ...opts.warningItems]) {
    issues.push({
      key: `attn-${item.kind}-${item.severity}`,
      severity: item.severity === 'critical' ? 'critical' : 'warning',
      icon: ICON_BY_KIND[item.kind] ?? <AlertTriangle className="h-4 w-4" />,
      label: ATTENTION_COPY[item.kind](item.count),
      route: buildAttentionHref(item),
      cta: ATTENTION_CTA[item.kind] ?? 'Resolver',
    });
  }

  return issues;
}

function IssueRow({ issue }: { issue: Issue }) {
  const sevTone =
    issue.severity === 'critical'
      ? 'bg-destructive/15 text-destructive'
      : 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-8 w-8 items-center justify-center rounded-md ${sevTone}`}>
        {issue.icon}
      </span>
      <span className="flex-1 text-sm text-foreground/90">{issue.label}</span>
      <Link
        to={issue.route}
        className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-background hover:bg-background/80 border border-border transition-colors"
      >
        {issue.cta}
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------
// Mesma copy/route que AttentionList — mantemos separado por enquanto
// pra nao introduzir dependencia circular; idealmente extrai pra helpers.
// A traducao filter->href (buildAttentionHref), essa sim, é compartilhada —
// ver ./attentionHref.ts.
// ------------------------------------------------------------------

const ATTENTION_COPY: Record<DashboardAttentionItem['kind'], (n: number) => string> = {
  proposal_old:  (n) => `${n} ${n === 1 ? 'proposta' : 'propostas'} há +14 dias sem retorno`,
  pending_reply: (n) => `${n} ${n === 1 ? 'conversa está' : 'conversas estão'} aguardando nossa resposta`,
  deal_stale:    (n) => `${n} ${n === 1 ? 'deal parado' : 'deals parados'} há +5 dias`,
  queue_pending: (n) => `${n} ${n === 1 ? 'conversa aguardando' : 'conversas aguardando'} no comercial`,
};

const ATTENTION_CTA: Record<DashboardAttentionItem['kind'], string> = {
  proposal_old: 'Abrir lista',
  pending_reply:'Abrir inbox',
  deal_stale:   'Abrir kanban',
  queue_pending:'Atender',
};

const ICON_BY_KIND: Record<DashboardAttentionItem['kind'], React.ReactNode> = {
  proposal_old:  <Clock className="h-4 w-4" />,
  pending_reply: <AlertTriangle className="h-4 w-4" />,
  deal_stale:    <Clock className="h-4 w-4" />,
  queue_pending: <Inbox className="h-4 w-4" />,
};

function buildHeadline(opts: {
  level: 'red' | 'yellow' | 'green';
  criticalCount: number;
  warningCount: number;
  whatsappDown: boolean;
  currentMonthSales: number | undefined;
}): string {
  if (opts.level === 'red') {
    if (opts.whatsappDown && opts.criticalCount === 0) {
      return 'WhatsApp desconectado — clique pra reconectar';
    }
    const total = opts.criticalCount + (opts.whatsappDown ? 1 : 0);
    return `Ação imediata: ${total} situaç${total === 1 ? 'ão crítica aberta' : 'ões críticas abertas'}`;
  }
  if (opts.level === 'yellow') {
    return `Atenção: ${opts.warningCount} ponto${opts.warningCount === 1 ? '' : 's'} pedindo cuidado`;
  }
  if (opts.currentMonthSales != null && opts.currentMonthSales > 0) {
    return `Operação rodando bem · ${formatCurrency(opts.currentMonthSales)} este mês`;
  }
  return 'Operação rodando bem';
}
