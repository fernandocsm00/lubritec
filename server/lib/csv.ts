// Geração de CSV para exportações da UI.
//
// Convenções deliberadas, escolhidas para o Excel em português:
//   - separador ';' (o pt-BR usa vírgula como decimal, então ',' junta tudo
//     numa coluna só);
//   - BOM UTF-8 no início (sem ele o Excel lê como ANSI e quebra acentos);
//   - CRLF entre linhas, como manda o RFC 4180.
//
// O export de leads rejeitados (src/features/leads/ImportCsvDialog.tsx) é mais
// antigo e usa vírgula sem BOM — não foi alterado por estar fora do escopo.

/** Byte Order Mark UTF-8. Exportado para os testes poderem asseverar sua presença. */
export const BOM = '﻿';

const SEP = ';';

export type CsvValue = string | number | null | undefined;

/** Envolve em aspas apenas quando o conteúdo exige. */
function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(SEP) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Monta o CSV completo, já com BOM. Sem linhas, devolve só o cabeçalho —
 * uma planilha vazia é resposta melhor que um arquivo vazio.
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escapeField).join(SEP)];
  for (const row of rows) lines.push(row.map(escapeField).join(SEP));
  return BOM + lines.join('\r\n');
}
