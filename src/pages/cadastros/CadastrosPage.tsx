import { useEffect, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LeadFilters } from '@/features/leads/LeadFilters';
import { LeadsTable } from '@/features/leads/LeadsTable';
import { LeadDialog } from '@/features/leads/LeadDialog';
import { ImportCsvDialog } from '@/features/leads/ImportCsvDialog';
import { useLeads, type ListParams } from '@/features/leads/api';
import type { LeadStatus, LeadSource } from '@shared/types';

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function CadastrosPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<LeadStatus | 'all'>('all');
  const [source, setSource] = useState<LeadSource | 'all'>('all');
  const [pipeline, setPipeline] = useState<'yes' | 'no' | 'all'>('all');
  const [sort, setSort] = useState<NonNullable<ListParams['sort']>>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const debouncedQ = useDebounced(q, 300);

  const params: ListParams = {
    q: debouncedQ || undefined,
    status: status === 'all' ? undefined : status,
    source: source === 'all' ? undefined : source,
    pipeline: pipeline === 'all' ? undefined : pipeline,
    sort,
    order,
    page,
  };

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, source, pipeline]);

  const { data, isLoading } = useLeads(params);

  function toggleSort(key: NonNullable<ListParams['sort']>) {
    if (sort === key) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setOrder('asc');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cadastros</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Importar CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo lead
          </Button>
        </div>
      </div>

      <LeadFilters
        q={q}
        status={status}
        source={source}
        pipeline={pipeline}
        onQChange={setQ}
        onStatusChange={setStatus}
        onSourceChange={setSource}
        onPipelineChange={setPipeline}
      />

      <LeadsTable
        items={data?.items ?? []}
        loading={isLoading}
        sort={sort}
        order={order}
        onSortChange={toggleSort}
        page={data?.page ?? 1}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPage}
      />

      <LeadDialog lead={null} open={createOpen} onOpenChange={setCreateOpen} />
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
