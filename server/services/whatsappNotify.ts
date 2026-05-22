import { db } from '../db/client';
import { users } from '../db/schema';
import { and, eq, isNotNull, inArray } from 'drizzle-orm';
import { uazapiClient, UazapiError } from './whatsapp/uazapi/client';

/**
 * Envia notificacao via WhatsApp pessoal pros vendedores quando um lead
 * eh qualificado pela IA. Best-effort: erros sao logados, nunca propagados.
 *
 * Filtra users com:
 *   - role = 'comercial' OU 'admin'
 *   - isActive = true
 *   - phone != null
 *
 * Vendedor sem telefone cadastrado eh skipado silenciosamente (warning log).
 * Falha de envio pra um vendedor nao bloqueia os outros.
 */

export interface NotifyVendoresInput {
  leadName: string;
  leadPhone: string;
  summary: string | null;
  inboxRelativeUrl: string;
}

export async function notifyVendoresWhatsapp(input: NotifyVendoresInput): Promise<{
  sent: number;
  skipped: number;
  failed: number;
}> {
  const recipients = await db
    .select({ id: users.id, name: users.name, phone: users.phone })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        isNotNull(users.phone),
        inArray(users.role, ['admin', 'comercial']),
      ),
    );

  // Defesa em profundidade: telefone vazio (string) tambem nao serve.
  const targets = recipients.filter((u) => u.phone && u.phone.trim().length > 0);

  if (targets.length === 0) {
    console.warn('[whatsapp-notify] no vendedores com phone cadastrado; skipping');
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const appUrl = process.env.APP_URL ?? '';
  const fullUrl = appUrl ? `${appUrl}${input.inboxRelativeUrl}` : input.inboxRelativeUrl;
  const body = formatNotificationBody(input, fullUrl);

  let sent = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      await uazapiClient.sendMessage({
        to: target.phone!,
        kind: 'text',
        text: body,
      });
      sent++;
    } catch (err) {
      failed++;
      const reason = err instanceof UazapiError
        ? `UazAPI ${err.status}: ${err.body}`
        : err instanceof Error
          ? err.message
          : String(err);
      console.warn(`[whatsapp-notify] failed for user ${target.id} (${target.name}): ${reason}`);
    }
  }

  return { sent, skipped: 0, failed };
}

function formatNotificationBody(input: NotifyVendoresInput, fullUrl: string): string {
  const parts: string[] = [];
  parts.push(`🔔 *Novo lead qualificado*`);
  parts.push('');
  parts.push(`*${input.leadName}*`);
  parts.push(`📱 ${input.leadPhone}`);
  if (input.summary) {
    parts.push('');
    parts.push(input.summary);
  }
  parts.push('');
  parts.push(`Atender: ${fullUrl}`);
  return parts.join('\n');
}
