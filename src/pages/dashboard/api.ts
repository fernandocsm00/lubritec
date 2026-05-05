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

export function fetchMacroFunnel(args: { period?: DashboardPeriod; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (args.from && args.to) {
    params.set('from', args.from);
    params.set('to', args.to);
  } else {
    params.set('period', args.period ?? '30d');
  }
  return api<DashboardMacroFunnel>(`/dashboard/macro-funnel?${params.toString()}`);
}
