import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { DashboardView, DashboardPeriod } from '@shared/types';
import { fetchSummary, fetchAttention, fetchWhatsapp, fetchMacroFunnel, fetchAiMetrics } from './api';

export function useDashboardSummary(view: DashboardView, period: DashboardPeriod) {
  return useQuery({
    queryKey: ['dashboard', 'summary', view, period],
    queryFn: () => fetchSummary(view, period),
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardAttention(view: DashboardView) {
  return useQuery({
    queryKey: ['dashboard', 'attention', view],
    queryFn: () => fetchAttention(view),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useDashboardWhatsapp(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'whatsapp'],
    queryFn: fetchWhatsapp,
    staleTime: 15_000,
    refetchInterval: 15_000,
    enabled,
  });
}

export interface MacroFunnelQueryArgs {
  period?: DashboardPeriod;
  from?: string;  // ISO datetime
  to?: string;    // ISO datetime
}

export function useDashboardAiMetrics(args: MacroFunnelQueryArgs, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'ai-metrics', args.from && args.to ? `${args.from}|${args.to}` : (args.period ?? '30d')],
    queryFn: () => fetchAiMetrics(args),
    staleTime: 60_000,
    refetchInterval: 60_000,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardMacroFunnel(args: MacroFunnelQueryArgs, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'macro-funnel', args.from && args.to ? `${args.from}|${args.to}` : (args.period ?? '30d')],
    queryFn: () => fetchMacroFunnel(args),
    staleTime: 60_000,
    refetchInterval: 60_000,
    enabled,
    placeholderData: keepPreviousData,
  });
}
