import { useEffect, useState } from 'react';
import { Bot, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getOrgSettings, updateOrgSettings, testAiPrompt, type TestPromptResult } from './api';
import type { PublicOrgSettings, UpdateOrgSettingsInput } from '@shared/types';

type FormState = Pick<PublicOrgSettings,
  | 'aiEnabled' | 'aiAgentName' | 'aiBusinessName' | 'aiBusinessDesc' | 'aiProducts'
  | 'aiTargetAudience' | 'aiTone' | 'aiObjective' | 'aiDontTalk' | 'aiAlwaysAsk'
  | 'aiQualifyWhen' | 'aiBusinessHours' | 'aiAfterHoursMsg'
  | 'aiBusinessHoursStart' | 'aiBusinessHoursEnd' | 'aiBusinessHoursDays' | 'ai24x7'
  | 'aiAutoReplyWindowSeconds' | 'pendingReplyAlertMin' | 'pendingReplyEscalateMin'>;

// Labels human-friendly pros campos que aparecem em erro de validacao.
// Cobre todos os campos editaveis em AiTab + os de horario comercial.
const FIELD_LABELS: Record<string, string> = {
  aiAgentName: 'Nome do agente',
  aiBusinessName: 'Nome da empresa',
  aiBusinessDesc: 'Descrição do negócio',
  aiProducts: 'Produtos e serviços',
  aiTargetAudience: 'Público-alvo',
  aiTone: 'Tom de voz',
  aiObjective: 'Objetivo principal',
  aiDontTalk: 'NÃO falar sobre',
  aiAlwaysAsk: 'SEMPRE perguntar',
  aiQualifyWhen: 'Critério de qualificação',
  aiBusinessHours: 'Horário de atendimento (texto)',
  aiAfterHoursMsg: 'Mensagem fora do horário',
  aiBusinessHoursStart: 'Início do horário comercial',
  aiBusinessHoursEnd: 'Fim do horário comercial',
  aiBusinessHoursDays: 'Dias da semana (ISO)',
  ai24x7: 'IA 24/7',
  aiAutoReplyWindowSeconds: 'Janela de auto-reply (segundos)',
  pendingReplyAlertMin: 'Alertar quando o cliente esperar (minutos)',
  pendingReplyEscalateMin: 'Escalar para o gestor após (minutos)',
};

const EMPTY: FormState = {
  aiEnabled: false,
  aiAgentName: '',
  aiBusinessName: '',
  aiBusinessDesc: '',
  aiProducts: '',
  aiTargetAudience: '',
  aiTone: '',
  aiObjective: '',
  aiDontTalk: '',
  aiAlwaysAsk: '',
  aiQualifyWhen: '',
  aiBusinessHours: '',
  aiAfterHoursMsg: '',
  aiBusinessHoursStart: 8,
  aiBusinessHoursEnd: 18,
  aiBusinessHoursDays: '1,2,3,4,5',
  ai24x7: false,
  aiAutoReplyWindowSeconds: 15,
  pendingReplyAlertMin: 60,
  pendingReplyEscalateMin: 180,
};

