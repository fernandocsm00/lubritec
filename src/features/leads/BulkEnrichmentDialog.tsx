import { useEffect, useState } from 'react';
import { Search, AlertCircle, CheckCircle2, XCircle, Loader2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useBulkEnrichmentJob,
  useStartBulkEnrichment,
  useCancelBulkEnrichment,
  usePauseBulkEnrichment,
  useResumeBulkEnrichment,
} from './api';

export function BulkEnrichmentDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Polla 3s enquanto modal aberta. Quando fechada, polla 30s pra notificar conclusão.
  const { data, isLoading, refetch } = useBulkEnrichmentJob({
    enabled: true,
    pollMs: open ? 3_000 : 30_000,
  });
  const start = useStartBulkEnrichment();
  const cancel = useCancelBulkEnrichment();
  const pause = usePauseBulkEnrichment();
  const resume = useResumeBulkEnrichment();

  const job = data?.job ?? null;
  const isRunning = job && job.status === 'running';
  const isPaused = job && job.status === 'paused';
  const isActive = job && (job.status === 'running' || job.status === 'pending' || job.status === 'paused');

  // Notificação quando job que estava ativo agora terminou (apenas se modal estiver aberta).
  const [wasActive, setWasActive] = useState(false);
  useEffect(() => {
    if (isActive) {
      setWasActive(true);
    } else if (wasActive && job && job.status === 'completed') {
      toast.success(`Enriquecimento concluído. ${job.succeededCount} telefone${job.succeededCount === 1 ? '' : 's'} encontrado${job.succeededCount === 1 ? '' : 's'} de ${job.totalLeads}.`);
      setWasActive(false);
    } else if (wasActive && job && job.status === 'cancelled') {
      toast.info('Enriquecimento cancelado.');
      setWasActive(false);
    }
  }, [isActive, wasActive, job]);

  async function onStart() {
    try {
      await start.mutateAsync();
      toast.success('Enriquecimento iniciado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao iniciar');
    }
  }

  async function onCancel() {
    try {
      await cancel.mutateAsync();
      setConfirmCancelOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    }
  }

  async function onPause() {
    try {
      await pause.mutateAsync();
      toast.info('Job pausado. Você pode retomar quando quiser.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao pausar');
    }
  }

  async function onResume() {
    try {
      await resume.mutateAsync();
      toast.success('Job retomado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao retomar');
    }
  }

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">{trigger}</span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Enriquecer leads incompletos
            </DialogTitle>
            <DialogDescription>
              Consulta a BrasilAPI pra cada lead incompleto com CNPJ, busca o telefone
              cadastrado na Receita Federal, e atualiza o lead automaticamente quando
              encontra. Respeita o rate limit gratuito (~3 req/min) — vai levar tempo
              pra grandes lotes.
            </DialogDescription>
          </DialogHeader>

          {isLoading && !job && (
            <div className="text-center py-6 text-sm text-muted-foreground">Carregando…</div>
          )}

          {!isLoading && !job && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhum job de enriquecimento foi executado ainda.
              <br />
              Clique em "Iniciar enriquecimento" abaixo pra começar.
            </div>
          )}

          {job && (
            <div className="space-y-3">
              <StatusBadge status={job.status} />

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {job.processedCount.toLocaleString('pt-BR')} de {job.totalLeads.toLocaleString('pt-BR')} processados
                  </span>
                  <span className="font-mono">{job.pctComplete.toFixed(1)}%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${job.pctComplete}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat
                  Icon={CheckCircle2}
                  label="Encontrados"
                  value={job.succeededCount}
                  toneClass="text-emerald-600 dark:text-emerald-400"
                />
                <Stat
                  Icon={XCircle}
                  label="Sem telefone"
                  value={job.failedCount}
                  toneClass="text-amber-600 dark:text-amber-400"
                />
                <Stat
                  Icon={AlertCircle}
                  label="Pendentes"
                  value={job.pendingCount}
                  toneClass="text-muted-foreground"
                />
              </div>

              {isActive && job.estimatedRemainingMinutes != null && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Tempo estimado restante: <strong>~{job.estimatedRemainingMinutes} min</strong>
                  ({Math.ceil(job.estimatedRemainingMinutes / 60 * 10) / 10}h)
                </p>
              )}

              {job.lastError && (
                <div className="text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded p-2">
                  Último erro: <span className="font-mono">{job.lastError.slice(0, 200)}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-row gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <Loader2 className={`h-3.5 w-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <div className="flex gap-2">
              {isRunning && (
                <Button variant="outline" onClick={onPause} disabled={pause.isPending} className="gap-1.5">
                  <Pause className="h-3.5 w-3.5" /> Pausar
                </Button>
              )}
              {isPaused && (
                <Button onClick={onResume} disabled={resume.isPending} className="gap-1.5">
                  <Play className="h-3.5 w-3.5" /> Retomar
                </Button>
              )}
              {isActive && (
                <Button variant="outline" onClick={() => setConfirmCancelOpen(true)} disabled={cancel.isPending}>
                  Cancelar job
                </Button>
              )}
              {!isActive && (
                <Button onClick={onStart} disabled={start.isPending}>
                  {start.isPending ? 'Iniciando…' : 'Iniciar enriquecimento'}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setOpen(false)}>Fechar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar enriquecimento?</AlertDialogTitle>
            <AlertDialogDescription>
              Os leads já enriquecidos permanecerão atualizados. Os pendentes ficarão como estão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={onCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Cancelar job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; className: string }> = {
    running:   { label: '● EM EXECUÇÃO',  className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 animate-pulse' },
    paused:    { label: '⏸ PAUSADO',      className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    pending:   { label: '◌ AGUARDANDO',   className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    completed: { label: '✓ CONCLUÍDO',    className: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
    cancelled: { label: '× CANCELADO',    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  };
  const m = meta[status] ?? meta.pending;
  return (
    <div className={`inline-block px-3 py-1 rounded text-xs font-semibold ${m.className}`}>
      {m.label}
    </div>
  );
}

function Stat({ Icon, label, value, toneClass }: { Icon: typeof CheckCircle2; label: string; value: number; toneClass: string }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <Icon className={`h-4 w-4 mx-auto mb-1 ${toneClass}`} />
      <div className="font-mono font-semibold">{value.toLocaleString('pt-BR')}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
