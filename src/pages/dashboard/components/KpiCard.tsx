import { Link } from 'react-router-dom';

export function KpiCard(props: {
  label: string;
  value: string;            // already-formatted (e.g. "R$ 48.200" or "31%")
  delta?: { pct: number; isGood: boolean; suffix?: string };  // suffix: '%' or 'pp'
  goal?: { percent: number; targetLabel: string };            // optional progress bar
  cta?: { label: string; to: string };                         // optional micro-CTA below value
  empty?: boolean;
  emptyHint?: string;
}) {
  const trend = !props.delta ? 'flat' : props.delta.pct > 0 ? 'up' : props.delta.pct < 0 ? 'down' : 'flat';
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '→';
  const trendColor = trend === 'flat'
    ? 'text-slate-400'
    : props.delta!.isGood ? 'text-emerald-600' : 'text-lc-ruby';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lc-card">
      <p className="text-xs uppercase tracking-wider text-slate-500">{props.label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-lc-ink">
        {props.empty ? '—' : props.value}
      </p>

      {props.empty && props.emptyHint && (
        <p className="mt-1 text-xs text-slate-400">{props.emptyHint}</p>
      )}

      {!props.empty && props.delta && (
        <p className={`mt-1 font-mono text-xs ${trendColor}`}>
          {arrow} {Math.abs(props.delta.pct)}{props.delta.suffix ?? '%'} vs período anterior
        </p>
      )}

      {props.goal && (
        <div className="mt-3">
          <div
            className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden"
            role="progressbar"
            aria-valuenow={props.goal.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso da meta: ${props.goal.percent}% de ${props.goal.targetLabel}`}
          >
            <div
              className="h-full bg-gradient-to-r from-lc-navy to-lc-amber"
              style={{ width: `${Math.min(100, props.goal.percent)}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {props.goal.percent}% de {props.goal.targetLabel}
          </p>
        </div>
      )}

      {!props.goal && props.cta && (
        <Link to={props.cta.to} className="mt-3 inline-block text-xs text-lc-navy hover:underline">
          {props.cta.label}
        </Link>
      )}
    </div>
  );
}
