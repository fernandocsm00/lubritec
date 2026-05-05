import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Zap, Pause, Play, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useContinuousCampaign,
  useUpsertContinuousCampaign,
  type DispatchWindow,
} from '@/features/campaigns/continuousApi';
import type { CampaignMessageVariant } from '@shared/types';

const PLACEHOLDER_HINT = 'Use {{nome}}, {{cnpj}}, {{telefone}} pra personalizar.';

const REASON_LABEL: Record<NonNullable<DispatchWindow['reason']>, string> = {
  weekend: 'Fora do dispatch (fim de semana)',
  before_start: 'Antes do horário de envio',
  after_end: 'Após o horário de envio',
  no_settings: 'Configurações não encontradas',
};

export default function ContinuousCampaignPage() {
  const { data, isLoading } = useContinuousCampaign();
  const upsert = useUpsertContinuousCampaign();

  const [name, setName] = useState('');
  const [singleBody, setSingleBody] = useState('');
  const [variants, setVariants] = useState<CampaignMessageVariant[]>([]);
  const [useVariants, setUseVariants] = useState(false);
  const [rate, setRate] = useState<number>(20);

  // Carrega valores iniciais quando a query resolver.
  useEffect(() => {
    if (!data) return;
    const c = data.campaign;
    if (c) {
      setName(c.name);
      setSingleBody(c.messageBody);
      setVariants(c.messageVariants ?? []);
      setUseVariants((c.messageVariants ?? []).length > 0);
      setRate(c.ratePerMinute);
    } else {
      setName('Disparo automático contínuo');
      setSingleBody('Olá {{nome}}! Aqui é da Lubritec — vimos que sua empresa pode se beneficiar dos nossos lubrificantes. Posso te enviar uma proposta?');
      setRate(20);
    }
  }, [data]);

  const campaign = data?.campaign ?? null;
  const window = data?.dispatchWindow;
  const isRunning = campaign?.status === 'running';

  function addVariant() {
    setVariants((vs) => [...vs, { name: `Variante ${vs.length + 1}`, body: '' }]);
  }

  function updateVariant(idx: number, patch: Partial<CampaignMessageVariant>) {
    setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }

  function removeVariant(idx: number) {
    setVariants((vs) => vs.filter((_, i) => i !== idx));
  }

  async function save(opts?: { newStatus?: 'running' | 'paused' }) {
    try {
      const payload = {
        name,
        ratePerMinute: rate,
        ...(opts?.newStatus ? { status: opts.newStatus } : {}),
        ...(useVariants
          ? { messageVariants: variants, messageBody: variants[0]?.body ?? '' }
          : { messageBody: singleBody, messageVariants: [] }),
      };
      await upsert.mutateAsync(payload);
      toast.success(opts?.newStatus === 'running' ? 'Disparo automático ATIVO.'
        : opts?.newStatus === 'paused' ? 'Disparo automático PAUSADO.'
        : 'Configuração salva.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-y-auto">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/campanhas"><ArrowLeft className="h-4 w-4 mr-1" /> Campanhas</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Zap className="h-5 w-5" /> Disparo automático
            </h1>
            <p className="text-sm text-muted-foreground">
              Quando um lead atinge a etapa <strong>Completo</strong>, ele entra automaticamente
              nessa campanha contínua e recebe a primeira mensagem dentro do horário comercial.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {campaign && isRunning && (
            <Button variant="outline" onClick={() => save({ newStatus: 'paused' })} disabled={upsert.isPending}>
              <Pause className="h-4 w-4 mr-1" /> Pausar
            </Button>
          )}
          {campaign && !isRunning && (
            <Button onClick={() => save({ newStatus: 'running' })} disabled={upsert.isPending}>
              <Play className="h-4 w-4 mr-1" /> Ativar
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-3xl w-full space-y-6">
        {/* Status + dispatch window */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs font-semibold ${isRunning
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                {isRunning ? '● ATIVO' : '○ PAUSADO'}
              </span>
              {window && (
                <span className={`px-2 py-1 rounded text-xs ${window.ok
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'}`}>
                  {window.ok
                    ? `🟢 Em horário (${window.startHour}h-${window.endHour}h)`
                    : `🟡 ${window.reason ? REASON_LABEL[window.reason] : 'fora da janela'}`}
                </span>
              )}
            </div>
            {campaign && (
              <div className="text-xs text-muted-foreground">
                Total enrolado: <strong>{campaign.enrolledTotal}</strong> · Pendentes: <strong>{campaign.pendingCount}</strong>
                · Enviadas: <strong>{campaign.sentCount}</strong> · Falhas: <strong>{campaign.failedCount}</strong>
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Configure o horário de envio em <Link to="/settings?tab=ai" className="underline">Configurações → IA de Atendimento</Link>
            (campos de "Janela de envio").
          </p>
        </div>

        {/* Mensagem */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="text-sm font-semibold">Mensagem do disparo</div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={useVariants}
                onChange={(e) => {
                  setUseVariants(e.target.checked);
                  if (e.target.checked && variants.length === 0) {
                    setVariants([{ name: 'Variante A', body: singleBody }]);
                  }
                }}
                className="h-4 w-4"
              />
              Testar variantes A/B
            </label>
          </div>

          {!useVariants ? (
            <div>
              <Label htmlFor="cont-body">Mensagem padrão</Label>
              <Textarea
                id="cont-body"
                rows={5}
                value={singleBody}
                onChange={(e) => setSingleBody(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">{PLACEHOLDER_HINT}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {variants.map((v, idx) => (
                <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={v.name ?? ''}
                      placeholder={`Variante ${String.fromCharCode(65 + idx)}`}
                      onChange={(e) => updateVariant(idx, { name: e.target.value })}
                      className="text-sm font-medium max-w-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeVariant(idx)}
                      disabled={variants.length === 1}
                      className="text-destructive ml-auto"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    rows={4}
                    value={v.body}
                    onChange={(e) => updateVariant(idx, { body: e.target.value })}
                    placeholder="Mensagem da variante…"
                  />
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addVariant} disabled={variants.length >= 10}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar variante
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {PLACEHOLDER_HINT} A escolha de variante é aleatória por destinatário.
              </p>
            </div>
          )}
        </div>

        {/* Variant stats (A/B) */}
        {campaign && campaign.variantStats.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-6 space-y-3">
            <div className="text-sm font-semibold border-b pb-2 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Performance por variante (A/B)
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-1.5 font-medium">Variante</th>
                  <th className="text-right py-1.5 font-medium">Enviadas</th>
                  <th className="text-right py-1.5 font-medium">Responderam</th>
                  <th className="text-right py-1.5 font-medium">Qualificadas</th>
                </tr>
              </thead>
              <tbody>
                {campaign.variantStats.map((v, i) => {
                  const isBest = i === 0
                    && campaign.variantStats.length > 1
                    && v.qualifyRate >= Math.max(...campaign.variantStats.map((x) => x.qualifyRate));
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 align-top">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{v.variantName ?? `Variante ${String.fromCharCode(65 + i)}`}</span>
                          {isBest && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded dark:bg-emerald-950/40 dark:text-emerald-300">★ MELHOR</span>}
                        </div>
                        <p className="text-muted-foreground text-[11px] mt-0.5 line-clamp-2 max-w-md">
                          {v.variantBody.length > 120 ? `${v.variantBody.slice(0, 120)}…` : v.variantBody}
                        </p>
                      </td>
                      <td className="text-right tabular-nums font-mono py-2 align-top">{v.sentCount}</td>
                      <td className="text-right tabular-nums font-mono py-2 align-top">
                        {v.repliedCount}
                        <span className="ml-1 text-[10px] text-muted-foreground">{v.replyRate.toFixed(1)}%</span>
                      </td>
                      <td className="text-right tabular-nums font-mono py-2 align-top">
                        {v.qualifiedCount}
                        <span className="ml-1 text-[10px] text-muted-foreground">{v.qualifyRate.toFixed(1)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground">
              Métricas baseadas nos disparos efetivamente enviados. "Responderam" conta inbound após o envio. "Qualificadas" conta leads que viraram <code>qualified</code> ou <code>handed_off</code>.
            </p>
          </div>
        )}

        {/* Rate */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-3">
          <Label htmlFor="cont-rate">Velocidade de envio (mensagens por minuto)</Label>
          <Input
            id="cont-rate"
            type="number"
            min={1}
            max={120}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value) || 0)}
            className="max-w-[160px]"
          />
          <p className="text-[11px] text-muted-foreground">
            Padrão: 20/min. Limite muito alto pode ser bloqueado pelo WhatsApp.
          </p>
        </div>

        <div className="flex gap-2 sticky bottom-0 bg-background py-3 border-t border-border">
          <Button onClick={() => save()} disabled={upsert.isPending}>
            {upsert.isPending ? 'Salvando…' : 'Salvar configuração'}
          </Button>
        </div>
      </div>
    </div>
  );
}
