import { useCampaignsTimeseries, type ReportPeriod, type CampaignKind } from './api';
import { Skeleton } from '@/components/ui/skeleton';
import type { CampaignsTimeseriesBucket } from './types';

interface Props {
  period: ReportPeriod;
  kind: CampaignKind;
}

/**
 * Grafico de linhas (SVG inline, sem chart lib) com sent / replied / won por dia.
 * Eixo Y compartilhado entre as 3 series — sent costuma dominar, replied e won
 * aparecem pequenos. Util pra ver tendencia geral.
 */
export function CampaignsTimeseriesChart({ period, kind }: Props) {
  const { data, isLoading, isError } = useCampaignsTimeseries({ period, kind });

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
        Falha ao carregar série temporal.
      </div>
    );
  }
  if (isLoading || !data) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (data.buckets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Sem dados no período selecionado.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Atividade diária</h3>
          <p className="text-xs text-muted-foreground">{data.period.label} · sent, respostas e ganhos por dia</p>
        </div>
        <Legend />
      </div>
      <LinesChart buckets={data.buckets} />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <LegendDot color="hsl(var(--primary))" label="Enviadas" />
      <LegendDot color="rgb(16 185 129)" label="Respostas" />
      <LegendDot color="rgb(217 119 6)" label="Ganhos" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function LinesChart({ buckets }: { buckets: CampaignsTimeseriesBucket[] }) {
  const w = 800;
  const h = 220;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxY = Math.max(1, ...buckets.flatMap((b) => [b.sent, b.replied, b.won]));
  const yTicks = computeTicks(maxY, 4);

  const n = buckets.length;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;

  const xy = (i: number, v: number) => ({
    x: padL + i * stepX,
    y: padT + innerH - (v / maxY) * innerH,
  });

  const polyline = (key: 'sent' | 'replied' | 'won') =>
    buckets.map((b, i) => {
      const p = xy(i, b[key]);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');

  // Reduz numero de labels do X pra evitar overlap (max ~8).
  const xLabelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ minHeight: h }}>
        {/* Grid horizontal + Y labels */}
        {yTicks.map((t) => {
          const y = padT + innerH - (t / maxY) * innerH;
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="hsl(var(--border))"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* Eixo X */}
        <line
          x1={padL}
          x2={w - padR}
          y1={padT + innerH}
          y2={padT + innerH}
          stroke="hsl(var(--border))"
          strokeWidth={1}
        />

        {/* Lines: sent / replied / won */}
        <polyline
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          points={polyline('sent')}
        />
        <polyline
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth={2}
          points={polyline('replied')}
        />
        <polyline
          fill="none"
          stroke="rgb(217 119 6)"
          strokeWidth={2}
          points={polyline('won')}
        />

        {/* Dots no ultimo ponto pra dar referencia */}
        {n > 0 && (() => {
          const last = buckets[n - 1];
          const dots = [
            { v: last.sent, color: 'hsl(var(--primary))' },
            { v: last.replied, color: 'rgb(16 185 129)' },
            { v: last.won, color: 'rgb(217 119 6)' },
          ];
          return dots.map((d, i) => {
            const p = xy(n - 1, d.v);
            return <circle key={i} cx={p.x} cy={p.y} r={3} fill={d.color} />;
          });
        })()}

        {/* X labels (datas) */}
        {buckets.map((b, i) => {
          if (i % xLabelStep !== 0 && i !== n - 1) return null;
          const p = xy(i, 0);
          const label = formatShortDate(b.date);
          return (
            <text
              key={i}
              x={p.x}
              y={padT + innerH + 16}
              textAnchor="middle"
              fontSize={10}
              fill="hsl(var(--muted-foreground))"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function computeTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const step = Math.max(1, Math.ceil(max / count));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

function formatShortDate(iso: string): string {
  // iso = YYYY-MM-DD
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
