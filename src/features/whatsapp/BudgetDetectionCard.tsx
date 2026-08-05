import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  usePendingBudgetDetection,
  useConfirmBudgetDetection,
  useDismissBudgetDetection,
} from '@/features/inside-sales/api';
import { STAGE_LABELS } from '@/features/inside-sales/helpers';
import type { DealStage } from '@shared/types';

// Etapas anteriores a "proposta enviada". Só nelas faz sentido sugerir o avanço:
// mandar orçamento revisado durante a negociação não pode rebaixar o funil.
const STAGES_ANTES_DA_PROPOSTA: DealStage[] = ['lead_no_comercial'];
const STAGE_SUGERIDA: DealStage = 'proposta_enviada';

/**
 * Card de sugestao: a IA leu um total no print de orcamento que o vendedor
 * mandou. O valor e EDITAVEL antes de confirmar — sem isso, uma leitura errada
 * obrigaria a rejeitar valor e etapa juntos.
 */
export function BudgetDetectionCard({
  leadId,
  currentStage,
}: {
  leadId: string;
  currentStage: DealStage | null;
}) {
  const { data: detection } = usePendingBudgetDetection(leadId);
  const confirm = useConfirmBudgetDetection();
  const dismiss = useDismissBudgetDetection();
  const [draft, setDraft] = useState<string | null>(null);

  if (!detection) return null;

  // draft null = ainda não editado; mostra o valor detectado.
  const value = draft ?? String(detection.detectedValue);
  const parsed = Number(value.replace(',', '.'));
  const valido = Number.isFinite(parsed) && parsed > 0;

  const sugereEtapa = currentStage === null || STAGES_ANTES_DA_PROPOSTA.includes(currentStage);

  async function handleConfirm() {
    if (!valido) {
      toast.error('Valor inválido.');
      return;
    }
    try {
      await confirm.mutateAsync({
        id: detection!.id,
        value: parsed,
        stage: sugereEtapa ? STAGE_SUGERIDA : undefined,
      });
      setDraft(null);
      toast.success('Valor registrado no card.');
    } catch {
      toast.error('Falha ao confirmar.');
    }
  }

  async function handleDismiss() {
    try {
      await dismiss.mutateAsync(detection!.id);
      setDraft(null);
    } catch {
      toast.error('Falha ao dispensar.');
    }
  }

  const busy = confirm.isPending || dismiss.isPending;

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2">
      <p className="text-xs font-medium">Orçamento detectado</p>

      <label className="block text-[11px] text-muted-foreground">
        Valor
        <Input
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          inputMode="decimal"
          className="mt-0.5 h-8 text-sm"
        />
      </label>

      {sugereEtapa && (
        <p className="text-[11px] text-muted-foreground">
          Etapa: <span className="font-medium">{STAGE_LABELS[STAGE_SUGERIDA]}</span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleConfirm} disabled={busy || !valido}>
          Confirmar
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          Dispensar
        </button>
      </div>
    </div>
  );
}
