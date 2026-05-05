import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { PublicLead, LeadFlowStage } from '@shared/types';
import { formatCnpj } from '@/lib/utils';
import { LeadActions } from './LeadActions';

type SortKey = 'name' | 'created_at';

interface Props {
  items: PublicLead[];
  loading: boolean;
  sort: SortKey;
  order: 'asc' | 'desc';
  onSortChange: (sort: SortKey) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

const STATUS_LABEL: Record<PublicLead['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  frio: { label: 'Frio', variant: 'secondary' },
  morno: { label: 'Morno', variant: 'default' },
  quente: { label: 'Quente', variant: 'destructive' },
};

const SOURCE_LABEL: Record<PublicLead['source'], string> = {
  manual: 'Manual',
  csv: 'CSV',
  whatsapp: 'WhatsApp',
};

const STAGE_LABEL: Record<LeadFlowStage, { label: string; className: string }> = {
  incomplete: { label: 'Incompleto', className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
  complete:   { label: 'Completo',   className: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800' },
  dispatched: { label: 'Disparado',  className: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800' },
  engaged:    { label: 'Respondeu',  className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
  qualified:  { label: 'Qualificado', className: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800' },
  handed_off: { label: 'No comercial', className: 'bg-primary/10 text-primary border-primary/40' },
  lost:       { label: 'Perdido',    className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
};

function fmtDateTime(s: string): string {
  const d = new Date(s);
  return d.toLocaleDateString('pt-BR');
}

function SortHeader({
  label,
  myKey,
  sort,
  order,
  onClick,
}: {
  label: string;
  myKey: SortKey;
  sort: SortKey;
  order: 'asc' | 'desc';
  onClick: () => void;
}) {
  const Icon = sort !== myKey ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}

export function LeadsTable(props: Props) {
  const { items, loading, sort, order, onSortChange, page, pageSize, total, onPageChange } = props;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortHeader label="Nome" myKey="name" sort={sort} order={order} onClick={() => onSortChange('name')} />
              </TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>
                <SortHeader
                  label="Cadastro"
                  myKey="created_at"
                  sort={sort}
                  order={order}
                  onClick={() => onSortChange('created_at')}
                />
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : items.length === 0
                ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      Nenhum lead encontrado.
                    </TableCell>
                  </TableRow>
                )
                : items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="font-mono text-xs">{formatCnpj(l.cnpj)}</TableCell>
                    <TableCell className={l.phone ? '' : 'text-muted-foreground italic'}>
                      {l.phone ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STAGE_LABEL[l.flowStage].className}>
                        {STAGE_LABEL[l.flowStage].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_LABEL[l.status].variant}>{STATUS_LABEL[l.status].label}</Badge>
                    </TableCell>
                    <TableCell>
                      {l.hasDeal && (
                        <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                          ● No pipeline
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{SOURCE_LABEL[l.source]}</TableCell>
                    <TableCell>{fmtDateTime(l.createdAt)}</TableCell>
                    <TableCell><LeadActions lead={l} /></TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Total: {total.toLocaleString('pt-BR')} leads</span>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Anterior
          </Button>
          <span>Página {page} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
