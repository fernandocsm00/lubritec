import type { DashboardSummary } from '@shared/types';

export function FunnelChart({ funnel }: { funnel: DashboardSummary['funnel'] }) {
  const steps = funnel.kind === 'org'
    ? [
        { label: 'Leads novos',        value: funnel.newLeads,         convToNext: funnel.convLeadToConv,     nextLabel: 'conv → conversa' },
        { label: 'Conversaram',        value: funnel.withConversation, convToNext: funnel.convConvToProposal, nextLabel: 'conv → proposta' },
        { label: 'Propostas',          value: funnel.withProposal,     convToNext: funnel.convProposalToWon,  nextLabel: 'conv → ganho'    },
        { label: 'Ganhos',             value: funnel.won,              convToNext: null,                      nextLabel: ''                },
      ]
    : [
        { label: 'Conv. respondidas',  value: funnel.respondedConversations, convToNext: funnel.convRespToProposal, nextLabel: 'conv → proposta' },
        { label: 'Minhas propostas',   value: funnel.myProposals,            convToNext: funnel.convProposalToWon,  nextLabel: 'conv → ganho'    },
        { label: 'Meus ganhos',        value: funnel.myWon,                  convToNext: null,                      nextLabel: ''                },
      ];

  const max = Math.max(1, ...steps.map((s) => s.value));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">Funil do período</h3>
      <ul className="mt-4 space-y-2">
        {steps.map((s, i) => (
          <li key={s.label}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{s.label}</span>
              <span className="font-mono text-lc-ink">{s.value}</span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-lc-navy" style={{ width: `${(s.value / max) * 100}%` }} />
            </div>
            {s.convToNext != null && i < steps.length - 1 && (
              <p className="mt-1 font-mono text-xs text-slate-500">↓ {s.convToNext}% {s.nextLabel}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
