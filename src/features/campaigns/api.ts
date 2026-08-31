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
import type { PublicAuditSample, LeadQualityFeedback, CampaignCalibrationMetrics, CampaignAudienceImportResult, PublicEnrichmentJob } from '@shared/types';

export type ReportPeriod = 'today' | '7d' | 'month' | '30d' | 'quarter';
export type CampaignKind = 'all' | 'one_shot' | 'continuous';

/**
 * Recortes opcionais do relatório por atributos dos leads destinatários.
 * Quando nenhum é preenchido, o backend retorna metricas consolidadas (default).
 */
export interface ReportLeadFilters {
  imbp?: string;
  segment?: string;
  city?: string;
}

function appendLeadFilters(u: URLSearchParams, f?: ReportLeadFilters) {
  if (!f) return;
  if (f.imbp) u.set('imbp', f.imbp);
  if (f.segment) u.set('segment', f.segment);
  if (f.city) u.set('city', f.city);
}

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
  validity?: 'vigente' | 'expirada' | 'sem_vigencia';
  page?: number;
}

function buildListQuery(f: ListFilters): string {
  const u = new URLSearchParams();
  if (f.q) u.set('q', f.q);
  if (f.status) u.set('status', f.status);
  if (f.validity) u.set('validity', f.validity);
  if (f.page && f.page > 1) u.set('page', String(f.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useCampaignsAggregateStats(opts?: {
  period?: ReportPeriod;
  kind?: CampaignKind;
  compare?: boolean;
  filters?: ReportLeadFilters;
}) {
  const period = opts?.period ?? '30d';
  const kind = opts?.kind ?? 'all';
  const compare = opts?.compare ?? false;
  const filters = opts?.filters;
  const u = new URLSearchParams({ period, kind });
  if (compare) u.set('compare', 'true');
  appendLeadFilters(u, filters);
  const qs = u.toString();
  return useQuery({
    queryKey: ['campaigns', 'aggregate-stats', period, kind, compare, filters?.imbp, filters?.segment, filters?.city],
    queryFn: () => api<CampaignsAggregateStats>(`/campaigns/aggregate-stats?${qs}`),
    refetchInterval: 30_000,
  });
}

export function useCampaignsTimeseries(opts?: {
  period?: ReportPeriod;
  kind?: CampaignKind;
  filters?: ReportLeadFilters;
}) {
  const period = opts?.period ?? '30d';
  const kind = opts?.kind ?? 'all';
  const filters = opts?.filters;
  const u = new URLSearchParams({ period, kind });
  appendLeadFilters(u, filters);
  const qs = u.toString();
  return useQuery({
    queryKey: ['campaigns', 'timeseries', period, kind, filters?.imbp, filters?.segment, filters?.city],
    queryFn: () => api<CampaignsTimeseries>(`/campaigns/timeseries?${qs}`),
    refetchInterval: 60_000,
  });
}

export function useTopCampaigns(opts?: {
  period?: ReportPeriod;
  kind?: CampaignKind;
  limit?: number;
  filters?: ReportLeadFilters;
}) {
  const period = opts?.period ?? '30d';
  const kind = opts?.kind ?? 'all';
  const limit = opts?.limit ?? 5;
  const filters = opts?.filters;
  const u = new URLSearchParams({ period, kind, limit: String(limit) });
  appendLeadFilters(u, filters);
  const qs = u.toString();
  return useQuery({
    queryKey: ['campaigns', 'top', period, kind, limit, filters?.imbp, filters?.segment, filters?.city],
    queryFn: () => api<TopCampaignsResponse>(`/campaigns/top?${qs}`),
    refetchInterval: 60_000,
  });
}

export interface ReportCityOption {
  city: string;
  count: number;
}

export function useCampaignReportCities() {
  return useQuery({
    queryKey: ['campaigns', 'report-cities'],
    queryFn: () => api<{ items: ReportCityOption[] }>(`/campaigns/report-cities`),
    staleTime: 5 * 60_000,
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
  /** Vigência comercial. Omitido, o backend aplica 7 dias a partir do disparo. */
  validityStart?: string | null;
  validityEnd?: string | null;
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

/** Import da audiência por CNPJ (reusa o import de Cadastros). */
export function useImportAudience() {
  return useMutation({
    mutationFn: (file: File): Promise<CampaignAudienceImportResult> => {
      const fd = new FormData();
      fd.append('file', file);
      return api('/campaigns/audience/import', { method: 'POST', body: fd });
    },
  });
}

/** Dispara enriquecimento (Telefone 2) em background pros leads importados. */
export function useEnrichAudience() {
  return useMutation({
    mutationFn: (leadIds: string[]): Promise<PublicEnrichmentJob> =>
      api('/campaigns/audience/enrich', { method: 'POST', body: JSON.stringify({ leadIds }) }),
  });
}

// ── Audit queue APIs ──────────────────────────────────────────────────────────

export async function listAuditSamples(
  campaignId: string,
  opts: { mineOnly?: boolean } = {},
): Promise<PublicAuditSample[]> {
  const params = new URLSearchParams({ campaignId });
  if (opts.mineOnly) params.set('mineOnly', 'true');
  const res = await fetch(`/api/audit/samples?${params.toString()}`, { credentials: 'include' });
  const data = await res.json();
  return data.items;
}

export async function claimAuditSample(campaignId: string): Promise<PublicAuditSample | null> {
  const res = await fetch('/api/audit/samples/claim', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaignId }),
  });
  if (res.status === 204) return null;
  return res.json();
}

export async function recordAuditOutcome(input: {
  id: string; outcome: LeadQualityFeedback; notes?: string;
}): Promise<PublicAuditSample> {
  const res = await fetch(`/api/audit/samples/${input.id}/outcome`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome: input.outcome, notes: input.notes }),
  });
  return res.json();
}

// ── Calibration metrics API ───────────────────────────────────────────────────

export async function fetchCalibrationMetrics(campaignId: string): Promise<CampaignCalibrationMetrics> {
  return api<CampaignCalibrationMetrics>(`/campaigns/${campaignId}/calibration-metrics`);
}

// ── Unqualified leads API ─────────────────────────────────────────────────────

export interface UnqualifiedLead {
  leadId: string; leadName: string;
  leadPhone: string | null; leadCnpj: string | null;
  decidedAt: string; decisionReason: string | null;
  ageInDays: number; reattemptCount: number;
}

export async function listUnqualifiedLeads(campaignId: string): Promise<UnqualifiedLead[]> {
  const res = await fetch(`/api/campaigns/${campaignId}/unqualified-leads`, { credentials: 'include' });
  const data = await res.json();
  return data.items;
}
