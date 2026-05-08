import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useCampaigns, type ListFilters } from './api';
import { StatusBadge } from './StatusBadge';
import { formatDateTime, formatPercent } from './helpers';

interface Props { filters: ListFilters }

export function CampaignList({ filters }: Props) {
  const { data, isLoading } = useCampaigns(filters);

  if (isLoading) {
    return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  if (!data?.items.length) {
    return <div className="text-sm text-muted-foreground p-8 text-center">Nenhuma campanha ainda. Clique em "Nova campanha" pra começar.</div>;
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Audiência</TableHead>
            <TableHead className="text-right">Enviadas</TableHead>
            <TableHead>Criada por</TableHead>
            <TableHead>Em</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((c) => (
            <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30">
              <TableCell>
                <Link to={`/campanhas/${c.id}`} className="font-medium text-primary hover:underline">
                  {c.name}
                </Link>
                {c.description && <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>}
              </TableCell>
              <TableCell><StatusBadge status={c.status} /></TableCell>
              <TableCell className="text-right">{c.audienceTotal}</TableCell>
              <TableCell className="text-right text-sm">
                {c.sentCount} <span className="text-muted-foreground">({formatPercent(c.sentCount, c.audienceTotal)})</span>
                {c.skippedByCooldown > 0 && (
                  <div className="flex items-center justify-end gap-1 text-[11px] text-lc-amber mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{c.skippedByCooldown} por cooldown 24h</span>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">{c.createdBy.name}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{formatDateTime(c.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
