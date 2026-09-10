import { describe, it, expect } from 'vitest';
import { retryFailedResultMessage, retryFailedConfirmText } from './retryFailed';

describe('retryFailedResultMessage', () => {
  it('informa quantos voltaram para a fila', () => {
    const msg = retryFailedResultMessage({ requeued: 3, skippedInterrupted: 0, campaignStatus: 'running' });
    expect(msg.title).toContain('3');
  });

  it('usa o singular quando é um só', () => {
    const msg = retryFailedResultMessage({ requeued: 1, skippedInterrupted: 0, campaignStatus: 'running' });
    expect(msg.title).toBe('1 disparo reenfileirado');
  });

  it('avisa sobre os interrompidos que ficaram de fora', () => {
    const msg = retryFailedResultMessage({ requeued: 2, skippedInterrupted: 5, campaignStatus: 'running' });
    expect(msg.description).toContain('5');
    expect(msg.description).toMatch(/podem j[áa] ter sido entregues/i);
  });

  it('não menciona interrompidos quando não há nenhum', () => {
    const msg = retryFailedResultMessage({ requeued: 2, skippedInterrupted: 0, campaignStatus: 'running' });
    expect(msg.description ?? '').not.toMatch(/interrompid/i);
  });

  it('explica quando nada foi reenfileirado por serem todos interrompidos', () => {
    const msg = retryFailedResultMessage({ requeued: 0, skippedInterrupted: 4, campaignStatus: 'completed' });
    expect(msg.title).toMatch(/nada|nenhum/i);
    expect(msg.description).toContain('4');
  });
});

describe('retryFailedConfirmText', () => {
  it('diz que a campanha volta a disparar quando está concluída', () => {
    const t = retryFailedConfirmText({ failedCount: 3, status: 'completed', validityExpired: false });
    expect(t).toMatch(/volta a disparar|reabre/i);
  });

  it('avisa quando a vigência comercial já expirou', () => {
    const t = retryFailedConfirmText({ failedCount: 3, status: 'completed', validityExpired: true });
    expect(t).toMatch(/vig[êe]ncia/i);
  });

  it('não fala de vigência quando ela está em dia', () => {
    const t = retryFailedConfirmText({ failedCount: 3, status: 'running', validityExpired: false });
    expect(t).not.toMatch(/vig[êe]ncia/i);
  });

  it('avisa que os interrompidos não entram', () => {
    const t = retryFailedConfirmText({ failedCount: 3, status: 'running', validityExpired: false });
    expect(t).toMatch(/interrompid/i);
  });
});
