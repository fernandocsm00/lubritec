import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiDownload } from '@/lib/apiClient';

interface Props {
  /** Caminho do endpoint, já com query string. Ex.: '/campaigns/export.csv?status=running' */
  path: string;
  /** Nome usado se a resposta não trouxer Content-Disposition. */
  filename: string;
  label?: string;
}

/**
 * Baixa um CSV de endpoint autenticado. O trabalho real está em apiDownload;
 * aqui ficam só o estado de carregamento e o erro visível — a exportação pode
 * demorar alguns segundos e um botão mudo pareceria travado.
 */
export function ExportCsvButton({ path, filename, label = 'Exportar CSV' }: Props) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await apiDownload(path, filename);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao exportar CSV.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy}>
      {busy
        ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        : <Download className="h-4 w-4 mr-1" />}
      {busy ? 'Exportando…' : label}
    </Button>
  );
}
