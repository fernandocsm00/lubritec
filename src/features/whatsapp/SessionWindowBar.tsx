import { useEffect, useState } from 'react';
import { Check, Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SendTemplateDialog } from './SendTemplateDialog';
import type { SessionWindowView } from './sessionWindow';

function quando(d: Date, now: Date): string {
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = (offset: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() + offset);
    return x.toDateString();
  };
  if (d.toDateString() === dia(0)) return `hoje às ${hora}`;
  if (d.toDateString() === dia(-1)) return `ontem às ${hora}`;
  if (d.toDateString() === dia(1)) return `amanhã às ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}

function falta(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

interface ClosedProps {
  conversationId: string;
  instanceId: string;
  view: Extract<SessionWindowView, { state: 'fechada' }>;
  now: Date;
}

/**
 * Ocupa o lugar do Composer quando a linha oficial está fora da janela de 24h.
 * Texto e mídia enviados assim a Meta aceita e recusa minutos depois (131047);
 * aqui o atendente vê o motivo antes e tem o único envio possível à mão.
 */
export function SessionWindowClosed({ conversationId, instanceId, view, now }: ClosedProps) {
  const [open, setOpen] = useState(false);

  // Troca de conversa fecha o diálogo — o template seria de outra thread.
  useEffect(() => setOpen(false), [conversationId]);

  return (
    <div className="border-t border-border bg-background px-3 py-2">
      {/* flex-wrap: em coluna estreita o botão desce pra linha de baixo em vez
          de espremer o texto. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
        <div className="flex items-start gap-2 flex-1 min-w-[16rem]">
          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Janela de 24h fechada</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {view.lastInboundAt
                ? `O cliente não manda mensagem desde ${quando(view.lastInboundAt, now)}.`
                : 'O cliente ainda não mandou mensagem por este número.'}
              {' '}Pelo número oficial só dá pra enviar template aprovado. O chat libera sozinho quando ele responder.
            </p>
            {view.templateSentAt && (
              <p className="text-xs text-foreground mt-1 flex items-center gap-1">
                <Check className="h-3.5 w-3.5 shrink-0" />
                Template enviado {quando(view.templateSentAt, now)}. Aguardando o cliente responder.
              </p>
            )}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={view.templateSentAt ? 'outline' : 'default'}
          onClick={() => setOpen(true)}
          className="shrink-0 ml-auto"
        >
          {view.templateSentAt ? 'Enviar outro template' : 'Enviar template'}
        </Button>
      </div>
      <SendTemplateDialog
        conversationId={conversationId}
        instanceId={instanceId}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

/** Aviso acima do Composer quando faltam poucas horas pra janela fechar. */
export function SessionWindowClosingHint({ closesAt, now }: { closesAt: Date; now: Date }) {
  return (
    <div className="border-t border-border bg-amber-500/10 px-4 py-1.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      A janela de 24h fecha {quando(closesAt, now)} (em {falta(closesAt.getTime() - now.getTime())}).
      Depois disso, só template até o cliente responder.
    </div>
  );
}
