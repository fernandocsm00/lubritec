import { useRef, useState } from 'react';
import { Upload, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useImportAudience, useEnrichAudience } from './api';
import { useBulkEnrichmentJob } from '@/features/leads/api';
import type { CampaignAudienceImportResult } from '@shared/types';

interface Props {
  /** Emite a audiência atual: leads importados + os excluídos (dedup). */
  onChange: (importedLeadIds: string[], excludeLeadIds: string[]) => void;
}

export function AudienceCsvImport({ onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const importMut = useImportAudience();
  const enrichMut = useEnrichAudience();
  const [result, setResult] = useState<CampaignAudienceImportResult | null>(null);
  const [excludeDups, setExcludeDups] = useState(false);
  const [enriching, setEnriching] = useState(false);

  // Polling do job de enriquecimento enquanto habilitado (3s aberto).
  const { data: jobData } = useBulkEnrichmentJob({ enabled: enriching, pollMs: 3000 });
  const job = jobData?.job ?? null;

  const onFile = async (file: File) => {
    try {
      const res = await importMut.mutateAsync(file);
      setResult(res);
      setExcludeDups(false);
      onChange(res.importedLeadIds, []);
      toast.success(`Importados: ${res.report.inserted} novo(s), ${res.report.updated} atualizado(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar CSV.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleExclude = (next: boolean) => {
    setExcludeDups(next);
    if (!result) return;
    const excluded = next ? result.previouslyParticipated.map((p) => p.leadId) : [];
    onChange(result.importedLeadIds, excluded);
  };

  const startEnrich = async () => {
    if (!result?.importedLeadIds.length) return;
    try {
      await enrichMut.mutateAsync(result.importedLeadIds);
      setEnriching(true);
      toast.success('Enriquecimento iniciado. Vai preenchendo o Telefone 2 em segundo plano.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar enriquecimento.');
    }
  };

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={importMut.isPending}
        className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded text-sm hover:bg-muted/50 disabled:opacity-50"
      >
        {importMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {importMut.isPending ? 'Importando…' : 'Importar CSV (CNPJ obrigatório)'}
      </button>
      <p className="text-xs text-muted-foreground">
        Mesmo formato da aba Cadastros: colunas nome e cnpj obrigatórias; telefone, telefone2,
        cidade, uf, etc. opcionais. CSV ou XLSX.
      </p>

      {result && (
        <div className="space-y-3 border-t pt-3">
          {/* Relatório */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-emerald-500/15 text-emerald-700 px-2 py-1">Inseridos: {result.report.inserted}</span>
            <span className="rounded bg-sky-500/15 text-sky-700 px-2 py-1">Atualizados: {result.report.updated}</span>
            <span className="rounded bg-destructive/15 text-destructive px-2 py-1">Rejeitados: {result.report.rejected.length}</span>
            {result.duplicatesInFileCount > 0 && (
              <span className="rounded bg-amber-500/15 text-amber-700 px-2 py-1">
                {result.duplicatesInFileCount} CNPJ repetido(s) no arquivo (consolidados)
              </span>
            )}
            <span className="rounded bg-muted px-2 py-1">Clientes na audiência: {result.importedLeadIds.length}</span>
          </div>

          {result.report.rejected.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Ver {result.report.rejected.length} linha(s) rejeitada(s)</summary>
              <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                {result.report.rejected.map((r, i) => (
                  <li key={i} className="text-muted-foreground">
                    Linha {r.line}: <span className="font-mono">{r.cnpj || '—'}</span>
                    {r.name ? ` · ${r.name}` : ''} — {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Duplicados: já participaram de campanha anterior */}
          {result.previouslyParticipated.length > 0 && (
            <div className="border border-amber-300/50 bg-amber-50/50 rounded p-3 space-y-2">
              <div className="text-sm font-medium text-amber-800">
                {result.previouslyParticipated.length} cliente(s) já participaram de campanha anterior
              </div>
              <div className="max-h-40 overflow-y-auto text-xs">
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left font-medium">CNPJ</th><th className="text-left font-medium">Cliente</th><th className="text-left font-medium">Última campanha</th></tr>
                  </thead>
                  <tbody>
                    {result.previouslyParticipated.map((p) => (
                      <tr key={p.leadId}>
                        <td className="font-mono">{p.cnpj ?? '—'}</td>
                        <td>{p.name}</td>
                        <td>{p.lastCampaign ? `${p.lastCampaign.name} (${fmtDate(p.lastCampaign.participatedAt)})` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleExclude(false)}
                  className={`px-3 py-1 rounded text-xs border ${!excludeDups ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
                >
                  Manter todos na campanha
                </button>
                <button
                  type="button"
                  onClick={() => toggleExclude(true)}
                  className={`px-3 py-1 rounded text-xs border ${excludeDups ? 'bg-destructive text-destructive-foreground border-destructive' : 'border-border text-muted-foreground'}`}
                >
                  Excluir todos da campanha
                </button>
              </div>
            </div>
          )}

          {/* Enriquecimento */}
          <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" onClick={startEnrich} disabled={enrichMut.isPending}>
              {enrichMut.isPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Sparkles size={14} className="mr-1" />}
              Enriquecimento de dados
            </Button>
            <p className="text-xs text-muted-foreground">
              Busca telefone na BrasilAPI e preenche o <strong>Telefone 2</strong> dos clientes (em segundo plano; ~3/min).
            </p>
            {enriching && job && (
              <div className="text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span>{job.status === 'completed' ? 'Enriquecimento concluído' : 'Enriquecendo…'} ({job.processedCount}/{job.totalLeads})</span>
                  <span className="text-emerald-700">{job.succeededCount} encontrado(s)</span>
                </div>
                <div className="h-1.5 bg-muted rounded overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${job.pctComplete}%` }} />
                </div>
                {(job.recentlyFound ?? []).length > 0 && (
                  <ul className="max-h-32 overflow-y-auto mt-1 space-y-0.5">
                    {job.recentlyFound!.map((f) => (
                      <li key={f.leadId} className="text-muted-foreground">
                        novo Tel 2: <strong>{f.name}</strong> → {f.phone2}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
