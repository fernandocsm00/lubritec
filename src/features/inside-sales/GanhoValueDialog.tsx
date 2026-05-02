import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ValueInput } from './ValueInput';

interface Props {
  open: boolean;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

export function GanhoValueDialog({ open, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar fechamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Pra marcar como ganho precisamos do valor final fechado.
          </p>
          <Label>Valor da venda</Label>
          <ValueInput value={value} onChange={setValue} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            disabled={value == null || value <= 0}
            onClick={() => value != null && onConfirm(value)}
          >
            Marcar como ganho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
