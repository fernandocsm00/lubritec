import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { PublicLead, ImportReport, LeadStatus, LeadSource, LeadFlowStage } from '@shared/types';

export interface ListParams {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  flowStage?: LeadFlowStage;
  pipeline?: 'yes' | 'no';
  sort?: 'name' | 'created_at';
  order?: 'asc' | 'desc';
  page?: number;
}

export interface ListResult {
  items: PublicLead[];
  total: number;
  page: number;
  pageSize: number;
}

function buildQuery(p: ListParams): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useLeads(params: ListParams) {
  return useQuery({
    queryKey: ['leads', params],
    queryFn: () => api<ListResult>(`/leads${buildQuery(params)}`),
    staleTime: 30_000,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      phone?: string;
      cnpj: string;
      email?: string | null;
      notes?: string | null;
    }) => api<PublicLead>('/leads', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      email?: string | null;
      notes?: string | null;
      status?: LeadStatus;
      cnpj?: string;
      phone?: string;
    }) => {
      const { id, ...body } = input;
      return api<PublicLead>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/leads/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useImportLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<ImportReport>('/leads/import', { method: 'POST', body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export type EnrichmentStatus =
  | 'phone_found'
  | 'phone_not_in_brasilapi'
  | 'cnpj_not_found'
  | 'cnpj_inactive'
  | 'api_error';

export interface EnrichmentResult {
  status: EnrichmentStatus;
  lead?: PublicLead;
  phoneFound?: string;
  errorMessage?: string;
  source: 'brasilapi';
}

export function useEnrichLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<EnrichmentResult>(`/leads/${id}/enrich`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Bulk enrichment job (Sprint 6.1)
// ────────────────────────────────────────────────────────────────────────────

import type { PublicEnrichmentJob } from '@shared/types';

const BULK_KEY = ['leads', 'enrich-bulk'] as const;

export function useBulkEnrichmentJob(opts: { enabled: boolean; pollMs?: number }) {
  return useQuery({
    queryKey: BULK_KEY,
    queryFn: () => api<{ job: PublicEnrichmentJob | null }>('/leads/enrich-bulk'),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? (opts.pollMs ?? 3_000) : false,
  });
}

export function useStartBulkEnrichment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<PublicEnrichmentJob>('/leads/enrich-bulk', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BULK_KEY });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useCancelBulkEnrichment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ job: PublicEnrichmentJob | null }>('/leads/enrich-bulk/cancel', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BULK_KEY }),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Lead stage transitions (Sprint 6.3)
// ────────────────────────────────────────────────────────────────────────────

import type { PublicLeadStageTransition } from '@shared/types';

export function useMarkLeadLost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api<PublicLead>(`/leads/${id}/lost`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useLeadTransitions(leadId: string | null) {
  return useQuery({
    queryKey: ['lead', leadId, 'transitions'],
    queryFn: () => api<{ transitions: PublicLeadStageTransition[] }>(`/leads/${leadId}/transitions`),
    enabled: !!leadId,
    staleTime: 30_000,
  });
}
