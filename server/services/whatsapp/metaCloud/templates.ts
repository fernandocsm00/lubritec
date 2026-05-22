import { MetaGraphError } from './client';
import type { HsmComponent } from '@shared/types';

const DEFAULT_API_VERSION = 'v20.0';

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION ?? DEFAULT_API_VERSION}`;
}

async function metaFetch(path: string, init: RequestInit & { accessToken: string }) {
  const { accessToken, ...rest } = init;
  const res = await fetch(`${graphBase()}${path}`, {
    ...rest,
    headers: {
      ...rest.headers,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  if (!res.ok) {
    const err = body as { error?: { code?: number } };
    throw new MetaGraphError(res.status, err?.error?.code ?? null, body);
  }
  return body;
}

// ── Create template ────────────────────────────────────────────────────────
export interface CreateTemplateInput {
  wabaId: string;
  accessToken: string;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: HsmComponent[];
}

export interface CreateTemplateResult {
  metaTemplateId: string;
  status: string;
  category: string;
}

export async function createTemplate(input: CreateTemplateInput): Promise<CreateTemplateResult> {
  const body = await metaFetch(`/${input.wabaId}/message_templates`, {
    method: 'POST',
    accessToken: input.accessToken,
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
    }),
  });
  const b = body as { id: string; status: string; category: string };
  return { metaTemplateId: b.id, status: b.status, category: b.category };
}

// ── List templates on Meta (pull / sync) ──────────────────────────────────
export interface FetchedTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: HsmComponent[];
  rejected_reason?: string;
}

export async function listTemplatesOnMeta(input: {
  wabaId: string;
  accessToken: string;
  limit?: number;
}): Promise<FetchedTemplate[]> {
  const limit = input.limit ?? 200;
  const body = await metaFetch(
    `/${input.wabaId}/message_templates?fields=id,name,language,category,status,components,rejected_reason&limit=${limit}`,
    { method: 'GET', accessToken: input.accessToken },
  );
  const b = body as { data: FetchedTemplate[] };
  return b.data ?? [];
}

// ── Delete template on Meta ────────────────────────────────────────────────
export async function deleteTemplateOnMeta(input: {
  wabaId: string;
  accessToken: string;
  name: string;
}): Promise<void> {
  await metaFetch(
    `/${input.wabaId}/message_templates?name=${encodeURIComponent(input.name)}`,
    { method: 'DELETE', accessToken: input.accessToken },
  );
}

// ── Send a template-typed message ──────────────────────────────────────────
export interface SendTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: { link: string } }
    | { type: 'video'; video: { link: string } }
    | { type: 'document'; document: { link: string } }
  >;
}

export interface SendTemplateInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  name: string;
  language: string;
  components?: SendTemplateComponent[];
}

export async function sendTemplateMessage(
  input: SendTemplateInput,
): Promise<{ messageId: string; rawPayload: unknown }> {
  const body = await metaFetch(`/${input.phoneNumberId}/messages`, {
    method: 'POST',
    accessToken: input.accessToken,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'template',
      template: {
        name: input.name,
        language: { code: input.language },
        components: input.components ?? [],
      },
    }),
  });
  const b = body as { messages?: Array<{ id: string }> };
  if (!b.messages?.length) {
    throw new MetaGraphError(500, null, body);
  }
  return { messageId: b.messages[0].id, rawPayload: body };
}
