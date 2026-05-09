import { useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useRecipients } from './api';
import { formatDateTime, RECIPIENT_STATUS_LABELS, RECIPIENT_STATUS_TONES } from './helpers';
import type { CampaignRecipientStatus, CampaignStatus } from './types';

interface Props { campaignId: string; campaignStatus?: CampaignStatus }

function failureReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  if (reason === 'cooldown_24h') return 'Janela de 24h';
  return reason;
}

export function RecipientsTable({ campaignId, campaignStatus }: Props) {
  const [status, setStatus] = useState<CampaignRecipientStatus | undefined>();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useRecipients(campaignId, { status, page }, campaignStatus);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Destinatários ({data?.total ?? 0})</h3>
        <Select
          value={status ?? 'all'}
          onValueChange={(v) => { setStatus(v === 'all' ? undefined : v as CampaignRecipientStatus); setPage(1); }}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="sent">Enviados</SelectItem>
            <SelectItem value="failed">Falharam</SelectItem>
            <SelectItem value="skipped">Ignorados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enviada em</TableHead>
              <TableHead>Erro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              : data?.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.leadName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.phone}</TableCell>
                    <TableCell>
                      <span className={`inline-block uppercase text-[10px] tracking-wide px-2 py-0.5 rounded border ${RECIPIENT_STATUS_TONES[r.status]}`}>
                        {RECIPIENT_STATUS_LABELS[r.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDateTime(r.sentAt)}</TableCell>
                    <TableCell className="text-xs text-destructive truncate max-w-xs">{failureReasonLabel(r.failureReason)}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Próxima</Button>
          </div>
        </div>
      )}
    </div>
  );
}
