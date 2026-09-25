import { describe, it, expect } from 'vitest';
import { sessionWindowView } from './sessionWindow';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-09-25T13:00:00.000Z');
const ago = (h: number) => new Date(now.getTime() - h * HOUR).toISOString();

type Msg = Parameters<typeof sessionWindowView>[0]['messages'][number];
const msg = (over: Partial<Msg>): Msg => ({
  direction: 'out',
  sentAt: ago(1),
  deliveryStatus: 'sent',
  deletedAt: null,
  ...over,
});

describe('sessionWindowView', () => {
  it('linha não oficial não tem janela', () => {
    const v = sessionWindowView({ provider: 'uazapi', lastInboundAt: ago(72), messages: [], now });
    expect(v.state).toBe('sem_janela');
  });

  it('não trava enquanto a linha ainda não carregou', () => {
    // O servidor barra de qualquer jeito; travar sem saber a linha daria
    // "janela fechada" falso em linha não oficial.
    const v = sessionWindowView({ provider: undefined, lastInboundAt: null, messages: [], now });
    expect(v.state).toBe('sem_janela');
  });

  it('aberta: fecha 24h depois da última mensagem do cliente', () => {
    const v = sessionWindowView({ provider: 'meta_cloud', lastInboundAt: ago(2), messages: [], now });
    expect(v).toEqual({
      state: 'aberta',
      closesAt: new Date(now.getTime() + 22 * HOUR),
      closingSoon: false,
    });
  });

  it('avisa quando faltam menos de 3h pra fechar', () => {
    const v = sessionWindowView({ provider: 'meta_cloud', lastInboundAt: ago(22), messages: [], now });
    expect(v.state).toBe('aberta');
    expect(v.state === 'aberta' && v.closingSoon).toBe(true);
  });

  it('fechada exatamente em 24h', () => {
    const v = sessionWindowView({ provider: 'meta_cloud', lastInboundAt: ago(24), messages: [], now });
    expect(v.state).toBe('fechada');
  });

  it('fechada quando o cliente nunca escreveu nesta linha', () => {
    const v = sessionWindowView({ provider: 'meta_cloud', lastInboundAt: null, messages: [], now });
    expect(v).toEqual({ state: 'fechada', lastInboundAt: null, templateSentAt: null });
  });

  it('usa a mensagem recebida da thread quando a lista ainda não atualizou', () => {
    // A lista de conversas faz polling a cada 15s e a thread a cada 5s: a
    // resposta do cliente aparece primeiro na thread, e é ela que reabre.
    const v = sessionWindowView({
      provider: 'meta_cloud',
      lastInboundAt: ago(30),
      messages: [msg({ direction: 'in', sentAt: ago(0.01), deliveryStatus: null })],
      now,
    });
    expect(v.state).toBe('aberta');
  });

  it('marca o template enviado depois que a janela fechou', () => {
    const v = sessionWindowView({
      provider: 'meta_cloud',
      lastInboundAt: ago(30),
      messages: [msg({ sentAt: ago(1) })],
      now,
    });
    expect(v).toEqual({
      state: 'fechada',
      lastInboundAt: new Date(ago(30)),
      templateSentAt: new Date(ago(1)),
    });
  });

  it('mensagem recusada pela Meta não conta como template', () => {
    // Caso real: "Bom dia amigo" enviado fora da janela voltou 131047.
    const v = sessionWindowView({
      provider: 'meta_cloud',
      lastInboundAt: ago(30),
      messages: [msg({ sentAt: ago(1), deliveryStatus: 'failed' })],
      now,
    });
    expect(v.state === 'fechada' && v.templateSentAt).toBeNull();
  });

  it('mensagem enviada com a janela ainda aberta não conta como template', () => {
    const v = sessionWindowView({
      provider: 'meta_cloud',
      lastInboundAt: ago(30),
      messages: [msg({ sentAt: ago(10) })],
      now,
    });
    expect(v.state === 'fechada' && v.templateSentAt).toBeNull();
  });
});
