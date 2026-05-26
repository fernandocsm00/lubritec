import { useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ValueInput } from './ValueInput';
import type { LeadQualityFeedback } from '@shared/types';

interface Props {
  open: boolean;
  onConfirm: (value: number, feedback: LeadQualityFeedback) => void;
  onCancel: () => void;
}

export function GanhoValueDialog({ open, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<LeadQualityFeedback | null>(null);

  const canConfirm = value != null && value > 0 && feedback != null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setValue(null); setFeedback(null); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar fechamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Valor da venda</Label>
            <ValueInput value={value} onChange={setValue} />
          </div>
          <div className="space-y-2">
            <Label>O lead estava qualificado?</Label>
            <p className="text-xs text-muted-foreground">
              Calibra a IA: ajuda a entender se ela está acertando.
            </p>
            <div className="flex gap-2">
              <Button
                variant={feedback === 'good' ? 'default' : 'outline'}
                onClick={() => setFeedback('good')}
                type="button"
                className="flex-1"
              >
                Sim, estava bom
              </Button>
              <Button
                variant={feedback === 'bad' ? 'destructive' : 'outline'}
                onClick={() => setFeedback('bad')}
                type="button"
                className="flex-1"
              >
                Não, mal qualificado
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            disabled={!canConfirm}
            onClick={() => value != null && feedback != null && onConfirm(value, feedback)}
          >
            Marcar como ganho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
