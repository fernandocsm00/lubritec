import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onPhones: (phones: string[]) => void;
  current: string[];
}

export function CsvUpload({ onPhones, current }: Props) {
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Aceita: 1 telefone por linha, OU coluna `phone` em CSV
      const phones: string[] = [];
      const header = lines[0]?.toLowerCase();
      const isHeaderCsv = header && header.includes('phone');
      const startIdx = isHeaderCsv ? 1 : 0;
      const phoneCol = isHeaderCsv
        ? header.split(',').findIndex((h) => h.trim() === 'phone')
        : 0;
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const raw = cols[phoneCol] ?? cols[0];
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 8) phones.push(digits);
      }
      if (phones.length === 0) {
        setError('Nenhum telefone válido encontrado no arquivo.');
        return;
      }
      onPhones(phones);
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept=".csv,.txt"
        id="csv-upload"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => document.getElementById('csv-upload')?.click()}
      >
        <Upload className="h-4 w-4 mr-2" /> Carregar CSV de telefones
      </Button>
      {current.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {current.length} telefone(s) carregado(s) <button onClick={() => onPhones([])} className="text-destructive underline ml-2">remover</button>
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
