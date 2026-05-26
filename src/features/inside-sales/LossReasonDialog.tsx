import { useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LOSS_REASON_LABELS } from './helpers';
import { LOSS_REASONS } from '@shared/types';
import type { LossReason, LeadQualityFeedback } from '@shared/types';

interface Props {
  open: boolean;
  onConfirm: (reason: LossReason, feedback: LeadQualityFeedback) => void;
  onCancel: () => void;
}

export function LossReasonDialog({ open, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<LossReason | ''>('');
  const [feedback, setFeedback] = useState<LeadQualityFeedback | null>(null);
  const canConfirm = !!reason && feedback != null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); setFeedback(null); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Por que você está perdendo este deal?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as LossReason)}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {LOSS_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{LOSS_REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>O lead estava qualificado?</Label>
            <p className="text-xs text-muted-foreground">
              Calibra a IA: ajuda a entender se ela está mandando lead bom mesmo que perca.
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
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => reason && feedback && onConfirm(reason, feedback)}
          >
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
