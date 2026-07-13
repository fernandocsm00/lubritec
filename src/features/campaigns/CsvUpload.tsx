import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onPhones: (phones: string[]) => void;
  current: string[];
}

/**
 * Quebra uma linha de CSV respeitando aspas (RFC 4180): campos entre aspas
 * podem conter o separador, e aspas duplas escapam ("" -> "). Sem isso, um
 * endereço tipo "RUA X, 35" quebraria o alinhamento das colunas.
 */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function CsvUpload({ onPhones, current }: Props) {
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (!aliveRef.current) return;
      // Strip UTF-8 BOM (Excel exports CSVs with one by default on Windows)
      const text = String(reader.result ?? '').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length === 0) {
        setError('Arquivo vazio.');
        return;
      }

      // Detecta o separador pela 1a linha: tab, ponto-e-vírgula ou vírgula.
      // Planilhas BR (Excel) exportam muito em ; ou tab, não em vírgula.
      const header = lines[0];
      const count = (ch: string) => header.split(ch).length - 1;
      const delimiter =
        count('\t') >= count(';') && count('\t') >= count(',') ? '\t'
        : count(';') >= count(',') ? ';'
        : ',';

      const headerCols = splitLine(header, delimiter);

      // Acha a coluna de telefone pelo cabeçalho. Reconhece TELEFONE1,
      // TELEFONE 1, CELULAR, WHATSAPP, etc. Preferimos o telefone PRIMÁRIO
      // (telefone1/telefone) sobre o secundário (telefone2).
      const norm = (h: string) => h.toLowerCase().replace(/[\s_]+/g, '');
      const isPhone = (n: string) => /^(telefone|celular|whatsapp|fone|phone)/.test(n) || n === 'tel' || n === 'contato';
      let phoneCol = headerCols.findIndex((h) => { const n = norm(h); return isPhone(n) && !n.endsWith('2'); });
      if (phoneCol < 0) phoneCol = headerCols.findIndex((h) => isPhone(norm(h))); // aceita telefone2 se não houver primário
      const hasHeader = phoneCol >= 0;

      let startIdx: number;
      if (hasHeader) {
        startIdx = 1;
      } else if (headerCols.length === 1) {
        // Arquivo simples: 1 telefone por linha, sem cabeçalho.
        phoneCol = 0;
        startIdx = 0;
      } else {
        setError('Não encontrei a coluna de telefone. Use um cabeçalho "telefone" (ou "telefone1"/"celular"/"whatsapp"), ou envie um arquivo com só os telefones.');
        return;
      }

      const phones: string[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const cols = splitLine(lines[i], delimiter);
        const raw = cols[phoneCol] ?? '';
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 8) phones.push(digits);
      }
      if (phones.length === 0) {
        setError('Nenhum telefone válido encontrado na coluna de telefone.');
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
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          const el = document.getElementById('csv-upload') as HTMLInputElement | null;
          if (el) { el.value = ''; el.click(); }
        }}
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
