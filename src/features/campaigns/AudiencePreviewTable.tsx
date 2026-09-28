import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, AlertCircle, ChevronLeft, ChevronRight, CheckSquare, Square, Search, X } from 'lucide-react';
import { useDryRun } from './api';
import type { AudienceFilters, CampaignDryRunResponse } from './types';
import { formatCnpj } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  filters: AudienceFilters;
  excluded: string[];
  onExcludedChange: (ids: string[]) => void;
}

const PAGE_SIZE = 50;
// Espera depois da última tecla antes de buscar — não dispara uma prévia por letra.
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Preview da audiencia da campanha — mostra elegiveis E bloqueados (cooldown
 * 24h ou ja em outra campanha ativa). Bloqueados aparecem com badge e
 * checkbox desabilitado.
 *
 * Features de selecao em lote (2026-05-22):
 *  - "Marcar todos elegiveis" / "Desmarcar todos elegiveis": opera em TODAS
 *    as paginas via response.eligibleIds (lista completa, capped em 10k).
 *  - "Marcar pagina" / "Desmarcar pagina" (so visivel quando ha multi-pagina):
 *    opera so nos elegiveis da pagina atual.
 *  - Pagination com Anterior / N de M / Proximo no rodape.
 *
 * Busca (2026-09-28): filtra a lista no servidor (nome sem acento/maiúscula,
 * ou trecho de telefone/CPF/CNPJ) antes da paginação. Marcar/desmarcar
 * página passa a valer pros resultados; os números do topo e "Marcar todos
 * elegíveis" continuam sendo da audiência inteira.
 */
