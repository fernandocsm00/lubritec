import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { campaignRecipients, campaigns, messages } from '../db/schema';
import type { DeliveryStatus, ProviderKind } from '@shared/types';

/**
 * Status de entrega real das mensagens de saída (migration 046).
 *
 * Contexto: nenhum dos dois provedores confirma entrega na resposta do send.
 * A UazAPI devolve `status: "Pending"` (fila dela) e a Meta devolve 200 com o
 * wamid mesmo pra mensagem que vai falhar. A confirmação chega DEPOIS, por
 * webhook — `messages_update` na UazAPI, array `statuses` na Meta. Este módulo
 * é o ponto único onde esses ACKs viram estado no banco.
 */

/**
 * Ordem de progresso. Um ACK só é aplicado se avança nessa escala — webhooks
 * chegam fora de ordem (é comum `read` chegar antes de `delivered`) e sem isto
 * o último a chegar venceria, fazendo o status andar pra trás.
 */
const RANK: Record<DeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  failed: 2,
  delivered: 3,
  read: 4,
};

/**
 * `failed` é um ramo, não um degrau: uma vez que o aparelho do destinatário
 * confirmou recebimento, um "failed" atrasado (retentativa do provedor, ACK
 * duplicado) não pode apagar a entrega. Fora isso o rank resolve sozinho.
 */
function supersedes(next: DeliveryStatus, current: DeliveryStatus | null): boolean {
  if (current === null) return true;
  if (next === 'failed') return RANK[current] < RANK.delivered;
  return RANK[next] > RANK[current];
}

export interface RecordDeliveryStatusInput {
  provider: ProviderKind;
  /** id da mensagem no provedor, como vem no webhook de ACK. */
  providerMsgId: string;
  status: DeliveryStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Momento do ACK; default agora. */
  at?: Date;
}

export interface RecordDeliveryStatusResult {
  updated: boolean;
  messageId?: string;
  previousStatus?: DeliveryStatus | null;
  reason?: string;
}

/**
 * Aplica um ACK do provedor à mensagem local correspondente.
 *
 * Idempotente e seguro pra reentrega de webhook: um ACK repetido ou atrasado
 * não avança nada e devolve `updated: false`.
 */
export async function recordDeliveryStatus(
  input: RecordDeliveryStatusInput,
): Promise<RecordDeliveryStatusResult> {
  const raw = input.providerMsgId?.trim();
  if (!raw) return { updated: false, reason: 'missing providerMsgId' };

  // A UazAPI grava o id como 'owner:messageid' na resposta do send e manda só
  // 'messageid' no update — e o inverso também acontece. Casamos pelos dois
  // lados pra não perder o ACK por causa do prefixo.
  const suffix = raw.includes(':') ? raw.split(':').pop()! : raw;

  const [row] = await db
    .select({
      id: messages.id,
      deliveryStatus: messages.deliveryStatus,
    })
    .from(messages)
    .where(
      and(
        eq(messages.provider, input.provider),
        or(
          eq(messages.providerMsgId, raw),
          eq(messages.providerMsgId, suffix),
          sql`split_part(${messages.providerMsgId}, ':', 2) = ${suffix}`,
        ),
      ),
    )
    .limit(1);

  if (!row) {
    return { updated: false, reason: `no local message matching ${raw}` };
  }

  if (!supersedes(input.status, row.deliveryStatus)) {
    return {
      updated: false,
      messageId: row.id,
      previousStatus: row.deliveryStatus,
      reason: `${input.status} does not supersede ${row.deliveryStatus}`,
    };
  }

  await db
    .update(messages)
    .set({
      deliveryStatus: input.status,
      deliveryStatusAt: input.at ?? new Date(),
      deliveryErrorCode: input.status === 'failed' ? (input.errorCode ?? null) : null,
      deliveryErrorMessage: input.status === 'failed' ? (input.errorMessage ?? null) : null,
    })
    .where(eq(messages.id, row.id));

  if (input.status === 'failed') {
    await demoteCampaignRecipient(row.id, input.errorCode ?? null, input.errorMessage ?? null);
  }

  return { updated: true, messageId: row.id, previousStatus: row.deliveryStatus };
}

/**
 * Um disparo que o provedor recusou depois do 200 deixa de contar como enviado.
 *
 * Sem isto o destinatário fica 'sent' pra sempre e o funil da campanha soma
 * mensagens que nunca chegaram — a taxa de resposta vira uma divisão por um
 * denominador inflado. Mexe SÓ em quem ainda está 'sent': assim o ACK reentregue
 * (a UazAPI e a Meta reentregam) não desconta duas vezes.
 *
 * Deliberadamente NÃO reenfileira pra reenvio automático. Vale a mesma regra do
 * recipient órfão em 'sending' no dispatcher: o provedor pode ter entregue e só
 * errado o ACK, e disparo duplicado pro mesmo cliente é risco de ban do chip.
 * Reenvio é decisão de quem opera — o destinatário fica em 'failed' com o motivo
 * do provedor, que é o filtro que a tela de campanha já oferece.
 */
async function demoteCampaignRecipient(
  messageId: string,
  errorCode: string | null,
  errorMessage: string | null,
): Promise<void> {
  const reason = ['entrega recusada pelo provedor', errorCode, errorMessage]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 500);

  const demoted = await db
    .update(campaignRecipients)
    .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(campaignRecipients.messageId, messageId),
        eq(campaignRecipients.status, 'sent'),
      ),
    )
    .returning({ campaignId: campaignRecipients.campaignId });

  for (const d of demoted) {
    await db
      .update(campaigns)
      .set({
        // GREATEST(0, ...): o contador é incremental e pode estar dessincronizado
        // de campanhas antigas; nunca deixar negativo.
        sentCount: sql`GREATEST(0, ${campaigns.sentCount} - 1)`,
        failedCount: sql`${campaigns.failedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, d.campaignId));
  }
}
