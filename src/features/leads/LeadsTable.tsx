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
import type { PublicLead } from '@shared/types';
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
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : items.length === 0
                ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      Nenhum lead encontrado.
                    </TableCell>
                  </TableRow>
                )
                : items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="font-mono text-xs">{formatCnpj(l.cnpj)}</TableCell>
                    <TableCell>{l.phone}</TableCell>
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
