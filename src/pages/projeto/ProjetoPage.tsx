import { useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Flag,
  Rocket,
  Users,
  ListChecks,
  Target,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FeedbackSection } from './FeedbackSection';

type ActivityStatus = 'done' | 'doing' | 'todo' | 'risk';

interface Activity {
  id: string;
  title: string;
  owner: 'Orion' | 'Lubritec' | 'Compartilhado';
  status: ActivityStatus;
  note?: string;
}

interface Sprint {
  id: string;
  number: number;
  title: string;
  dates: string;
  startISO: string;
  endISO: string;
  goal: string;
  activities: Activity[];
}

interface Risk {
  id: string;
  title: string;
  severity: 'alta' | 'média' | 'baixa';
  mitigation: string;
}

interface Milestone {
  id: string;
  date: string;
  title: string;
  description: string;
}

const PROJECT = {
  name: 'LubriConnect — MVP',
  partners: 'Orion Digital × Lubritec',
  kickoff: '10/06/2026',
  goLive: '12/06/2026',
  signOff: '12/06/2026',
};

const SPRINTS: Sprint[] = [
  {
    id: 's1',
    number: 1,
    title: 'Fundação',
    dates: '06 – 12 maio',
    startISO: '2026-05-06',
    endISO: '2026-05-12',
    goal: 'Ambiente, acessos e dívidas estruturais resolvidas para destravar paralelismo.',
    activities: [
      { id: 's1-a1', title: 'Kickoff oficial e alinhamento de escopo', owner: 'Compartilhado', status: 'done' },
      { id: 's1-a2', title: 'Provisionamento WhatsApp Business API', owner: 'Lubritec', status: 'doing', note: 'Única pendência para go-live — aprovação externa em andamento' },
      { id: 's1-a3', title: 'Migração de schema (customers)', owner: 'Orion', status: 'done' },
      { id: 's1-a4', title: 'Setup de ambiente staging', owner: 'Orion', status: 'done' },
      { id: 's1-a5', title: 'Disponibilizar contatos técnicos e acessos', owner: 'Lubritec', status: 'done' },
      { id: 's1-a6', title: 'Validação de identidade visual e textos', owner: 'Compartilhado', status: 'done' },
    ],
  },
  {
    id: 's2',
    number: 2,
    title: 'Core flows',
    dates: '13 – 19 maio',
    startISO: '2026-05-13',
    endISO: '2026-05-19',
    goal: 'Importação de base, criação e disparo de campanha funcionando ponta a ponta.',
    activities: [
      { id: 's2-a1', title: 'Importação CSV com validação de CNPJ ativo', owner: 'Orion', status: 'done' },
      { id: 's2-a2', title: 'CRUD de Customers (UI + API)', owner: 'Orion', status: 'done' },
      { id: 's2-a3', title: 'CRUD de Templates com variáveis dinâmicas', owner: 'Orion', status: 'done' },
      { id: 's2-a4', title: 'Criação e agendamento de Campanhas', owner: 'Orion', status: 'done' },
      { id: 's2-a5', title: 'Disparo real (sandbox WhatsApp)', owner: 'Orion', status: 'done' },
      { id: 's2-a6', title: 'Webhook de status (entregue/lido/respondido)', owner: 'Orion', status: 'done' },
      { id: 's2-a7', title: 'Demo intermediária — sexta 15/05', owner: 'Compartilhado', status: 'done' },
    ],
  },
  {
    id: 's3',
    number: 3,
    title: 'Inbox & IA',
    dates: '20 – 26 maio',
    startISO: '2026-05-20',
    endISO: '2026-05-26',
    goal: 'Diferenciais comerciais da proposta presentes e funcionais.',
    activities: [
      { id: 's3-a1', title: 'Inbox de conversas (lista + thread + responder)', owner: 'Orion', status: 'done' },
      { id: 's3-a2', title: 'Dashboard com métricas reais', owner: 'Orion', status: 'done' },
      { id: 's3-a3', title: 'IA de pré-qualificação de leads', owner: 'Orion', status: 'done', note: 'Gemini Flash 2.5 com retry/backoff' },
      { id: 's3-a4', title: 'Settings: integrações + perfil empresa', owner: 'Orion', status: 'done' },
      { id: 's3-a5', title: 'Auth de produção (substituir hardcoded)', owner: 'Orion', status: 'done' },
      { id: 's3-a6', title: 'Demo intermediária — sexta 22/05', owner: 'Compartilhado', status: 'done' },
    ],
  },
  {
    id: 's4',
    number: 4,
    title: 'UAT & Go-live',
    dates: '27 maio – 02 junho',
    startISO: '2026-05-27',
    endISO: '2026-06-02',
    goal: 'Estabilizar. Zero feature nova. UAT, treinamento e preparação do go-live.',
    activities: [
      { id: 's4-a1', title: 'Code freeze parcial (apenas P0/P1)', owner: 'Orion', status: 'done' },
      { id: 's4-a2', title: 'Testes ponta-a-ponta com dados reais', owner: 'Orion', status: 'done' },
      { id: 's4-a3', title: 'UAT com usuário-piloto', owner: 'Compartilhado', status: 'done' },
      { id: 's4-a4', title: 'Correção de bugs do UAT', owner: 'Orion', status: 'done' },
      { id: 's4-a5', title: 'Documentação e vídeo curto de uso', owner: 'Orion', status: 'done' },
      { id: 's4-a6', title: 'Treinamento da equipe Lubritec (1h)', owner: 'Compartilhado', status: 'done' },
      { id: 's4-a7', title: 'Backup, monitoramento e plano de rollback', owner: 'Orion', status: 'done' },
    ],
  },
];

