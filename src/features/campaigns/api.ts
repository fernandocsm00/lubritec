import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type {
  AudienceFilters,
  CampaignDryRunResponse,
  PublicCampaign,
  PublicCampaignWithFunnel,
  PublicCampaignRecipient,
  CampaignStatus,
  CampaignRecipientStatus,
  CampaignsAggregateStats,
  CampaignsTimeseries,
  TopCampaignsResponse,
} from './types';

export type ReportPeriod = 'today' | '7d' | 'month' | '30d' | 'quarter';
export type CampaignKind = 'all' | 'one_shot' | 'continuous';

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  month: 'Mês corrente',
  '30d': 'Últimos 30 dias',
  quarter: 'Trimestre atual',
};

export const CAMPAIGN_KIND_LABELS: Record<CampaignKind, string> = {
  all: 'Todas',
  one_shot: 'Únicas',
  continuous: 'Contínua',
};

export interface ListResult {
  items: PublicCampaign[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListFilters {
  q?: string;
  status?: CampaignStatus;
  page?: number;
}

function buildListQuery(f: ListFilters): string {
  const u = new URLSearchParams();
  if (f.q) u.set('q', f.q);
  if (f.status) u.set('status', f.status);
  if (f.page && f.page > 1) u.set('page', String(f.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useCampaignsAggregateStats(opts?: {
  period?: ReportPeriod;
  kind?: CampaignKind;
  compare?: boolean;
}) {
  const period = opts?.period ?? '30d';
  const kind = opts?.kind ?? 'all';
  const compare = opts?.compare ?? false;
  const u = new URLSearchParams({ period, kind });
  if (compare) u.set('compare', 'true');
  const qs = u.toString();
  return useQuery({
    queryKey: ['campaigns', 'aggregate-stats', period, kind, compare],
    queryFn: () => api<CampaignsAggregateStats>(`/campaigns/aggregate-stats?${qs}`),
    refetchInterval: 30_000,
  });
}

export function useCampaignsTimeseries(opts?: { period?: ReportPeriod; kind?: CampaignKind }) {
  const period = opts?.period ?? '30d';
  const kind = opts?.kind ?? 'all';
  const qs = new URLSearchParams({ period, kind }).toString();
  return useQuery({
    queryKey: ['campaigns', 'timeseries', period, kind],
    queryFn: () => api<CampaignsTimeseries>(`/campaigns/timeseries?${qs}`),
    refetchInterval: 60_000,
  });
}

export function useTopCampaigns(opts?: { period?: ReportPeriod; kind?: CampaignKind; limit?: number }) {
  const period = opts?.period ?? '30d';
  const kind = opts?.kind ?? 'all';
  const limit = opts?.limit ?? 5;
  const qs = new URLSearchParams({ period, kind, limit: String(limit) }).toString();
  return useQuery({
    queryKey: ['campaigns', 'top', period, kind, limit],
    queryFn: () => api<TopCampaignsResponse>(`/campaigns/top?${qs}`),
    refetchInterval: 60_000,
  });
}

export function useCampaigns(filters: ListFilters) {
  return useQuery({
    queryKey: ['campaigns', filters],
    queryFn: () => api<ListResult>(`/campaigns${buildListQuery(filters)}`),
    refetchInterval: 30_000,
  });
}

export function useCampaign(id: string | null) {
  return useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: () => api<PublicCampaignWithFunnel>(`/campaigns/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'running' ? 5_000 : 30_000;
    },
  });
}

export interface DryRunArgs {
  filters: AudienceFilters;
  page?: number;
  pageSize?: number;
}

export function useDryRun() {
  return useMutation({
    mutationFn: (input: AudienceFilters | DryRunArgs) => {
      // Backwards compat: AudienceStep passa AudienceFilters direto. Componentes
      // novos (AudiencePreviewTable) passam {filters, page, pageSize}.
      const isWrapped = (v: unknown): v is DryRunArgs =>
        typeof v === 'object' && v !== null && 'filters' in v;
      const args: DryRunArgs = isWrapped(input)
        ? input
        : { filters: input };
      const qs = new URLSearchParams();
      if (args.page) qs.set('page', String(args.page));
      if (args.pageSize) qs.set('pageSize', String(args.pageSize));
      const url = qs.toString() ? `/campaigns/dry-run?${qs}` : '/campaigns/dry-run';
      return api<CampaignDryRunResponse>(url, {
        method: 'POST', body: JSON.stringify(args.filters),
      });
    },
  });
}

interface CreateInput {
  name: string;
  description?: string;
  instanceId: string;
  templateId?: string | null;
  hsmTemplateId?: string | null;
  hsmVariables?: Array<{ index: number; source: 'static' | 'lead_field'; value: string }>;
  messageBody?: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  audienceFilter: AudienceFilters;
  scheduledAt?: string | null;
  ratePerMinute?: number;
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['campaigns'] });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInput) =>
      api<PublicCampaign>('/campaigns', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDispatchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/dispatch`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function usePauseCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/pause`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useResumeCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/resume`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useCancelCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PublicCampaign>(`/campaigns/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}

export interface RecipientsResult {
  items: PublicCampaignRecipient[];
  total: number;
  page: number;
  pageSize: number;
}

export function useRecipients(
  id: string,
  filters: { status?: CampaignRecipientStatus; page?: number },
  campaignStatus?: CampaignStatus,
) {
  const u = new URLSearchParams();
  if (filters.status) u.set('status', filters.status);
  if (filters.page && filters.page > 1) u.set('page', String(filters.page));
  const qs = u.toString();
  // Stop polling once the campaign reaches a terminal state — saves 1 req/10s
  // for completed/cancelled campaigns left open in a tab.
  const isTerminal = campaignStatus === 'completed' || campaignStatus === 'cancelled';
  return useQuery({
    queryKey: ['campaigns', 'recipients', id, filters],
    queryFn: () => api<RecipientsResult>(`/campaigns/${id}/recipients${qs ? `?${qs}` : ''}`),
    enabled: !!id,
    refetchInterval: isTerminal ? false : 10_000,
  });
}

export function useUploadMedia() {
  return useMutation({
    mutationFn: async (file: File): Promise<{ mediaUrl: string; mediaMime: string }> => {
      const fd = new FormData();
      fd.append('file', file);
      return api('/campaigns/upload-media', { method: 'POST', body: fd });
    },
  });
}
