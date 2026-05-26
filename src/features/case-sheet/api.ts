import { api } from '@/lib/apiClient';
import type { PublicCaseSheet } from '@shared/types';

export async function fetchCaseSheet(leadId: string): Promise<PublicCaseSheet> {
  return api<PublicCaseSheet>(`/leads/${leadId}/case-sheet`);
}

export async function reanalyzeCase(leadId: string, reason: string): Promise<void> {
  await api<void>(`/leads/${leadId}/case-sheet/reanalyze`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