const RISKS: Risk[] = [
  {
    id: 'r1',
    title: 'Aprovação WhatsApp Business pode atrasar',
    severity: 'alta',
    mitigation: 'Iniciar processo no dia 1. Usar sandbox como fallback de demo até liberação.',
  },
  {
    id: 'r2',
    title: 'IA de pré-qualificação consumir mais tempo que o estimado',
    severity: 'média',
    mitigation: 'Definir já na Sprint 1 se será LLM via API ou regras + ML simples.',
  },
  {
    id: 'r3',
    title: 'UAT revelar mudanças de escopo grandes',
    severity: 'média',
    mitigation: 'Demos intermediárias a cada sexta da S2 e S3 para feedback antecipado.',
  },
];

const MILESTONES: Milestone[] = [
  { id: 'm1', date: '06/05', title: 'Kickoff oficial', description: 'Alinhamento de escopo, acessos e cronograma' },
  { id: 'm2', date: '12/05', title: 'Staging no ar', description: 'Ambiente disponível para validação contínua' },
  { id: 'm3', date: '19/05', title: 'Primeira campanha-teste enviada', description: 'Disparo real em sandbox com webhook funcionando' },
  { id: 'm4', date: '26/05', title: 'Feature complete', description: 'Todos os módulos da proposta presentes' },
  { id: 'm5', date: '02/06', title: 'UAT aprovado', description: 'Sign-off do piloto Lubritec' },
  { id: 'm6', date: '03/06', title: 'Go-live em produção', description: 'Ativação do número oficial' },
  { id: 'm7', date: '06/06', title: 'Sign-off final', description: 'Início da garantia/suporte contratual' },
];

interface AcceptanceStage {
  id: string;
  number: string;
  window: string;
  title: string;
  sees: string;
  action: string;
  criteria: string;
  isFinal?: boolean;
}

