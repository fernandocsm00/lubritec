import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { useAuthStore } from './store';
import type { LoginResponse, PublicUser } from '@shared/types';

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => setAuth(data.user, data.accessToken),
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => clear(),
  });
}

export function useMe(enabled: boolean) {
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api<PublicUser>('/auth/me');
      setUser(me);
      return me;
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useRequestReset() {
  return useMutation({
    mutationFn: (email: string) =>
      api<void>('/auth/request-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  });
}

export function useResetPassword() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (input: { tokenId: string; rawToken: string; password: string }) =>
      api<LoginResponse>('/auth/reset-password', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => setAuth(data.user, data.accessToken),
  });
}

export function useSetupPassword() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (input: { tokenId: string; rawToken: string; password: string }) =>
      api<LoginResponse>('/auth/setup-password', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => setAuth(data.user, data.accessToken),
  });
}
