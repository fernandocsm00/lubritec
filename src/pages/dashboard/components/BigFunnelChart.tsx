import type { ReactNode } from 'react';
import { TrendingDown } from 'lucide-react';
import type { DashboardMacroFunnel } from '@shared/types';

interface Props {
  data: DashboardMacroFunnel;
  /** Slot no cabeçalho (ex.: filtro por campanha). */
  headerRight?: ReactNode;
}

interface StageRow {
  key: string;
  label: string;
  count: number;
}

/**
 * Funil VISUAL horizontal. Estágios (pedido Fernando): Leads com Telefone (topo)
 * → Disparados → Respondidos → No Comercial → Ganhos. Percentuais recalculados
 * a partir do topo (Leads com Telefone), não do total de leads importados.
 */
export function BigFunnelChart({ data, headerRight }: Props) {
  const stages: StageRow[] = [
    { key: 'complete',   label: 'Leads com Telefone', count: data.stages.complete.count },
    { key: 'dispatched', label: 'Disparados',         count: data.stages.dispatched.count },
    { key: 'engaged',    label: 'Respondidos',        count: data.stages.engaged.count },
    { key: 'handedOff',  label: 'No Comercial',       count: data.stages.handedOff.count },
    { key: 'won',        label: 'Ganhos',             count: data.stages.won.count },
  ];

  const top = stages[0].count || 1;

  // Maior drop-off entre etapas consecutivas.
  let maxDropStage: string | null = null;
  let maxDropValue = 0;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    const curr = stages[i].count;
    if (prev === 0) continue;
    const dropPct = ((prev - curr) / prev) * 100;
    if (dropPct > maxDropValue) {
      maxDropValue = dropPct;
      maxDropStage = stages[i].key;
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold">Funil de conversão</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.period.label} · {stages[0].count.toLocaleString('pt-BR')} lead{stages[0].count === 1 ? '' : 's'} com telefone
          </p>
        </div>
        <div className="flex items-center gap-2">
          {maxDropStage && maxDropValue >= 30 && (
            <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive border border-destructive/30">
              <TrendingDown className="h-3.5 w-3.5" />
              Maior queda: <span className="font-semibold">{maxDropValue.toFixed(0)}%</span> em{' '}
              <span className="font-semibold">{stages.find((s) => s.key === maxDropStage)?.label}</span>
            </div>
          )}
          {headerRight}
        </div>
      </div>

      <div className="space-y-2.5">
        {stages.map((stage, i) => {
          const widthPct = (stage.count / top) * 100;
          const pctOfTop = (stage.count / top) * 100;
          const prev = i === 0 ? null : stages[i - 1].count;
          const convFromPrev = prev == null ? null : prev === 0 ? 0 : (stage.count / prev) * 100;
          const isMaxDrop = stage.key === maxDropStage;
          const isFirst = i === 0;
          const fillTone = getFillTone(i, stages.length, isMaxDrop);

          return (
            <div key={stage.key} className="group">
              <div className="flex items-baseline justify-between mb-1 text-xs">
                <span className="text-foreground/90">{stage.label}</span>
                <span className="flex items-baseline gap-3 tabular-nums">
                  <span className="font-semibold text-foreground">{stage.count.toLocaleString('pt-BR')}</span>
                  {!isFirst && convFromPrev != null && (
                    <span
                      className={`text-[11px] ${
                        convFromPrev >= 70 ? 'text-emerald-700 dark:text-emerald-400' :
                        convFromPrev >= 30 ? 'text-amber-600 dark:text-amber-400' :
                        'text-destructive'
                      }`}
                    >
                      {convFromPrev.toFixed(1)}% da anterior
                    </span>
                  )}
                  {isFirst && (
                    <span className="text-[11px] text-muted-foreground">100%</span>
                  )}
                </span>
              </div>
              <div className="h-9 w-full rounded-md bg-muted/40 overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-500 ${fillTone}`}
                  style={{ width: `${widthPct}%` }}
                />
                <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
                  <span className="text-[11px] text-foreground/80 font-medium">
                    {pctOfTop.toFixed(1)}% do topo
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sidelines: sem telefone e perdidos */}
      {(data.sidelines.incomplete.count > 0 || data.sidelines.lost.count > 0) && (
        <div className="mt-5 pt-4 border-t border-border flex gap-6 text-xs">
          {data.sidelines.incomplete.count > 0 && (
            <div>
              <span className="text-muted-foreground">Sem telefone: </span>
              <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                {data.sidelines.incomplete.count}
              </span>
            </div>
          )}
          {data.sidelines.lost.count > 0 && (
            <div>
              <span className="text-muted-foreground">Perdidos: </span>
              <span className="font-semibold text-destructive tabular-nums">
                {data.sidelines.lost.count}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getFillTone(index: number, total: number, isMaxDrop: boolean): string {
  void total;
  if (isMaxDrop) {
    return 'bg-gradient-to-r from-destructive/40 to-destructive/70';
  }
  const tones = [
    'bg-gradient-to-r from-blue-400/60 to-blue-500/70',
    'bg-gradient-to-r from-cyan-500/65 to-teal-500/70',
    'bg-gradient-to-r from-teal-500/65 to-emerald-500/70',
    'bg-gradient-to-r from-emerald-500/70 to-emerald-600/80',
    'bg-gradient-to-r from-emerald-600/80 to-emerald-700/90',
  ];
  return tones[Math.min(index, tones.length - 1)];
}
