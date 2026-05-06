import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';

export type FeedbackStatus = 'open' | 'doing' | 'done' | 'dismissed';

export interface FeedbackImage {
  path: string;
  originalName: string;
}

export interface ProjectFeedback {
  id: string;
  userId: string | null;
  authorName: string;
  content: string;
  images: FeedbackImage[];
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export function useFeedback() {
  return useQuery({
    queryKey: ['project-feedback'],
    queryFn: () => api<{ items: ProjectFeedback[] }>('/project-feedback').then((r) => r.items),
    staleTime: 10_000,
  });
}

export function useCreateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; images: File[] }) => {
      const fd = new FormData();
      fd.append('content', input.content);
      for (const file of input.images) fd.append('images', file);
      return api<ProjectFeedback>('/project-feedback', {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-feedback'] }),
  });
}

export function useUpdateFeedbackStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: FeedbackStatus }) =>
      api<ProjectFeedback>(`/project-feedback/${input.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: input.status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-feedback'] }),
  });
}

export function useDeleteFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/project-feedback/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-feedback'] }),
  });
}
