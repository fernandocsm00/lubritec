import { useState } from 'react';
import { toast } from 'sonner';
import { Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useImportLeads } from './api';
import { translateError } from './translateError';
import type { ImportReport } from '@shared/types';

export function ImportCsvDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const importMut = useImportLeads();

  async function onUpload() {
    if (!file) return;
    try {
      const r = await importMut.mutateAsync(file);
      setReport(r);
      toast.success(`Import concluído: ${r.inserted} novos, ${r.updated} atualizados.`);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao importar.';
      toast.error(msg);
    }
  }

  function reset() {
    setFile(null);
    setReport(null);
  }

  function downloadRejected() {
    if (!report || report.rejected.length === 0) return;
    const csv =
      'linha,motivo\n' +
      report.rejected.map((r) => `${r.line},"${r.reason.replace(/"/g, '""')}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads-rejeitados.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar leads (CSV)</DialogTitle>
        </DialogHeader>

        {!report ? (
          <div className="space-y-3">
            <div className="rounded-md border-2 border-dashed p-6 text-center">
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm">{file.name}</span>
                  <Button variant="ghost" size="icon" onClick={() => setFile(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Arraste um arquivo .csv ou clique para selecionar
                  </p>
                  <input
                    id="csv-input"
                    type="file"
                    accept=".csv,text/csv,application/vnd.ms-excel"
                    className="sr-only"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <label htmlFor="csv-input">
                    <Button variant="outline" size="sm" className="mt-3" asChild>
                      <span>Selecionar arquivo</span>
                    </Button>
                  </label>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Colunas reconhecidas: nome/name, telefone/phone (obrigatórios), email, observacoes, placa, modelo, ultima_compra, km_dia. Tamanho máx: 5MB.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="Inseridos" value={report.inserted} variant="success" />
              <Stat label="Atualizados" value={report.updated} variant="info" />
              <Stat label="Pulados" value={report.skipped} variant="muted" />
              <Stat label="Rejeitados" value={report.rejected.length} variant="danger" />
            </div>
            {report.rejected.length > 0 && (
              <>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2 text-sm">
                  {report.rejected.map((r) => (
                    <div key={r.line} className="font-mono">
                      linha {r.line}: {r.reason}
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={downloadRejected}>
                  Baixar rejeitados (CSV)
                </Button>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {!report ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMut.isPending}>
                Cancelar
              </Button>
              <Button onClick={onUpload} disabled={!file || importMut.isPending}>
                {importMut.isPending ? 'Importando…' : 'Importar'}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: 'success' | 'info' | 'muted' | 'danger';
}) {
  const color = {
    success: 'text-green-600',
    info: 'text-blue-600',
    muted: 'text-muted-foreground',
    danger: 'text-red-600',
  }[variant];
  return (
    <div className="rounded-md border p-3">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
