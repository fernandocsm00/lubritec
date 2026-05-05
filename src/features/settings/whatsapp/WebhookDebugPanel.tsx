import { useState } from 'react';
import { Bug, RefreshCw, Trash2, Copy, Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWebhookDebugEvents, useClearWebhookDebugEvents, useProbeWebhook } from './api';

const RESULT_BADGE: Record<string, string> = {
  inserted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  duplicate: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  ignored: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  extracted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  not_a_message: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  auth_failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  no_secret_configured: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  non_object_body: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export function WebhookDebugPanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data, isLoading, refetch } = useWebhookDebugEvents({ enabled: open });
  const clear = useClearWebhookDebugEvents();
  const probe = useProbeWebhook();
  const events = data?.events ?? [];

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(events, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sem clipboard — ignora
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Diagnóstico do webhook</span>
          {open && events.length > 0 && (
            <span className="text-xs text-muted-foreground">({events.length} evento{events.length === 1 ? '' : 's'})</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{open ? 'Recolher' : 'Expandir'}</span>
      </button>

      {open && (
        <div className="border-t border-border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground max-w-xl">
              Mostra os últimos webhooks recebidos da UazAPI (com headers, payload e resultado do parse).
              Atualiza automaticamente. Buffer em memória — reseta ao reiniciar o servidor.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                disabled={isLoading}
                className="gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={copyAll}
                disabled={events.length === 0}
                className="gap-1.5"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copiado' : 'Copiar tudo'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => clear.mutate()}
                disabled={events.length === 0 || clear.isPending}
                className="gap-1.5 text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Limpar
              </Button>
            </div>
          </div>

          {events.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground space-y-3">
              <div>
                Nenhum webhook recebido ainda.
                <br />
                Mande uma mensagem de teste pro WhatsApp conectado e aguarde alguns segundos.
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => probe.mutate()}
                disabled={probe.isPending}
                className="gap-1.5"
              >
                <Search className={`h-3.5 w-3.5 ${probe.isPending ? 'animate-pulse' : ''}`} />
                Inspecionar webhook na UazAPI
              </Button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {events.map((ev, i) => {
                const badge = RESULT_BADGE[ev.result.kind] ?? RESULT_BADGE.error;
                return (
                  <div key={`${ev.receivedAt}-${i}`} className="rounded-md border border-border bg-background p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-muted-foreground">{formatTime(ev.receivedAt)}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge}`}>
                          {ev.result.kind}
                        </span>
                      </div>
                      {ev.bodyKeys && (
                        <span className="text-xs text-muted-foreground">
                          campos: {ev.bodyKeys.join(', ')}
                        </span>
                      )}
                    </div>

                    {Object.keys(ev.result).length > 1 && (
                      <pre className="text-[11px] bg-muted/40 p-2 rounded overflow-x-auto">
                        {JSON.stringify(ev.result, null, 2)}
                      </pre>
                    )}

                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Headers
                      </summary>
                      <pre className="mt-1 bg-muted/40 p-2 rounded overflow-x-auto text-[11px]">
                        {JSON.stringify(ev.headers, null, 2)}
                      </pre>
                    </details>

                    <details className="text-xs" open>
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Body
                      </summary>
                      <pre className="mt-1 bg-muted/40 p-2 rounded overflow-x-auto text-[11px] max-h-64">
                        {JSON.stringify(ev.body, null, 2)}
                      </pre>
                    </details>
                  </div>
                );
              })}
            </div>
          )}

          {probe.isPending && (
            <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
              Consultando UazAPI… (pode levar até 40s, tentamos 5 paths)
            </div>
          )}

          {probe.isError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <div className="font-semibold mb-1">Falha ao consultar UazAPI</div>
              <pre className="bg-muted/40 p-2 rounded overflow-x-auto text-foreground">
                {probe.error instanceof Error ? probe.error.message : String(probe.error)}
              </pre>
            </div>
          )}

          {probe.data && (
            <div className="rounded-md border border-border bg-background p-3 space-y-2">
              <div className="text-xs font-semibold">Webhook cadastrado na UazAPI</div>
              <div className="text-[11px]">
                <div className="font-medium mb-1">O que NÓS achamos que está cadastrado (DB):</div>
                <pre className="bg-muted/40 p-2 rounded overflow-x-auto">
                  {JSON.stringify(probe.data.ours, null, 2)}
                </pre>
              </div>
              <div className="text-[11px]">
                <div className="font-medium mb-1 mt-2">O que a UazAPI responde (vários paths tentados):</div>
                <pre className="bg-muted/40 p-2 rounded overflow-x-auto max-h-96">
                  {JSON.stringify(probe.data.uazapi, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
