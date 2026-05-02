import { Input } from '@/components/ui/input';
import { parseCurrencyInput } from './helpers';

interface Props {
  value: number | null;
  onChange: (n: number | null) => void;
  placeholder?: string;
  className?: string;
}

export function ValueInput({ value, onChange, placeholder, className }: Props) {
  const display = value == null ? '' : value.toLocaleString('pt-BR', { minimumFractionDigits: 0 });
  return (
    <Input
      value={display}
      placeholder={placeholder ?? 'R$ 0,00'}
      className={className}
      onChange={(e) => onChange(parseCurrencyInput(e.target.value))}
      inputMode="decimal"
    />
  );
}
