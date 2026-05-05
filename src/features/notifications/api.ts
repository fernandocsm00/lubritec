import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { NotificationsListResponse } from '@shared/types';

const KEY = ['notifications'] as const;
const UNREAD_KEY = ['notifications', 'unread-count'] as const;

export function useNotifications(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<NotificationsListResponse>('/notifications'),
    enabled: opts.enabled ?? true,
    refetchInterval: 30_000,  // sino atualiza ainda que dropdown fechado
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => api<{ unreadCount: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ marked: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });
}
