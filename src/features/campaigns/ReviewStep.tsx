import { AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { CampaignHsmVariable } from './types';
import type { InstanceListItem, HsmTemplateRecord } from '@shared/types';

interface Props {
  scheduledAt: string | null;
  onScheduledAtChange: (v: string | null) => void;
  audienceTotal: number;
  name: string;
  messageBody: string;
  mediaUrl: string | null;
  // Instance / HSM
  selectedInstance?: InstanceListItem | null;
  hsmTemplate?: HsmTemplateRecord | null;
  hsmVariables?: CampaignHsmVariable[];
}

export function ReviewStep(p: Props) {
  const isMeta = p.selectedInstance?.provider === 'meta_cloud';

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="text-xs uppercase text-muted-foreground">Resumo</div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Nome</span>
          <span className="font-medium">{p.name || '(sem nome)'}</span>
        </div>
        {p.selectedInstance && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Linha</span>
            <span className="font-medium">
              {p.selectedInstance.displayName}{' '}
              <span className="text-xs text-zinc-500">
                ({p.selectedInstance.provider === 'uazapi' ? 'UazAPI' : 'Meta Cloud'})
              </span>
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Audiência</span>
          <span className="font-medium">{p.audienceTotal} lead(s)</span>
        </div>
        {!isMeta && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Mídia</span>
            <span className="font-medium">{p.mediaUrl ? 'Imagem anexada' : '—'}</span>
          </div>
        )}
        {isMeta && p.hsmTemplate ? (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Template HSM</span>
              <span className="font-medium font-mono">{p.hsmTemplate.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Idioma / Categoria</span>
              <span className="font-medium">{p.hsmTemplate.language} / {p.hsmTemplate.category}</span>
            </div>
            {p.hsmVariables && p.hsmVariables.length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Variáveis:</span>
                <div className="mt-1 space-y-1">
                  {p.hsmVariables.map((v) => (
                    <div key={v.index} className="flex gap-2 text-xs bg-muted/30 rounded px-2 py-1">
                      <span className="font-mono text-zinc-500">{`{{${v.index}}}`}</span>
                      <span className="text-zinc-400">→</span>
                      {v.source === 'lead_field' ? (
                        <span className="text-lc-navy font-medium">Campo: {v.value}</span>
                      ) : (
                        <span className="text-zinc-700">&quot;{v.value}&quot;</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : !isMeta ? (
          <div className="text-sm">
            <span className="text-muted-foreground">Mensagem:</span>
            <pre className="text-xs bg-muted/30 p-2 rounded mt-1 whitespace-pre-wrap">{p.messageBody}</pre>
          </div>
        ) : null}
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
