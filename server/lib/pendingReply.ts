import { sql, type SQL } from 'drizzle-orm';
import { conversations } from '../db/schema';

/**
 * "A bola esta com a gente": o cliente mandou a ultima mensagem e ninguem
 * automatico vai responder.
 *
 * Esta funcao existe pra ser o UNICO lugar onde a regra mora. Antes dela a
 * mesma ideia estava escrita em dois lugares com definicoes diferentes — o
 * filtro da Inbox nao exigia que a ultima mensagem fosse do cliente, e por isso
 * listava 23 conversas quando so 1 estava mesmo esperando. Se precisar mudar a
 * regra, mude aqui e em nenhum outro lugar.
 *
 * `last_message_at <= last_inbound_at` e o que expressa "a ultima e do cliente":
 * qualquer outbound posterior empurra last_message_at pra frente. A igualdade e
 * o caso normal, ja que a inbound atualiza as duas colunas.
 */
export function awaitingUsSql(): SQL {
  return sql`(
    ${conversations.status} <> 'encerrada'
    AND ${conversations.lastInboundAt} IS NOT NULL
    AND ${conversations.lastMessageAt} <= ${conversations.lastInboundAt}
    AND (${conversations.queue} = 'comercial' OR ${conversations.aiDisabled} = true)
  )`;
}
