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

// ---------------------------------------------------------------------------
// Webhook debug events (admin-only diagnostics)
// ---------------------------------------------------------------------------

export interface WebhookDebugEntry {
  receivedAt: string;
  headers: Record<string, string>;
  body: unknown;
  bodyKeys: string[] | null;
  result: { kind: string; [key: string]: unknown };
}

export function useWebhookDebugEvents(opts: { enabled: boolean }) {
  return useQuery({
    queryKey: ['whatsapp-instance', 'debug-events'],
    queryFn: () => api<{ events: WebhookDebugEntry[] }>('/whatsapp-instance/debug-events'),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? 3_000 : false,
  });
}

export function useClearWebhookDebugEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/whatsapp-instance/debug-events', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp-instance', 'debug-events'] }),
  });
}

export interface ProbeWebhookResult {
  ours: {
    webhookUrl: string | null;
    webhookSecretPresent: boolean;
    webhookSynced: boolean;
    instanceId: string | null;
    baseUrl: string;
  } | null;
  uazapi: Array<{ path: string; method: string; status: number; body: unknown }>;
}

export function useProbeWebhook() {
  return useMutation({
    mutationFn: () => api<ProbeWebhookResult>('/whatsapp-instance/probe-webhook'),
  });
}

export interface ProbeMessagesResult {
  uazapi: Array<{ path: string; method: string; status: number; body: unknown }>;
}

export function useProbeMessages() {
  return useMutation({
    mutationFn: () => api<ProbeMessagesResult>('/whatsapp-instance/probe-messages'),
  });
}

export interface SelfTestResult {
  posted: { url: string; bodyPreview: Record<string, unknown> };
  response: { status: number; body: unknown };
}

export function useSelfTest() {
  return useMutation({
    mutationFn: () =>
      api<SelfTestResult>('/whatsapp-instance/self-test', { method: 'POST' }),
  });
}