const ACCEPTANCE: AcceptanceStage[] = [
  {
    id: 'a1',
    number: '01',
    window: 'S1–S2 · 06–19 maio',
    title: 'Validação da estrutura do SaaS',
    sees: 'Ambiente staging acessível, sidebar com todos os módulos, dados de exemplo, identidade visual aplicada.',
    action: 'Percorrer a sidebar, validar identidade visual e os textos das primeiras telas e templates.',
    criteria: '"Consigo entender onde fica cada coisa sem precisar perguntar."',
  },
  {
    id: 'a15',
    number: '1.5',
    window: 'final S2 · 19 maio',
    title: 'Rodada de validação com usuários-chave',
    sees: 'Demo guiada de 1h com 2 a 3 pessoas-chave da Lubritec.',
    action: 'Apontar fricções de UX e fluxos confusos antes de virarem bugs em produção.',
    criteria: 'Ata da demo com até 10 ajustes priorizados. Restante vai para backlog pós-MVP.',
  },
  {
    id: 'a2',
    number: '02',
    window: 'S3 · 20–26 maio',
    title: 'Teste de funcionalidades com usuários reais',
    sees: 'Importação de base, criação de templates, agendamento e disparo de campanha-teste.',
    action: 'Importar base controlada (50 a 100 clientes), criar 3 templates e disparar 1 campanha-teste.',
    criteria: 'Taxa de entrega ≥ 95%, webhook registra status corretamente, nenhum bug bloqueante.',
  },
  {
    id: 'a3',
    number: '03',
    window: 'final S3 / início S4 · 26–29 maio',
    title: 'Teste da IA e workflow ponta-a-ponta',
    sees: 'Inbox alimentado com respostas reais e a IA categorizando cada uma automaticamente.',
    action: 'Revisar 30 classificações da IA e marcar acertos / erros para calibração.',
    criteria: 'Acurácia ≥ 80% nas classificações revisadas. Falsos positivos catalogados.',
  },
  {
    id: 'a4',
    number: '04',
    window: 'S4 · 27 maio – 06 junho',
    title: 'Sign-off e go-live',
    sees: 'Sistema final em produção com número WhatsApp oficial e equipe treinada.',
    action: 'Participar do treinamento, validar checklist final e assinar ata de aceite.',
    criteria: 'Documento de sign-off assinado com data, escopo entregue e ressalvas (se houver).',
    isFinal: true,
  },
];

interface PostMilestone {
  id: string;
  emoji: string;
  day: string;
  date: string;
  title: string;
  description: string;
}

const POST_MILESTONES: PostMilestone[] = [
  {
    id: 'p1',
    emoji: '🚀',
    day: 'Dia 1',
    date: '03/06',
    title: 'Primeira campanha real disparada',
    description: 'Validação de que o pipeline ponta-a-ponta funciona em produção.',
  },
  {
    id: 'p2',
    emoji: '🎯',
    day: 'Dia 7',
    date: '10/06',
    title: 'Primeiros leads qualificados pela IA',
    description: 'Inside sales recebe a primeira lista filtrada automaticamente.',
  },
  {
    id: 'p3',
    emoji: '📈',
    day: 'Dia 30',
    date: '03/07',
    title: 'Relatório de ROI vs. baseline',
    description: 'Comparativo entre métrica pré-MVP e o primeiro mês de operação.',
  },
];

const STATUS_LABEL: Record<ActivityStatus, string> = {
  done: 'Concluído',
  doing: 'Em andamento',
  todo: 'Não iniciado',
  risk: 'Em risco',
};

const STATUS_STYLES: Record<ActivityStatus, string> = {
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  doing: 'bg-sky-50 text-sky-700 border-sky-200',
  todo: 'bg-slate-50 text-slate-600 border-slate-200',
  risk: 'bg-amber-50 text-amber-700 border-amber-200',
};

const SEVERITY_STYLES: Record<Risk['severity'], string> = {
  alta: 'bg-rose-50 text-rose-700 border-rose-200',
  'média': 'bg-amber-50 text-amber-700 border-amber-200',
  baixa: 'bg-slate-50 text-slate-600 border-slate-200',
};

