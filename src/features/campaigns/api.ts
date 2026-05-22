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
} from './types';

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

export function useCampaignsAggregateStats() {
  return useQuery({
    queryKey: ['campaigns', 'aggregate-stats'],
    queryFn: () => api<CampaignsAggregateStats>('/campaigns/aggregate-stats'),
    refetchInterval: 30_000,
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

export function useDryRun() {
  return useMutation({
    mutationFn: (filters: AudienceFilters) =>
      api<CampaignDryRunResponse>('/campaigns/dry-run', {
        method: 'POST', body: JSON.stringify(filters),
      }),
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
