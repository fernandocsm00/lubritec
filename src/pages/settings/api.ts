import { api } from '@/lib/apiClient';
import type { PublicOrgSettings } from '@shared/types';

export function getOrgSettings() {
  return api<PublicOrgSettings>('/org-settings');
}

export function updateOrgSettings(payload: { monthlySalesGoal: number | null }) {
  return api<PublicOrgSettings>('/org-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
