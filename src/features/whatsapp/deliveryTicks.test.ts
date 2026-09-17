import { describe, it, expect } from 'vitest';
import { deliveryTick } from './deliveryTicks';

const out = (over: Partial<Parameters<typeof deliveryTick>[0]> = {}) => ({
  direction: 'out' as const,
  deliveryStatus: null,
  deliveryErrorCode: null,
  deliveryErrorMessage: null,
  ...over,
});

describe('deliveryTick', () => {
  it('não mostra recibo em mensagem recebida', () => {
    expect(deliveryTick({ ...out(), direction: 'in', deliveryStatus: 'read' })).toBeNull();
  });

  it('não mostra recibo quando a entrega é desconhecida', () => {
    // Mensagem anterior à instrumentação: nunca houve ACK. Inventar um ✓✓ aqui
    // é exatamente o bug que a instrumentação existe pra corrigir.
    expect(deliveryTick(out({ deliveryStatus: null }))).toBeNull();
  });

  it('mostra relógio enquanto está só na fila do provedor', () => {
    const t = deliveryTick(out({ deliveryStatus: 'queued' }))!;
    expect(t.tone).toBe('pending');
    expect(t.label).toMatch(/fila/i);
  });

  it('mostra um tique só quando o WhatsApp aceitou mas ainda não entregou', () => {
    const t = deliveryTick(out({ deliveryStatus: 'sent' }))!;
    expect(t.glyph).toBe('✓');
    expect(t.tone).toBe('muted');
  });

  it('mostra dois tiques neutros quando entregue no aparelho', () => {
    const t = deliveryTick(out({ deliveryStatus: 'delivered' }))!;
    expect(t.glyph).toBe('✓✓');
    expect(t.tone).toBe('delivered');
  });

  it('mostra dois tiques azuis só quando lida', () => {
    const t = deliveryTick(out({ deliveryStatus: 'read' }))!;
    expect(t.glyph).toBe('✓✓');
    expect(t.tone).toBe('read');
  });

  it('sinaliza falha e mostra a razão do provedor', () => {
    const t = deliveryTick(out({
      deliveryStatus: 'failed',
      deliveryErrorCode: '131026',
      deliveryErrorMessage: 'Message undeliverable',
    }))!;
    expect(t.tone).toBe('failed');
    expect(t.glyph).toBe('!');
    expect(t.label).toContain('131026');
    expect(t.label).toContain('Message undeliverable');
  });

  it('sinaliza falha mesmo sem detalhe do provedor', () => {
    const t = deliveryTick(out({ deliveryStatus: 'failed' }))!;
    expect(t.tone).toBe('failed');
    expect(t.label).toMatch(/não foi entregue/i);
  });
});
