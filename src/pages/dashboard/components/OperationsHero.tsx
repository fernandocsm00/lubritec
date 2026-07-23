import { Link } from 'react-router-dom';
import { Users, Clock, Bot, MessageSquare, Target } from 'lucide-react';
import type {
  DashboardKpis,
  DashboardGoal,
  DashboardWhatsappStats,
  DashboardAttentionResponse,
} from '@shared/types';
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils';

interface Props {
  kpis: DashboardKpis | undefined;
  goal: DashboardGoal | null | undefined;
  whatsapp: DashboardWhatsappStats | undefined;
  attention: DashboardAttentionResponse | undefined;
}

/**
 * Hero do dashboard — 2 colunas pra "bate o olho" diário:
 * - Esquerda (60%): faturamento do mes + gauge contra meta (se houver) + delta vs anterior
 * - Direita (40%): "AGORA" — estado em tempo real (fila, IA hoje, conversas ativas)
 *
 * Quando goal=null, o gauge some e o numero fica solo (CTA "Definir meta" link).
 */
export function OperationsHero({ kpis, goal, whatsapp, attention }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <RevenueCard kpis={kpis} goal={goal} />
      <NowCard whatsapp={whatsapp} attention={attention} />
    </div>
  );
}

function RevenueCard({ kpis, goal }: { kpis: DashboardKpis | undefined; goal: DashboardGoal | null | undefined }) {
  const revenue = kpis?.sales.value ?? 0;
  const deltaPct = kpis?.sales.deltaPct ?? 0;
  const hasGoal = goal != null && goal.monthlyTarget > 0;
  const gaugePct = hasGoal ? Math.min(100, goal.percent) : 0;

  return (
    <div className="lg:col-span-3 rounded-xl border border-border bg-card p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Vendas este mês
        </span>
        {kpis && (
          <DeltaPill deltaPct={deltaPct} />
        )}
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-bold text-foreground tabular-nums">
          {formatCurrencyCompact(revenue)}
        </span>
        {hasGoal && (
          <span className="text-sm text-muted-foreground">
            / {formatCurrencyCompact(goal.monthlyTarget)}
          </span>
        )}
      </div>

      {hasGoal ? (
        <Gauge pct={gaugePct} />
      ) : (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Target className="h-3.5 w-3.5" />
          <span>Sem meta cadastrada.</span>
          <Link
            to="/settings?tab=organization"
            className="text-primary hover:underline"
          >
            Definir agora
          </Link>
        </div>
      )}

      {kpis && (
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground/90 tabular-nums">{kpis.sales.count}</strong> deal{kpis.sales.count === 1 ? '' : 's'} ganho{kpis.sales.count === 1 ? '' : 's'}
          </span>
          {kpis.avgTicket.value > 0 && (
            <span>
              ticket médio <strong className="text-foreground/90">{formatCurrency(kpis.avgTicket.value)}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function NowCard({ whatsapp, attention }: { whatsapp: DashboardWhatsappStats | undefined; attention: DashboardAttentionResponse | undefined }) {
  const inQueue = whatsapp?.inQueue ?? 0;
  const expired24h = whatsapp?.expired24h ?? 0;
  const noResponseToday = whatsapp?.noResponseToday ?? 0;
  const queuePending = attention?.items.find((i) => i.kind === 'queue_pending')?.count ?? 0;

  return (
    <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6 flex flex-col gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        Agora
      </span>

      <div className="space-y-2.5 mt-1">
        <NowRow
          icon={<Clock className="h-4 w-4" />}
          label="Aguardando atendimento"
          value={queuePending}
          tone={queuePending === 0 ? 'muted' : queuePending < 3 ? 'amber' : 'destructive'}
          href="/whatsapp?queue=comercial&statusChips=aguardando&assignment=all&origin=organic,campaign"
        />
        <NowRow
          icon={<MessageSquare className="h-4 w-4" />}
          label="Conversas em fila"
          value={inQueue}
          tone={inQueue === 0 ? 'muted' : 'foreground'}
          href="/whatsapp?statusChips=aguardando,em_atendimento&assignment=all&origin=organic,campaign"
        />
        <NowRow
          icon={<Bot className="h-4 w-4" />}
          label="Sem resposta hoje"
          value={noResponseToday}
          tone={noResponseToday === 0 ? 'muted' : 'amber'}
          href="/whatsapp?statusChips=sem_retorno&assignment=all&origin=organic,campaign"
        />
        <NowRow
          icon={<Users className="h-4 w-4" />}
          label="Expiradas 24h"
          value={expired24h}
          tone={expired24h === 0 ? 'muted' : 'destructive'}
          href="/whatsapp?statusChips=expirada&assignment=all&origin=organic,campaign"
        />
      </div>
    </div>
  );
}

function NowRow({
  icon,
  label,
  value,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'muted' | 'foreground' | 'amber' | 'destructive';
  href?: string;
}) {
  const tones = {
    muted: 'text-muted-foreground',
    foreground: 'text-foreground',
    amber: 'text-amber-600 dark:text-amber-400 font-semibold',
    destructive: 'text-destructive font-semibold',
  };

  const inner = (
    <>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</span>
    </>
  );

  // Quando ha href E o valor eh > 0, vira um link clicavel pra Inbox filtrada.
  // Valor zero nao linka -- nao tem o que ver e visualmente parece "morto".
  if (href && value > 0) {
    return (
      <Link
        to={href}
        className="flex items-center justify-between gap-2 -mx-2 px-2 py-1 rounded-md hover:bg-muted/50 transition-colors group"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      {inner}
    </div>
  );
}

/**
 * Gauge horizontal estilo "barra de progresso premium". Não usei semi-circle
 * SVG pra evitar lib externa — barra horizontal funciona bem em laptops e
 * mobile, com cor mudando conforme se aproxima da meta.
 */
function Gauge({ pct }: { pct: number }) {
  const fillColor =
    pct >= 100
      ? 'bg-emerald-500'
      : pct >= 80
        ? 'bg-emerald-500/80'
        : pct >= 50
          ? 'bg-amber-500'
          : 'bg-amber-500/70';

  return (
    <div className="space-y-1">
      <div className="h-3 w-full rounded-full bg-muted overflow-hidden relative">
        <div
          className={`h-full transition-all duration-700 ${fillColor}`}
          style={{ width: `${pct}%` }}
        />
        {/* Marca de 100% se a barra está cheia ou perto */}
        {pct >= 100 && (
          <div className="absolute inset-0 flex items-center justify-end pr-2">
            <span className="text-[10px] font-bold text-white">META!</span>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{pct.toFixed(0)}% da meta</span>
        <span>{(100 - pct).toFixed(0)}% restante</span>
      </div>
    </div>
  );
}

function DeltaPill({ deltaPct }: { deltaPct: number }) {
  const rounded = Math.round(deltaPct * 10) / 10;
  if (Math.abs(rounded) < 0.1) {
    return <span className="text-xs text-muted-foreground">·</span>;
  }
  const dir = rounded > 0 ? 'up' : 'down';
  const tone =
    dir === 'up'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
      : 'bg-destructive/15 text-destructive';
  const arrow = dir === 'up' ? '↑' : '↓';
  const sign = rounded > 0 ? '+' : '';
  return (
    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${tone} flex items-center gap-1`}>
      {arrow} {sign}{rounded.toFixed(1)}% vs mês anterior
    </span>
  );
}
