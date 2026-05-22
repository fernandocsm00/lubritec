import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { CampaignsReportBar } from '@/features/campaigns/CampaignsReportBar';
import { CampaignsTimeseriesChart } from '@/features/campaigns/CampaignsTimeseriesChart';
import { TopCampaignsTable } from '@/features/campaigns/TopCampaignsTable';
import { LossReasonsCard } from '@/features/campaigns/LossReasonsCard';
import {
  REPORT_PERIOD_LABELS,
  CAMPAIGN_KIND_LABELS,
  type ReportPeriod,
  type CampaignKind,
} from '@/features/campaigns/api';

const PERIODS: ReportPeriod[] = ['today', '7d', 'month', '30d', 'quarter'];
const KINDS: CampaignKind[] = ['all', 'one_shot', 'continuous'];

export default function CampaignsReportPage() {
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [kind, setKind] = useState<CampaignKind>('all');

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-auto">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/campanhas"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Relatório de campanhas
          </h1>
          <p className="text-sm text-muted-foreground">
            Visão consolidada com comparação contra o período anterior.
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
          <SelectTrigger className="w-[180px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p}>{REPORT_PERIOD_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => setKind(v as CampaignKind)}>
          <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>{CAMPAIGN_KIND_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <CampaignsReportBar period={period} kind={kind} compare />

      <div className="space-y-4">
        <CampaignsTimeseriesChart period={period} kind={kind} />

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <TopCampaignsTable period={period} kind={kind} limit={5} />
          </div>
          <div className="lg:col-span-1">
            <LossReasonsCard period={period} kind={kind} />
          </div>
        </div>
      </div>
    </div>
  );
}
