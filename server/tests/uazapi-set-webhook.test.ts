import { describe, it, expect, vi, afterEach } from 'vitest';
import { setWebhook } from '../services/whatsapp/uazapi/instanceClient';

// O corpo que registramos na UazAPI decide o que ela nos manda. Até 25/09/2026
// ele não assinava messages_update e filtrava wasSentByApi — o recibo de
// entrega de TODA mensagem enviada pelo sistema era descartado na origem, e a
// linha não oficial mostrava o relógio pra sempre.
afterEach(() => vi.restoreAllMocks());

async function registeredBody() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  await setWebhook(
    { baseUrl: 'https://uazapi.test', token: 'tok' },
    { url: 'https://app.test/api/whatsapp/webhook?instanceToken=tok', secret: 'tok', events: ['message.received'] },
  );
  const [, init] = fetchSpy.mock.calls[0];
  return JSON.parse(String(init?.body));
}

describe('setWebhook (UazAPI)', () => {
  it('assina messages_update, que é o evento do recibo de entrega', async () => {
    const body = await registeredBody();
    expect(body.events).toContain('messages_update');
    expect(body.events).toContain('messages');
  });

  it('não filtra wasSentByApi — o filtro engolia o recibo de tudo que o sistema envia', async () => {
    const body = await registeredBody();
    expect(body.excludeMessages).not.toContain('wasSentByApi');
  });

  it('continua ignorando grupos', async () => {
    const body = await registeredBody();
    expect(body.excludeMessages).toContain('isGroupYes');
  });
});
