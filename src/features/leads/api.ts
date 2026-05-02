import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { PublicLead, ImportReport, LeadStatus, LeadSource } from '@shared/types';

export interface ListParams {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  pipeline?: 'yes' | 'no';
  sort?: 'name' | 'created_at' | 'last_purchase_date';
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
      phone: string;
      email?: string | null;
      notes?: string | null;
      vehiclePlate?: string | null;
      vehicleModel?: string | null;
      lastPurchaseDate?: string | null;
      avgMileagePerDay?: number | null;
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
      vehiclePlate?: string | null;
      vehicleModel?: string | null;
      lastPurchaseDate?: string | null;
      avgMileagePerDay?: number | null;
      status?: LeadStatus;
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
