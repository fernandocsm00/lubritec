import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type { AdminUser, Role } from '@shared/types';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: AdminUser[] }>('/users').then((r) => r.users),
    staleTime: 30_000,
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; name: string; role: Role }) =>
      api<{ id: string; email: string; name: string; role: Role }>('/users', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      role?: Role;
      is_active?: boolean;
      phone?: string | null;
    }) => {
      const { id, ...body } = input;
      return api<AdminUser>(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true }>(`/users/${id}/resend-invite`, { method: 'POST' }),
  });
}
