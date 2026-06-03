import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type {
  PublicConversation,
  PublicMessage,
  PublicMessageTemplate,
  ConversationCounts,
  ConversationFilters,
  ConversationQueue,
  MessageKind,
} from './types';

export interface ListResult {
  items: PublicConversation[];
  total: number;
  page: number;
  pageSize: number;
}

function buildQuery(filters: ConversationFilters): string {
  const u = new URLSearchParams();
  if (filters.queue) u.set('queue', filters.queue);
  if (filters.status?.length) u.set('status', filters.status.join(','));
  if (filters.expired24h) u.set('expired24h', 'true');
  if (filters.noResponse) u.set('noResponse', 'true');
  // Default true: Inbox esconde disparos sem resposta. Setado explicitamente
  // pra deixar comportamento claro no query string.
  u.set('onlyWithInbound', filters.onlyWithInbound === false ? 'false' : 'true');
  if (filters.origin?.length) u.set('origin', filters.origin.join(','));
  if (filters.campaignId) u.set('campaignId', filters.campaignId);
  if (filters.assignment && filters.assignment !== 'all') u.set('assignment', filters.assignment);
  if (filters.q) u.set('q', filters.q);
  if (filters.page && filters.page > 1) u.set('page', String(filters.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useConversations(filters: ConversationFilters) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: () => api<ListResult>(`/conversations${buildQuery(filters)}`),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export function useConversationCounts() {
  return useQuery({
    queryKey: ['conversations', 'counts'],
    queryFn: () => api<ConversationCounts>('/conversations/counts'),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export interface ConversationByLeadResult {
  id: string;
  queue: 'ia' | 'recepcao' | 'comercial';
  status: 'aguardando_atendimento' | 'em_atendimento' | 'encerrada';
}

/**
 * Resolve leadId -> conversa mais recente (qualquer fila/status). Usado por
 * deep-links ("Abrir conversa" do inside sales) pra encontrar a conversa
 * onde quer que esteja. Lance promise direta pra usar em useEffect.
 */
export function fetchConversationByLead(leadId: string) {
  return api<ConversationByLeadResult>(`/conversations/by-lead/${leadId}`);
}

export interface MessagesResult { items: PublicMessage[]; hasMore: boolean }

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api<MessagesResult>(`/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    refetchInterval: 2_500,
    refetchIntervalInBackground: false,
  });
}

export interface StartConversationInput {
  phone: string;
  name?: string;
  kind: MessageKind;
  body?: string;
  mediaUrl?: string;
  mediaMime?: string;
}

export interface StartConversationResult {
  conversation: PublicConversation;
  message: PublicMessage;
}

export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartConversationInput) =>
      api<StartConversationResult>('/conversations/start', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: MessageKind;
      body?: string;
      mediaUrl?: string;
      mediaMime?: string;
    }) =>
      api<PublicMessage>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useClaimConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<PublicConversation>(`/conversations/${id}/claim`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export interface ConversationAssignee {
  id: string;
  name: string;
  role: 'admin' | 'comercial' | 'recepcao';
}

export function useConversationAssignees() {
  return useQuery({
    queryKey: ['users', 'conversation-assignees'],
    queryFn: () =>
      api<{ users: ConversationAssignee[] }>('/users/conversation-assignees').then((r) => r.users),
    staleTime: 5 * 60_000,
  });
}

export function useAssignConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string | null }) =>
      api<PublicConversation>(`/conversations/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useChangeQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, queue }: { id: string; queue: ConversationQueue }) =>
      api<PublicConversation>(`/conversations/${id}/queue`, {
        method: 'POST',
        body: JSON.stringify({ queue }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) =>
      api<PublicMessage>(`/conversations/${conversationId}/messages/${messageId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      messageId,
      body,
    }: {
      conversationId: string;
      messageId: string;
      body: string;
    }) =>
      api<PublicMessage>(`/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.conversationId] });
    },
  });
}

export function useCloseConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<PublicConversation>(`/conversations/${id}/close`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<PublicConversation>(`/conversations/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export interface TemplatesResult { items: PublicMessageTemplate[] }

export function useTemplates() {
  return useQuery({
    queryKey: ['message-templates'],
    queryFn: () => api<TemplatesResult>('/message-templates'),
    staleTime: 60_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      api<PublicMessageTemplate>('/message-templates', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-templates'] }),
  });
}

export function useUploadConversationMedia() {
  return useMutation({
    mutationFn: async (file: File): Promise<{ mediaUrl: string; mediaMime: string }> => {
      const fd = new FormData();
      fd.append('file', file);
      return api('/conversations/upload-media', { method: 'POST', body: fd });
    },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; body?: string }) =>
      api<PublicMessageTemplate>(`/message-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/message-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-templates'] }),
  });
}
