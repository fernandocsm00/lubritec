import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { HsmTemplateRecord, CreateHsmTemplateRequest, HsmHeaderMediaUploadResult } from '@shared/types';

const TEMPLATES_KEY = (instanceId: string) => ['hsm-templates', instanceId];

export function useTemplates(instanceId: string | null) {
  return useQuery({
    queryKey: instanceId ? TEMPLATES_KEY(instanceId) : ['hsm-templates', 'none'],
    queryFn: () => api<{ items: HsmTemplateRecord[] }>(`/whatsapp/instances/${instanceId}/templates`),
    enabled: !!instanceId,
    refetchInterval: 30_000,   // pick up PENDING → APPROVED status changes
  });
}

export function useCreateTemplate(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHsmTemplateRequest) =>
      api<HsmTemplateRecord>(`/whatsapp/instances/${instanceId}/templates`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY(instanceId) }),
  });
}

export function useUpdateTemplate(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { templateId: string; body: CreateHsmTemplateRequest }) =>
      api<HsmTemplateRecord>(`/whatsapp/instances/${instanceId}/templates/${args.templateId}`, {
        method: 'PATCH', body: JSON.stringify(args.body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY(instanceId) }),
  });
}

/** Sobe a imagem de header e devolve { url, handle } (Supabase + Meta). */
export function useUploadHeaderMedia(instanceId: string) {
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<HsmHeaderMediaUploadResult>(
        `/whatsapp/instances/${instanceId}/templates/header-media`,
        { method: 'POST', body: fd },
      );
    },
  });
}

export function useDeleteTemplate(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      api<void>(`/whatsapp/instances/${instanceId}/templates/${templateId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY(instanceId) }),
  });
}

export function useSyncTemplates(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ synced: number; created: number; updated: number }>(
      `/whatsapp/instances/${instanceId}/sync-templates`, { method: 'POST' },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY(instanceId) }),
  });
}