function StatusIcon({ status }: { status: ActivityStatus }) {
  const className = 'h-4 w-4 shrink-0';
  if (status === 'done') return <CheckCircle2 className={cn(className, 'text-emerald-600')} />;
  if (status === 'doing') return <Clock className={cn(className, 'text-sky-600')} />;
  if (status === 'risk') return <AlertTriangle className={cn(className, 'text-amber-600')} />;
  return <Circle className={cn(className, 'text-slate-400')} />;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function activeSprintId(): string {
  const today = todayISO();
  const current = SPRINTS.find((s) => today >= s.startISO && today <= s.endISO);
  return current?.id ?? SPRINTS[0].id;
}

export default function ProjetoPage() {
  const [activeTab, setActiveTab] = useState<string>(() => activeSprintId());

  const stats = useMemo(() => {
    const all = SPRINTS.flatMap((s) => s.activities);
    return {
      total: all.length,
      done: all.filter((a) => a.status === 'done').length,
      doing: all.filter((a) => a.status === 'doing').length,
      risk: all.filter((a) => a.status === 'risk').length,
    };
  }, []);

  const progress = 95;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* HEADER */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            {PROJECT.partners}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-lc-ink">
            {PROJECT.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhamento das atividades, marcos e riscos do projeto. Atualizado conforme o time avança.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>Kickoff <strong className="text-lc-ink">{PROJECT.kickoff}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-700">
            <Rocket className="h-3.5 w-3.5" />
            <span>Go-live <strong>{PROJECT.goLive}</strong></span>
          </div>
        </div>
      </header>

      {/* KPI ROW */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Progresso"
          value={`${progress}%`}
          accent="text-lc-navy"
          extra={
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-lc-navy"
                style={{ width: `${progress}%`, background: 'var(--lc-navy)' }}
              />
            </div>
          }
        />
        <KpiCard label="Concluídas" value={stats.done} accent="text-emerald-600" sub={`de ${stats.total} atividades`} />
        <KpiCard label="Em andamento" value={stats.doing} accent="text-sky-600" sub="Sprint ativa" />
        <KpiCard label="Em risco" value={stats.risk} accent="text-amber-600" sub="Requerem atenção" />
      </section>

      {/* SPRINT TABS */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 overflow-x-auto">
          <ListChecks className="h-4 w-4 text-slate-400 shrink-0" />
          {SPRINTS.map((s) => {
            const isActive = activeTab === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveTab(s.id)}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  isActive
                    ? 'bg-lc-navy text-white'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
                style={isActive ? { background: 'var(--lc-navy)' } : undefined}
              >
                <span className="font-mono opacity-70">S{s.number}</span> · {s.title}
              </button>
            );
          })}
        </div>

        {SPRINTS.filter((s) => s.id === activeTab).map((sprint) => (
          <div key={sprint.id} className="p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-lc-ink">
                  Sprint {sprint.number} — {sprint.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{sprint.goal}</p>
              </div>
              <div className="font-mono text-xs uppercase tracking-wider text-slate-500">
                {sprint.dates}
              </div>
            </div>

            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {sprint.activities.map((act) => (
                <li key={act.id} className="flex items-start gap-3 px-4 py-3">
                  <StatusIcon status={act.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-lc-ink">{act.title}</span>
                      <Badge variant="outline" className={cn('font-normal', STATUS_STYLES[act.status])}>
                        {STATUS_LABEL[act.status]}
                      </Badge>
                    </div>
                    {act.note && (
                      <div className="mt-1 text-xs text-muted-foreground">{act.note}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                    <Users className="h-3.5 w-3.5" />
                    <span>{act.owner}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* MILESTONES + RISKS */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Flag className="h-4 w-4 text-lc-navy" style={{ color: 'var(--lc-navy)' }} />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Marcos</h3>
          </div>
          <ol className="relative ml-2 space-y-4 border-l border-slate-200 pl-5">
            {MILESTONES.map((m) => (
              <li key={m.id} className="relative">
                <span
                  className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white"
                  style={{ background: 'var(--lc-amber)' }}
                />
                <div className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                  {m.date}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-lc-ink">{m.title}</div>
                <div className="text-xs text-muted-foreground">{m.description}</div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Riscos monitorados</h3>
          </div>
          <ul className="space-y-3">
            {RISKS.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-lc-ink">{r.title}</span>
                  <Badge variant="outline" className={cn('font-normal capitalize', SEVERITY_STYLES[r.severity])}>
                    {r.severity}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-slate-600">Mitigação:</span> {r.mitigation}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CRITÉRIOS DE ACEITE */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Target className="h-4 w-4 text-lc-navy" style={{ color: 'var(--lc-navy)' }} />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Critérios de aceite por etapa
          </h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          O que precisa acontecer em cada etapa para a Lubritec considerar a entrega aceita.
          "Pronto" não é opinião — é checklist.
        </p>
        <div className="space-y-3">
          {ACCEPTANCE.map((stage) => (
            <div
              key={stage.id}
              className={cn(
                'grid grid-cols-[60px_1fr] gap-4 rounded-lg border p-4',
                stage.isFinal ? 'border-rose-200 bg-rose-50/40' : 'border-slate-100 bg-slate-50/40',
              )}
            >
              <div>
                <div
                  className={cn(
                    'font-mono text-2xl font-bold leading-none',
                    stage.isFinal ? 'text-rose-600' : 'text-lc-navy',
                  )}
                  style={!stage.isFinal ? { color: 'var(--lc-navy)' } : undefined}
                >
                  {stage.number}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  {stage.window}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold text-lc-ink">{stage.title}</div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <AcceptBlock label="O que vocês verão" text={stage.sees} />
                  <AcceptBlock label="Ação esperada" text={stage.action} />
                  <AcceptBlock label="Critério de aceite" text={stage.criteria} accent />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* MARCOS PÓS-ENTREGA */}
      <section className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50/40 to-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-rose-600" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Marcos pós-entrega
          </h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Datas que a Lubritec deve esperar como retornos visíveis do investimento, comunicadas pela
          Orion conforme acontecem. Em paralelo, hipercare ativo de <strong className="text-rose-700">03/06 a 17/06</strong>.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {POST_MILESTONES.map((m) => (
            <div key={m.id} className="rounded-lg border border-rose-100 bg-white p-4 text-center">
              <div className="text-2xl">{m.emoji}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-rose-600">
                {m.day} · {m.date}
              </div>
              <div className="mt-1 text-sm font-semibold text-lc-ink">{m.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{m.description}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TrendingUp className="h-3.5 w-3.5 shrink-0" />
          <span>
            Sucesso é medido contra a baseline definida em S1/S2. Sem baseline, não há ROI.
          </span>
        </div>
      </section>

      {/* AJUSTES */}
      <FeedbackSection />

      {/* FOOTER NOTE */}
      <p className="text-xs text-muted-foreground">
        Esta página tem propósito informativo e é compartilhada entre Orion e Lubritec.
        O conteúdo é atualizado a cada virada de sprint e nas demos de sexta.
      </p>
    </div>
  );
}

function AcceptBlock({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-md border p-3',
        accent ? 'border-sky-200 bg-sky-50/60' : 'border-slate-200 bg-white',
      )}
    >
      <div
        className={cn(
          'font-mono text-[10px] uppercase tracking-wider font-bold mb-1',
          accent ? 'text-sky-700' : 'text-slate-500',
        )}
      >
        {label}
      </div>
      <div className="text-xs leading-relaxed text-slate-700">{text}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  sub,
  extra,
}: {
  label: string;
  value: string | number;
  accent?: string;
  sub?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className={cn('mt-1 text-2xl font-bold', accent)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      {extra}
    </div>
  );
}
