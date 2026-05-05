import { api } from '@/lib/apiClient';
import type { PublicOrgSettings, UpdateOrgSettingsInput } from '@shared/types';

export function getOrgSettings() {
  return api<PublicOrgSettings>('/org-settings');
}

export function updateOrgSettings(payload: UpdateOrgSettingsInput) {
  return api<PublicOrgSettings>('/org-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
