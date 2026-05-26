import { useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { LeadQualityFeedback } from '@shared/types';

interface Props {
  open: boolean;
  onConfirm: (reason: string, quality: LeadQualityFeedback) => void;
  onCancel: () => void;
}

export function CloseNoDealDialog({ open, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [quality, setQuality] = useState<LeadQualityFeedback | null>(null);
  const canConfirm = reason.trim().length >= 3 && quality != null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(''); setQuality(null); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar lead sem virar deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Motivo do encerramento</Label>
            <Textarea
              placeholder="Ex.: cliente respondeu mas sumiu, sem interesse real, número errado..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>O lead estava qualificado?</Label>
            <p className="text-xs text-muted-foreground">
              Calibra a IA. Importante mesmo quando não vira deal.
            </p>
            <div className="flex gap-2">
              <Button
                variant={quality === 'good' ? 'default' : 'outline'}
                onClick={() => setQuality('good')}
                type="button"
                className="flex-1"
              >
                Sim, estava bom
              </Button>
              <Button
                variant={quality === 'bad' ? 'destructive' : 'outline'}
                onClick={() => setQuality('bad')}
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
            onClick={() => quality && onConfirm(reason.trim(), quality)}
          >
            Encerrar lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
