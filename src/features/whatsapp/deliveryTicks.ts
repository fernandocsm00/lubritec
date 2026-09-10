import type { DeliveryStatus, MessageDirection } from '@shared/types';

/**
 * Recibo de entrega de uma mensagem de saída.
 *
 * Antes da migration 046 a Inbox pintava um "✓✓" azul fixo em TODA mensagem de
 * saída — não era recibo, era enfeite: mensagem que nunca chegou ao destino
 * ficava idêntica a mensagem lida. Aqui cada estado só aparece quando o
 * provedor confirmou, e "não sei" não vira "entregue".
 */
export interface DeliveryTick {
  glyph: string;
  /** Texto do title/tooltip — explica o que o símbolo significa de fato. */
  label: string;
  tone: 'pending' | 'muted' | 'delivered' | 'read' | 'failed';
}

export interface DeliveryTickInput {
  direction: MessageDirection;
  deliveryStatus: DeliveryStatus | null;
  deliveryErrorCode: string | null;
  deliveryErrorMessage: string | null;
}

export function deliveryTick(msg: DeliveryTickInput): DeliveryTick | null {
  if (msg.direction !== 'out') return null;

  switch (msg.deliveryStatus) {
    case 'queued':
      return {
        glyph: '🕗',
        tone: 'pending',
        label: 'Na fila do provedor — entrega ainda não confirmada',
      };
    case 'sent':
      return {
        glyph: '✓',
        tone: 'muted',
        label: 'Aceita pelo WhatsApp — ainda não entregue no aparelho',
      };
    case 'delivered':
      return {
        glyph: '✓✓',
        tone: 'delivered',
        label: 'Entregue no aparelho do cliente',
      };
    case 'read':
      return {
        glyph: '✓✓',
        tone: 'read',
        label: 'Lida pelo cliente',
      };
    case 'failed':
      return {
        glyph: '!',
        tone: 'failed',
        label: failureLabel(msg.deliveryErrorCode, msg.deliveryErrorMessage),
      };
    default:
      // null = sem ACK registrado (mensagem anterior à instrumentação).
      // Entrega DESCONHECIDA: melhor não mostrar recibo nenhum do que mostrar
      // um que não temos como sustentar.
      return null;
  }
}

function failureLabel(code: string | null, message: string | null): string {
  const detail = [code, message].filter(Boolean).join(' — ');
  return detail
    ? `Não foi entregue (${detail})`
    : 'Não foi entregue — o provedor recusou a mensagem';
}

/** Classe Tailwind por tom, pra manter cor fora do componente. */
export const DELIVERY_TICK_CLASS: Record<DeliveryTick['tone'], string> = {
  pending: 'text-muted-foreground/60',
  muted: 'text-muted-foreground/80',
  delivered: 'text-muted-foreground',
  read: 'text-sky-400',
  failed: 'text-red-500 font-bold',
};
