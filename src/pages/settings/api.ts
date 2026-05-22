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

export interface TestPromptResult {
  cleanReply: string;
  qualification: 'qualified' | 'not_qualified' | null;
  summary: string | null;
  rawReply: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

export function testAiPrompt(message: string) {
  return api<TestPromptResult>('/org-settings/test-ai-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}
