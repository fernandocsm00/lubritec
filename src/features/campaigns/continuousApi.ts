import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type {
  PublicContinuousCampaign,
  UpsertContinuousCampaignInput,
} from '@shared/types';

export interface DispatchWindow {
  ok: boolean;
  reason?: 'weekend' | 'before_start' | 'after_end' | 'no_settings';
  startHour?: number;
  endHour?: number;
}

export interface ContinuousResponse {
  campaign: PublicContinuousCampaign | null;
  dispatchWindow: DispatchWindow;
}

const KEY = ['campaigns', 'continuous'] as const;

export function useContinuousCampaign() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<ContinuousResponse>('/campaigns/continuous'),
    refetchInterval: 15_000,
  });
}

export function useUpsertContinuousCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertContinuousCampaignInput) =>
      api<PublicContinuousCampaign>('/campaigns/continuous', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
