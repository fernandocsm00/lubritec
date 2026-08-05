import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type {
  BoardResponse,
  PublicDeal,
  PublicDealActivity,
  DealStage,
  LossReason,
} from './types';
import type { LeadQualityFeedback } from '@shared/types';

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export type OwnerFilter = 'mine' | 'all' | 'unassigned' | string; // string = UUID

export interface BoardFilters {
  owner?: OwnerFilter;
  q?: string;
  campaignIds?: string[];
}

function buildBoardQuery(f: BoardFilters): string {
  const u = new URLSearchParams();
  if (f.owner) u.set('owner', f.owner);
  if (f.q) u.set('q', f.q);
  if (f.campaignIds && f.campaignIds.length > 0) u.set('campaignIds', f.campaignIds.join(','));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useBoard(filters: BoardFilters) {
  return useQuery({
    queryKey: ['deals', 'board', filters],
    queryFn: () => api<BoardResponse>(`/deals${buildBoardQuery(filters)}`),
    // 15s (era 5s): kanban não precisa de near-real-time e o refetch durante
    // drag-and-drop causava re-render de todas as colunas.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryFilters {
  owner?: OwnerFilter;
  q?: string;
  stage?: 'ganho' | 'perdido';
  lossReason?: LossReason;
  from?: string;
  to?: string;
  page?: number;
}

export interface HistoryResult {
  items: PublicDeal[];
  total: number;
  page: number;
  pageSize: number;
}

function buildHistoryQuery(f: HistoryFilters): string {
  const u = new URLSearchParams();
  if (f.owner) u.set('owner', f.owner);
  if (f.q) u.set('q', f.q);
  if (f.stage) u.set('stage', f.stage);
  if (f.lossReason) u.set('lossReason', f.lossReason);
  if (f.from) u.set('from', f.from);
  if (f.to) u.set('to', f.to);
  if (f.page && f.page > 1) u.set('page', String(f.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useHistory(filters: HistoryFilters) {
  return useQuery({
    queryKey: ['deals', 'history', filters],
    queryFn: () => api<HistoryResult>(`/deals/history${buildHistoryQuery(filters)}`),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Deal detail
// ---------------------------------------------------------------------------

export interface DealDetail extends PublicDeal {
  activities: PublicDealActivity[];
}

export function useDeal(id: string | null) {
  return useQuery({
    queryKey: ['deals', 'detail', id],
    queryFn: () => api<DealDetail>(`/deals/${id}`),
    enabled: !!id,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export function useDealByLead(leadId: string | null) {
  return useQuery({
    queryKey: ['deals', 'by-lead', leadId],
    queryFn: () => api<PublicDeal | null>(`/deals/by-lead/${leadId}`),
    enabled: !!leadId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['deals'] });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadId: string; proposalValue?: number }) =>
      api<PublicDeal>('/deals', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function usePatchDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; proposalValue?: number | null; notes?: string | null; ownerUserId?: string | null }) => {
      const { id, ...body } = input;
      return api<PublicDeal>(`/deals/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useChangeStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; stage: DealStage; lossReason?: LossReason; leadQualityFeedback?: LeadQualityFeedback }) => {
      const { id, ...body } = input;
      return api<PublicDeal>(`/deals/${id}/stage`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/deals/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}

// ---------------------------------------------------------------------------
// Usuários atribuíveis (admin + comercial ativos)
// ---------------------------------------------------------------------------

export interface AssignableUser {
  id: string;
  name: string;
  role: 'admin' | 'comercial';
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => api<{ users: AssignableUser[] }>('/users/assignable').then((r) => r.users),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Orçamento detectado em print (sugestão de valor pro card)
// ---------------------------------------------------------------------------

export interface PendingBudgetDetection {
  id: string;
  messageId: string;
  leadId: string;
  detectedValue: number;
  createdAt: string;
}

export function usePendingBudgetDetection(leadId: string | null) {
  return useQuery({
    queryKey: ['budget-detection', leadId],
    queryFn: () => api<PendingBudgetDetection | null>(`/budget-detections/pending/${leadId}`),
    enabled: !!leadId,
  });
}

export function useConfirmBudgetDetection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; value: number; stage?: DealStage }) => {
      const { id, ...body } = input;
      return api(`/budget-detections/${id}/confirm`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ['budget-detection'] });
    },
  });
}

export function useDismissBudgetDetection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/budget-detections/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-detection'] }),
  });
}
