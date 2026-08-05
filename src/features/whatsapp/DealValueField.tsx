import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePatchDeal } from '@/features/inside-sales/api';

/**
 * Valor do card, editavel direto da conversa. Existe independente da deteccao
 * por IA: cobre orcamento mandado por fora do sistema e e o que resolve os deals
 * sem valor hoje (57 nao-ganhos, 3 com valor em 05/08/2026).
 */
export function DealValueField({
  dealId,
  proposalValue,
}: {
  dealId: string;
  proposalValue: number | null;
}) {
  const patch = usePatchDeal();
  const [draft, setDraft] = useState(proposalValue == null ? '' : String(proposalValue));

  useEffect(() => {
    setDraft(proposalValue == null ? '' : String(proposalValue));
  }, [dealId, proposalValue]);

  const trimmed = draft.trim();
  const parsed = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
  const valido = parsed === null || (Number.isFinite(parsed) && parsed > 0);
  const mudou = parsed !== proposalValue;

  async function handleSave() {
    if (!valido) {
      toast.error('Valor inválido.');
      return;
    }
    try {
      await patch.mutateAsync({ id: dealId, proposalValue: parsed });
      toast.success('Valor atualizado.');
    } catch {
      toast.error('Falha ao salvar valor.');
    }
  }

  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted-foreground">Valor da proposta</label>
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="—"
          inputMode="decimal"
          disabled={patch.isPending}
          className="h-8 text-sm"
        />
        {mudou && (
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={handleSave}
            disabled={patch.isPending || !valido}
          >
            Salvar
          </Button>
        )}
      </div>
    </div>
  );
}
