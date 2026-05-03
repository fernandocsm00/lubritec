import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
}

export function NameStep({ name, onNameChange, description, onDescriptionChange }: Props) {
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Label>Nome da campanha *</Label>
        <Input
          placeholder="Ex: Lembrete troca de óleo - outubro"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={120}
        />
      </div>
      <div>
        <Label>Descrição (opcional)</Label>
        <Textarea
          placeholder="Anote o objetivo dessa campanha…"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={500}
          rows={3}
        />
      </div>
    </div>
  );
}
