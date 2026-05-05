import { api } from '@/lib/apiClient';
import type {
  DashboardSummary,
  DashboardAttentionResponse,
  DashboardWhatsappStats,
  DashboardMacroFunnel,
  DashboardView,
  DashboardPeriod,
} from '@shared/types';

export function fetchSummary(view: DashboardView, period: DashboardPeriod) {
  return api<DashboardSummary>(`/dashboard/summary?view=${view}&period=${period}`);
}

export function fetchAttention(view: DashboardView) {
  return api<DashboardAttentionResponse>(`/dashboard/attention?view=${view}`);
}

export function fetchWhatsapp() {
  return api<DashboardWhatsappStats>('/dashboard/whatsapp');
}

export function fetchMacroFunnel(period: DashboardPeriod) {
  return api<DashboardMacroFunnel>(`/dashboard/macro-funnel?period=${period}`);
}
