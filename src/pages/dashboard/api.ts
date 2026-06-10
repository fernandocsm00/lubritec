import { api } from '@/lib/apiClient';
import type {
  DashboardSummary,
  DashboardAttentionResponse,
  DashboardWhatsappStats,
  DashboardMacroFunnel,
  AiMetricsSummary,
  DashboardView,
  DashboardPeriod,
} from '@shared/types';

/**
 * Recortes opcionais do dashboard por atributos do lead (IMBP / Segmento / Cidade).
 * Aplicados em /summary e /macro-funnel — afeta KPIs/funil de leads. Não impacta
 * WhatsApp/IA/atividades recentes (são da operação inteira).
 */
export interface DashboardLeadFilters {
  imbp?: string;
  segment?: string;
  city?: string;
}

function appendLeadFilters(u: URLSearchParams, f?: DashboardLeadFilters) {
  if (!f) return;
  if (f.imbp) u.set('imbp', f.imbp);
  if (f.segment) u.set('segment', f.segment);
  if (f.city) u.set('city', f.city);
}

export function fetchSummary(view: DashboardView, period: DashboardPeriod, filters?: DashboardLeadFilters) {
  const u = new URLSearchParams({ view, period });
  appendLeadFilters(u, filters);
  return api<DashboardSummary>(`/dashboard/summary?${u.toString()}`);
}

export function fetchAttention(view: DashboardView) {
  return api<DashboardAttentionResponse>(`/dashboard/attention?view=${view}`);
}

export function fetchWhatsapp() {
  return api<DashboardWhatsappStats>('/dashboard/whatsapp');
}

export function fetchMacroFunnel(args: { period?: DashboardPeriod; from?: string; to?: string; filters?: DashboardLeadFilters }) {
  const params = new URLSearchParams();
  if (args.from && args.to) {
    params.set('from', args.from);
    params.set('to', args.to);
  } else {
    params.set('period', args.period ?? '30d');
  }
  appendLeadFilters(params, args.filters);
  return api<DashboardMacroFunnel>(`/dashboard/macro-funnel?${params.toString()}`);
}

export function fetchAiMetrics(args: { period?: DashboardPeriod; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (args.from && args.to) {
    params.set('from', args.from);
    params.set('to', args.to);
  } else {
    params.set('period', args.period ?? '30d');
  }
  return api<AiMetricsSummary>(`/dashboard/ai-metrics?${params.toString()}`);
}