export function AudiencePreviewTable({ open, onClose, filters, excluded, onExcludedChange }: Props) {
  const dryRun = useDryRun();
  const [data, setData] = useState<CampaignDryRunResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');

  // Filtros para o preview: NUNCA enviar excludeLeadIds, senão os leads
  // desmarcados somem da tabela e o usuário não consegue remarcá-los.
  // A exclusão é aplicada apenas no envio final / contagem do AudienceStep.
  const previewFilters: AudienceFilters = { ...filters, excludeLeadIds: undefined };
  const previewFiltersKey = JSON.stringify(previewFilters);

  // Resetar pagina e busca quando abrir ou filtros mudarem
  useEffect(() => {
    if (open) {
      setPage(1);
      setSearchInput('');
      setQ('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewFiltersKey]);

  // Busca nova começa da primeira página de resultados. q e página mudam juntos
  // (mesmo render) pra não disparar uma prévia na página antiga no meio.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === q) return;
    const t = setTimeout(() => { setQ(next); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, q]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    dryRun.mutate(
      { filters: previewFilters, page, pageSize: PAGE_SIZE, q: q || undefined },
      {
        onSuccess: (r) => { if (!cancelled) { setData(r); setLoading(false); } },
        onError: (e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Falha ao carregar audiência.');
          setData(null);
          setLoading(false);
        },
      },
    );
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewFiltersKey, page, q]);

  function toggle(id: string) {
    onExcludedChange(
      excluded.includes(id)
        ? excluded.filter((x) => x !== id)
        : [...excluded, id],
    );
  }

  function markAllEligible() {
    if (!data?.eligibleIds) return;
    // "Marcar todos" = remover TODOS os elegibleIds do excluded.
    const eligibleSet = new Set(data.eligibleIds);
    onExcludedChange(excluded.filter((id) => !eligibleSet.has(id)));
  }

  function unmarkAllEligible() {
    if (!data?.eligibleIds) return;
    // "Desmarcar todos" = adicionar TODOS os elegibleIds em excluded
    // (sem duplicar).
    const merged = new Set([...excluded, ...data.eligibleIds]);
    onExcludedChange(Array.from(merged));
  }

  function markPage() {
    if (!data) return;
    const pageEligibleIds = data.preview
      .filter((p) => p.blockReason == null && !p.isNew)
      .map((p) => p.leadId);
    const pageSet = new Set(pageEligibleIds);
    onExcludedChange(excluded.filter((id) => !pageSet.has(id)));
  }

  function unmarkPage() {
    if (!data) return;
    const pageEligibleIds = data.preview
      .filter((p) => p.blockReason == null && !p.isNew)
      .map((p) => p.leadId);
    const merged = new Set([...excluded, ...pageEligibleIds]);
    onExcludedChange(Array.from(merged));
  }

  const items = data?.preview ?? [];
  const totalBlocked = (data?.blocked.recentOutbound ?? 0) + (data?.blocked.pendingOtherCampaign ?? 0);
  const multipage = (data?.pageCount ?? 1) > 1;
  const searching = q.length > 0;
  // Com busca, marcar/desmarcar vale pros resultados — mesmo cabendo numa página.
  const showPageActions = multipage || searching;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Audiência</DialogTitle>
          {data && (
            <div className="text-xs text-muted-foreground mt-1">
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                {data.eligible} elegíveis
              </span>
              {totalBlocked > 0 && (
                <>
                  {' · '}
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {totalBlocked} bloqueados
                  </span>
                  {data.blocked.recentOutbound > 0 && ` (${data.blocked.recentOutbound} em cooldown 24h)`}
                  {data.blocked.pendingOtherCampaign > 0 && ` (${data.blocked.pendingOtherCampaign} em outra campanha)`}
                </>
              )}
              {searching && (
                <span className="ml-1">
                  · {data.matchCount} {data.matchCount === 1 ? 'resultado' : 'resultados'} para “{q}”
                </span>
              )}
              {multipage && (
                <span className="ml-1">· página {data.page} de {data.pageCount}</span>
              )}
            </div>
          )}
        </DialogHeader>

        {/* Toolbar de selecao em lote */}
        {data && data.eligible > 0 && (
          <div className="flex items-center gap-2 flex-wrap border-b border-border pb-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={markAllEligible}
              disabled={data.eligibleIds.length === 0}
              title={data.eligibleIds.length === 0 ? 'Audiência muito grande (>10k) — use por página' : undefined}
            >
              <CheckSquare className="h-3.5 w-3.5 mr-1" />
              Marcar todos elegíveis ({data.eligible})
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={unmarkAllEligible}
              disabled={data.eligibleIds.length === 0}
            >
              <Square className="h-3.5 w-3.5 mr-1" />
              Desmarcar todos
            </Button>

            {showPageActions && (
              <>
                <div className="h-5 w-px bg-border mx-1" aria-hidden="true" />
                <Button type="button" variant="ghost" size="sm" onClick={markPage}>
                  {searching && !multipage ? 'Marcar resultados' : 'Marcar página'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={unmarkPage}>
                  {searching && !multipage ? 'Desmarcar resultados' : 'Desmarcar página'}
                </Button>
              </>
            )}
          </div>
        )}

        {data && data.total > 0 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone ou CPF/CNPJ…"
              className="pl-8 pr-8 h-9 text-sm"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Buscar contato na audiência"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div className="max-h-[28rem] overflow-auto">
          {error && <div className="text-sm text-destructive p-3">{error}</div>}
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Incluir</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>CPF/CNPJ</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searching && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground text-center py-6">
                      Nenhum contato encontrado para “{q}”.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((l) => {
                  const blocked = l.blockReason != null;
                  // Leads novos (do CSV, ainda não criados) entram sempre — não
                  // dá pra excluir individualmente antes de existirem. Pra tirar
                  // um número, remova-o do CSV.
                  const checked = l.isNew || (!blocked && !excluded.includes(l.leadId));
                  return (
                    <TableRow key={l.leadId} className={blocked ? 'opacity-60' : ''}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blocked || l.isNew}
                          onChange={() => toggle(l.leadId)}
                          title={
                            l.isNew
                              ? 'Novo contato do CSV — será criado e incluído. Para remover, edite o CSV.'
                              : blocked
                                ? 'Bloqueado — não pode ser incluído'
                                : undefined
                          }
                        />
                      </TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{formatCnpj(l.cnpj)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.phone}</TableCell>
                      <TableCell>
                        {l.blockReason === 'recent_outbound' && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                            <Clock className="h-3 w-3" />
                            Cooldown 24h
                          </span>
                        )}
                        {l.blockReason === 'pending_other_campaign' && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                            <AlertCircle className="h-3 w-3" />
                            Em outra campanha
                          </span>
                        )}
                        {!l.blockReason && l.isNew && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30">
                            Novo (CSV)
                          </span>
                        )}
                        {!l.blockReason && !l.isNew && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                            Elegível
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          {multipage ? (
            <div className="flex items-center gap-2 text-xs">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </Button>
              <span className="tabular-nums text-muted-foreground">
                {page} / {data?.pageCount ?? 1}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={(data ? page >= data.pageCount : true) || loading}
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : <div />}
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