export default function AiTab() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [testMsg, setTestMsg] = useState('');
  const [testResult, setTestResult] = useState<TestPromptResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getOrgSettings()
      .then((s) => {
        setForm({
          aiEnabled: s.aiEnabled,
          aiAgentName: s.aiAgentName,
          aiBusinessName: s.aiBusinessName,
          aiBusinessDesc: s.aiBusinessDesc,
          aiProducts: s.aiProducts,
          aiTargetAudience: s.aiTargetAudience,
          aiTone: s.aiTone,
          aiObjective: s.aiObjective,
          aiDontTalk: s.aiDontTalk,
          aiAlwaysAsk: s.aiAlwaysAsk,
          aiQualifyWhen: s.aiQualifyWhen,
          aiBusinessHours: s.aiBusinessHours,
          aiAfterHoursMsg: s.aiAfterHoursMsg,
          aiBusinessHoursStart: s.aiBusinessHoursStart,
          aiBusinessHoursEnd: s.aiBusinessHoursEnd,
          aiBusinessHoursDays: s.aiBusinessHoursDays,
          ai24x7: s.ai24x7,
          aiAutoReplyWindowSeconds: s.aiAutoReplyWindowSeconds,
          pendingReplyAlertMin: s.pendingReplyAlertMin,
          pendingReplyEscalateMin: s.pendingReplyEscalateMin,
        });
        setLoaded(true);
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Erro ao carregar'));
  }, []);

  async function onTest() {
    if (!testMsg.trim()) {
      toast.error('Digite uma mensagem de teste.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testAiPrompt(testMsg);
      setTestResult(r);
    } catch (e: unknown) {
      // ApiError carrega body com {error, detail, hint} — mostra os tres em toast.
      const body = (e as { body?: { error?: string; detail?: string; hint?: string } } | undefined)?.body;
      const msg = body?.detail
        ? `${body.error ?? 'Erro'} — ${body.detail}${body.hint ? `\n${body.hint}` : ''}`
        : e instanceof Error ? e.message : 'Erro ao testar prompt';
      toast.error(msg, { duration: 10_000 });
    } finally {
      setTesting(false);
    }
  }

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: UpdateOrgSettingsInput = { ...form };
      await updateOrgSettings(payload);
      toast.success('Configuração da IA salva.');
    } catch (e: unknown) {
      // ApiError tras body.issues quando eh Zod validation -- mostra o campo
      // que falhou no toast em vez de "Validation error" generico.
      const body = (e as { body?: { error?: string; issues?: Array<{ path: (string | number)[]; message: string }> } } | undefined)?.body;
      const issues = body?.issues;
      if (issues && issues.length > 0) {
        const msg = issues.slice(0, 3).map((iss) => {
          const field = iss.path.join('.') || 'campo';
          return `${FIELD_LABELS[field] ?? field}: ${iss.message}`;
        }).join('\n');
        toast.error(msg, { duration: 8_000 });
      } else {
        toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
      }
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="p-4 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <form onSubmit={onSave} className="max-w-3xl mx-auto space-y-6 overflow-y-auto h-full pb-6 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5" /> IA de Atendimento
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            A IA responde automaticamente as conversas que entram na fila <strong>IA</strong>.
            Quando ela qualifica o lead, a conversa é movida pra fila <strong>Comercial</strong>
            e o lead vai pro estágio <strong>Qualificado</strong>.
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-border p-3">
          <input
            type="checkbox"
            checked={form.aiEnabled}
            onChange={(e) => patch('aiEnabled', e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">
            {form.aiEnabled ? 'IA Ativa' : 'IA Desligada'}
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm font-semibold border-b pb-2">Identidade do agente</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ai-agent-name">Nome do agente</Label>
            <Input id="ai-agent-name" value={form.aiAgentName} onChange={(e) => patch('aiAgentName', e.target.value)} />
            <p className="text-[11px] text-muted-foreground mt-1">Como a IA se apresenta ao cliente.</p>
          </div>
          <div>
            <Label htmlFor="ai-business-name">Nome da empresa</Label>
            <Input id="ai-business-name" value={form.aiBusinessName} onChange={(e) => patch('aiBusinessName', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm font-semibold border-b pb-2">Sobre o negócio</div>
        <div>
          <Label htmlFor="ai-desc">Descrição do negócio</Label>
          <Textarea id="ai-desc" rows={3} value={form.aiBusinessDesc} onChange={(e) => patch('aiBusinessDesc', e.target.value)}
            placeholder="Ex: Distribuidora de óleos lubrificantes para frotas de caminhões e ônibus em Caxias do Sul." />
        </div>
        <div>
          <Label htmlFor="ai-products">Produtos e serviços</Label>
          <Textarea id="ai-products" rows={3} value={form.aiProducts} onChange={(e) => patch('aiProducts', e.target.value)}
            placeholder="Ex: óleos sintéticos e minerais Mobil/Shell, lubrificantes industriais, atendimento técnico..." />
        </div>
        <div>
          <Label htmlFor="ai-audience">Público-alvo</Label>
          <Textarea id="ai-audience" rows={2} value={form.aiTargetAudience} onChange={(e) => patch('aiTargetAudience', e.target.value)}
            placeholder="Ex: oficinas de troca de óleo, transportadoras com frota própria, indústrias com maquinário pesado." />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ai-hours">Horário de atendimento</Label>
            <Input id="ai-hours" value={form.aiBusinessHours} onChange={(e) => patch('aiBusinessHours', e.target.value)}
              placeholder="Ex: Seg-Sex 8h-18h, Sáb 8h-12h" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm font-semibold border-b pb-2">Comportamento</div>
        <div>
          <Label htmlFor="ai-objective">Objetivo principal</Label>
          <Textarea id="ai-objective" rows={2} value={form.aiObjective} onChange={(e) => patch('aiObjective', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ai-tone">Tom de voz</Label>
          <Input id="ai-tone" value={form.aiTone} onChange={(e) => patch('aiTone', e.target.value)}
            placeholder="Ex: profissional e cordial / informal e amigável / consultivo e técnico" />
        </div>
        <div>
          <Label htmlFor="ai-dont">NÃO falar sobre</Label>
          <Textarea id="ai-dont" rows={2} value={form.aiDontTalk} onChange={(e) => patch('aiDontTalk', e.target.value)}
            placeholder="Ex: política, religião, descontos sem aprovação..." />
        </div>
        <div>
          <Label htmlFor="ai-ask">SEMPRE perguntar</Label>
          <Textarea id="ai-ask" rows={2} value={form.aiAlwaysAsk} onChange={(e) => patch('aiAlwaysAsk', e.target.value)}
            placeholder="Ex: nome da empresa, tamanho da frota, marca/modelo dos veículos..." />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm font-semibold border-b pb-2">Critério de qualificação</div>
        <div>
          <Label htmlFor="ai-qualify">Quando considerar o lead QUALIFICADO</Label>
          <Textarea id="ai-qualify" rows={3} value={form.aiQualifyWhen} onChange={(e) => patch('aiQualifyWhen', e.target.value)}
            placeholder="Ex: cliente pediu orçamento, demonstrou interesse claro de compra, ou solicitou agendamento de visita técnica" />
          <p className="text-[11px] text-muted-foreground mt-1">
            Quando esse critério bater, a IA marca a conversa como qualificada e move automaticamente
            pra fila Comercial.
          </p>
        </div>
        <div>
          <Label htmlFor="ai-autoreply">Ignorar respostas automáticas em menos de (segundos)</Label>
          <Input
            id="ai-autoreply"
            type="number"
            min={0}
            max={300}
            className="max-w-[140px]"
            value={form.aiAutoReplyWindowSeconds}
            onChange={(e) => patch('aiAutoReplyWindowSeconds', Number(e.target.value) || 0)}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Resposta que chega em menos desse tempo após o disparo é tratada como auto-responder:
            a IA responde, mas <strong>não</strong> passa a conversa pro Comercial — só passa quando
            vier uma resposta genuína (acima do limite). 0 desliga o filtro.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="pending-reply-alert-min">Alertar quando o cliente esperar (minutos)</Label>
            <Input
              id="pending-reply-alert-min"
              type="number"
              min={1}
              max={1440}
              className="max-w-[140px]"
              value={form.pendingReplyAlertMin}
              onChange={(e) => patch('pendingReplyAlertMin', Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label htmlFor="pending-reply-escalate-min">Escalar para o gestor após (minutos)</Label>
            <Input
              id="pending-reply-escalate-min"
              type="number"
              min={1}
              max={1440}
              className="max-w-[140px]"
              value={form.pendingReplyEscalateMin}
              onChange={(e) => patch('pendingReplyEscalateMin', Number(e.target.value) || 0)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground sm:col-span-2">
            Conta apenas horário comercial, configurado acima.
          </p>
        </div>
        <div>
          <Label htmlFor="ai-after-hours">Mensagem fora do horário (opcional)</Label>
          <Textarea id="ai-after-hours" rows={2} value={form.aiAfterHoursMsg} onChange={(e) => patch('aiAfterHoursMsg', e.target.value)}
            placeholder="Ex: Olá! Nosso atendimento está pausado, mas voltamos amanhã às 8h. Sua mensagem foi recebida." />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm font-semibold border-b pb-2 flex items-center justify-between">
          <span>Horário comercial da IA</span>
          <label className="flex items-center gap-2 text-xs font-normal cursor-pointer">
            <input type="checkbox" checked={form.ai24x7}
              onChange={(e) => patch('ai24x7', e.target.checked)} className="h-3.5 w-3.5" />
            IA roda 24/7 (ignora horário)
          </label>
        </div>
        {!form.ai24x7 && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="ai-bh-start">Início</Label>
                <Input id="ai-bh-start" type="number" min={0} max={23}
                  value={form.aiBusinessHoursStart}
                  onChange={(e) => patch('aiBusinessHoursStart', Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="ai-bh-end">Fim</Label>
                <Input id="ai-bh-end" type="number" min={1} max={24}
                  value={form.aiBusinessHoursEnd}
                  onChange={(e) => patch('aiBusinessHoursEnd', Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="ai-bh-days">Dias (ISO)</Label>
                <Input id="ai-bh-days" value={form.aiBusinessHoursDays}
                  onChange={(e) => patch('aiBusinessHoursDays', e.target.value)}
                  placeholder="1,2,3,4,5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Dias = ISO weekdays (1=seg, ..., 7=dom). Default <code>1,2,3,4,5</code> (seg-sex).
              Fora do horário a IA não responde — envia <em>mensagem fora do horário</em> (se configurada)
              e reprocessa no próximo dia útil.
            </p>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar configuração'}
        </Button>
      </div>

      <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-6 space-y-4">
        <div className="text-sm font-semibold border-b border-primary/20 pb-2 flex items-center gap-2">
          <FlaskConical className="h-4 w-4" /> Testar prompt
        </div>
        <p className="text-xs text-muted-foreground">
          Envia uma mensagem fictícia com a config salva acima. Não afeta conversas reais e os custos
          contam pro billing Gemini normal.
        </p>
        <div>
          <Label htmlFor="ai-test-msg">Mensagem do cliente (teste)</Label>
          <Textarea id="ai-test-msg" rows={3} value={testMsg}
            onChange={(e) => setTestMsg(e.target.value)}
            placeholder="Ex: Oi, quero saber sobre óleo pra frota de 8 caminhões" />
        </div>
        <Button type="button" variant="outline" onClick={onTest} disabled={testing || !testMsg.trim()}>
          {testing ? 'Enviando ao Gemini…' : 'Testar com essa mensagem'}
        </Button>
        {testResult && (
          <div className="space-y-3 mt-2 rounded-md border border-border bg-background p-4 text-xs">
            <div>
              <div className="font-semibold text-muted-foreground mb-1">Resposta da IA (limpa):</div>
              <div className="whitespace-pre-line">{testResult.cleanReply}</div>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px]">
              <span><strong>Decisão:</strong> {testResult.qualification ?? '(continua conversa)'}</span>
              <span><strong>Modelo:</strong> {testResult.model}</span>
              <span><strong>Latência:</strong> {testResult.latencyMs}ms</span>
              <span><strong>Tokens:</strong> {testResult.inputTokens} in / {testResult.outputTokens} out</span>
            </div>
            {testResult.summary && (
              <div>
                <div className="font-semibold text-muted-foreground mb-1">Resumo gerado pra handoff:</div>
                <div className="whitespace-pre-line bg-primary/5 p-2 rounded">{testResult.summary}</div>
              </div>
            )}
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">Ver resposta crua (com tags)</summary>
              <pre className="whitespace-pre-wrap mt-2 bg-muted/50 p-2 rounded">{testResult.rawReply}</pre>
            </details>
          </div>
        )}
      </div>
    </form>
  );
}
