import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { Plus, Zap, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { CampaignList } from '@/features/campaigns/CampaignList';
import { CampaignsReportBar } from '@/features/campaigns/CampaignsReportBar';
import { ExportCsvButton } from '@/features/campaigns/ExportCsvButton';
import { CampaignReportFilters } from '@/features/campaigns/CampaignReportFilters';
import type { ReportLeadFilters } from '@/features/campaigns/api';
import { CAMPAIGN_STATUSES } from '@shared/types';
import type { CampaignStatus } from '@/features/campaigns/types';
import { CAMPAIGN_STATUS_LABELS } from '@/features/campaigns/helpers';

export default function CampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const rawValidity = searchParams.get('validity');
  const validity = rawValidity === 'vigente' || rawValidity === 'expirada' || rawValidity === 'sem_vigencia'
    ? rawValidity : undefined;
  const rawStatus = searchParams.get('status');
  const status: CampaignStatus | undefined =
    rawStatus && (CAMPAIGN_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as CampaignStatus)
      : undefined;
  const [searchInput, setSearchInput] = useState(q);
  // Filtros por atributos do lead destinatário — só afetam a barra agregada
  // (CampaignsReportBar). A lista de campanhas em si não filtra por isso porque
  // campanhas não têm IMBP/Segmento próprios.
  const [leadFilters, setLeadFilters] = useState<ReportLeadFilters>({});

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  // O CSV exporta o mesmo recorte que está na tela, não a base inteira.
  const exportQs = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(validity ? { validity } : {}),
  }).toString();

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="flex justify-between items-center mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">Disparo em massa de mensagens WhatsApp</p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton

            path={`/campaigns/export.csv${exportQs ? `?${exportQs}` : ''}`}

            filename="campanhas.csv"

          />
          <Button variant="outline" asChild>
            <Link to="/campanhas/relatorio"><BarChart3 className="h-4 w-4 mr-1" /> Ver relatório</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/campanhas/automatico"><Zap className="h-4 w-4 mr-1" /> Disparo automático</Link>
          </Button>
          <Button asChild>
            <Link to="/campanhas/nova"><Plus className="h-4 w-4 mr-1" /> Nova campanha</Link>
          </Button>
        </div>
      </div>

      <div className="mb-3">
        <CampaignReportFilters value={leadFilters} onChange={setLeadFilters} />
        <div className="flex flex-wrap gap-1.5 mt-2 items-center">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Vigência:</span>
          {([['', 'Todas'], ['vigente', 'Vigentes'], ['expirada', 'Expiradas'], ['sem_vigencia', 'Sem vigência']] as const).map(([key, label]) => (
            <button
              key={key || 'all'}
              type="button"
              onClick={() => patch({ validity: key || null })}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                (validity ?? '') === key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <CampaignsReportBar filters={leadFilters} />

      <div className="flex gap-2 mb-4 flex-wrap">
        <Input
          placeholder="Buscar nome…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={() => patch({ q: searchInput || null })}
          onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          className="max-w-sm h-9 text-sm"
        />
        <Select value={status ?? 'all'} onValueChange={(v) => patch({ status: v === 'all' ? null : v })}>
          <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {CAMPAIGN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{CAMPAIGN_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        <CampaignList filters={{ q: q || undefined, status, validity }} />
      </div>
    </div>
  );
}
