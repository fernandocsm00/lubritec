import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { InstanceStatusResponse } from './types';

export function useInstanceStatus() {
  return useQuery({
    queryKey: ['whatsapp-instance'],
    queryFn: () => api<InstanceStatusResponse>('/whatsapp-instance'),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'pairing') return 2_000;
      if (status === 'connected') return 30_000;
      return 5_000;
    },
    refetchIntervalInBackground: false,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['whatsapp-instance'] });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { baseUrl?: string; instanceToken?: string } = {}) =>
      api<InstanceStatusResponse>('/whatsapp-instance/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<InstanceStatusResponse>('/whatsapp-instance/disconnect', { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/whatsapp-instance', { method: 'DELETE' }),
    onSuccess: () => invalidate(qc),
  });
}
