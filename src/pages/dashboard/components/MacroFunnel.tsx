import { Link } from 'react-router-dom';
import {
  PackageOpen,
  PhoneCall,
  Send,
  MessageSquare,
  ShieldCheck,
  Handshake,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import type { DashboardMacroFunnel, MacroFunnelStage } from '@shared/types';

interface StageRow {
  key: string;
  label: string;
  hint: string;
  Icon: typeof PackageOpen;
  data: MacroFunnelStage;
  filterStage?: string; // pra link em /cadastros?flowStage=...
}

export function MacroFunnel({ data }: { data: DashboardMacroFunnel }) {
  const stages: StageRow[] = [
    {
      key: 'imported',
      label: 'Importados',
      hint: 'Total de leads criados no período (CSV + manual + WhatsApp inbound).',
      Icon: PackageOpen,
      data: data.stages.imported,
    },
    {
      key: 'complete',
      label: 'Com telefone',
      hint: 'Leads com telefone disponível, prontos pro disparo.',
      Icon: PhoneCall,
      data: data.stages.complete,
      filterStage: 'complete',
    },
    {
      key: 'dispatched',
      label: 'Disparados',
      hint: 'Receberam pelo menos uma mensagem (campanha ou disparo automático).',
      Icon: Send,
      data: data.stages.dispatched,
      filterStage: 'dispatched',
    },
    {
      key: 'engaged',
      label: 'Responderam',
      hint: 'Cliente mandou mensagem inbound — IA está conversando.',
      Icon: MessageSquare,
      data: data.stages.engaged,
      filterStage: 'engaged',
    },
    {
      key: 'qualified',
      label: 'Qualificados pela IA',
      hint: 'IA marcou QUALIFICADO — pronto pra comercial.',
      Icon: ShieldCheck,
      data: data.stages.qualified,
      filterStage: 'qualified',
    },
    {
      key: 'handedOff',
      label: 'Comercial assumiu',
      hint: 'Deal criado no pipeline pelo comercial.',
      Icon: Handshake,
      data: data.stages.handedOff,
      filterStage: 'handed_off',
    },
  ];

  const max = Math.max(1, ...stages.map((s) => s.data.count));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-slate-500">Funil de leads</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Etapas do fluxo macro · {data.period.label}
          </p>
        </div>
        <Link
          to="/cadastros"
          className="text-xs text-lc-navy hover:underline dark:text-sky-400"
        >
          Ver cadastros →
        </Link>
      </div>

      <ul className="mt-4 space-y-3">
        {stages.map((s, i) => {
          const widthPct = (s.data.count / max) * 100;
          const link = s.filterStage ? `/cadastros?flowStage=${s.filterStage}` : '/cadastros';
          return (
            <li key={s.key}>
              <Link to={link} className="group block">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200 group-hover:text-lc-navy dark:group-hover:text-sky-400">
                    <s.Icon className="h-4 w-4 text-slate-400" />
                    {s.label}
                  </span>
                  <span className="font-mono text-lc-ink dark:text-slate-100 tabular-nums">
                    {s.data.count.toLocaleString('pt-BR')}
                    <span className="ml-2 text-[11px] text-slate-400">{s.data.pctOfTotal.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-slate-800">
                  <div
                    className="h-full bg-lc-navy transition-all dark:bg-sky-500"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                {i > 0 && s.data.convFromPrev != null && (
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    ↓ {s.data.convFromPrev.toFixed(1)}% conversão da etapa anterior
                  </p>
                )}
              </Link>
              <p className="text-[11px] text-slate-400 mt-0.5">{s.hint}</p>
            </li>
          );
        })}
      </ul>

      {/* Sidelines (sem conversão) */}
      {(data.sidelines.incomplete.count > 0 || data.sidelines.lost.count > 0) && (
        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800">
          <h4 className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            Saídas do funil
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <SidelineCard
              Icon={AlertTriangle}
              label="Incompletos"
              hint="Sem telefone — precisam de enriquecimento."
              data={data.sidelines.incomplete}
              tone="amber"
              link="/cadastros?flowStage=incomplete"
            />
            <SidelineCard
              Icon={XCircle}
              label="Perdidos"
              hint="Encerrados sem conversão."
              data={data.sidelines.lost}
              tone="slate"
              link="/cadastros?flowStage=lost"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SidelineCard({
  Icon, label, hint, data, tone, link,
}: {
  Icon: typeof AlertTriangle;
  label: string;
  hint: string;
  data: MacroFunnelStage;
  tone: 'amber' | 'slate';
  link: string;
}) {
  const toneClass = tone === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300'
    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300';
  return (
    <Link to={link} className={`block rounded-lg border p-3 hover:shadow-sm transition-shadow ${toneClass}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Icon className="h-4 w-4" /> {label}
        </span>
        <span className="font-mono">
          {data.count.toLocaleString('pt-BR')}
          <span className="ml-1 text-[11px] opacity-70">{data.pctOfTotal.toFixed(1)}%</span>
        </span>
      </div>
      <p className="text-[11px] mt-1 opacity-70">{hint}</p>
    </Link>
  );
}
