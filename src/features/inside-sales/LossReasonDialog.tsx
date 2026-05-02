import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LOSS_REASON_LABELS } from './helpers';
import { LOSS_REASONS } from '@shared/types';
import type { LossReason } from './types';

interface Props {
  open: boolean;
  onConfirm: (reason: LossReason) => void;
  onCancel: () => void;
}

export function LossReasonDialog({ open, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<LossReason | ''>('');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Por que você está perdendo este deal?</DialogTitle>
        </DialogHeader>
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
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!reason}
            onClick={() => reason && onConfirm(reason)}
          >
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
