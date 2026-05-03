import { AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface Props {
  scheduledAt: string | null;
  onScheduledAtChange: (v: string | null) => void;
  audienceTotal: number;
  name: string;
  messageBody: string;
  mediaUrl: string | null;
}

export function ReviewStep(p: Props) {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="text-xs uppercase text-muted-foreground">Resumo</div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Nome</span>
          <span className="font-medium">{p.name || '(sem nome)'}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Audiência</span>
          <span className="font-medium">{p.audienceTotal} lead(s)</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Mídia</span>
          <span className="font-medium">{p.mediaUrl ? 'Imagem anexada' : '—'}</span>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Mensagem:</span>
          <pre className="text-xs bg-muted/30 p-2 rounded mt-1 whitespace-pre-wrap">{p.messageBody}</pre>
        </div>
      </div>

      <div>
        <Label>Quando disparar?</Label>
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="radio"
              id="now"
              name="schedule"
              checked={p.scheduledAt === null}
              onChange={() => p.onScheduledAtChange(null)}
            />
            <label htmlFor="now" className="text-sm">Disparar agora</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="radio"
              id="scheduled"
              name="schedule"
              checked={p.scheduledAt !== null}
              onChange={() => p.onScheduledAtChange(new Date(Date.now() + 60 * 60 * 1000).toISOString())}
            />
            <label htmlFor="scheduled" className="text-sm">Agendar pra uma data</label>
          </div>
        </div>
        {p.scheduledAt !== null && (
          <Input
            type="datetime-local"
            value={p.scheduledAt.slice(0, 16)}
            onChange={(e) => {
              const v = e.target.value;
              if (v) p.onScheduledAtChange(new Date(v).toISOString());
            }}
            className="mt-2 max-w-xs"
          />
        )}
      </div>

      {p.audienceTotal > 50 && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <strong>Atenção:</strong> você vai disparar pra <strong>{p.audienceTotal}</strong> leads.
            Esta ação não pode ser desfeita por completo (é possível pausar/cancelar mid-execução, mas mensagens já enviadas não voltam).
          </div>
        </div>
      )}
    </div>
  );
}
