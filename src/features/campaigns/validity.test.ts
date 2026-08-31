import { describe, it, expect } from 'vitest';
import { campaignValidityState } from './validity';

const NOW = new Date('2026-08-31T12:00:00Z');
const c = (over: Partial<Parameters<typeof campaignValidityState>[0]> = {}) => ({
  isContinuous: false,
  validityEnd: null as string | null,
  ...over,
});

describe('campaignValidityState', () => {
  it('vigente quando o fim ainda não chegou', () => {
    expect(campaignValidityState(c({ validityEnd: '2026-09-07T12:00:00Z' }), NOW)).toBe('vigente');
  });

  it('expirada quando o fim já passou', () => {
    expect(campaignValidityState(c({ validityEnd: '2026-08-30T12:00:00Z' }), NOW)).toBe('expirada');
  });

  it('vigente no instante exato do fim — o último dia ainda vale', () => {
    expect(campaignValidityState(c({ validityEnd: NOW.toISOString() }), NOW)).toBe('vigente');
  });

  it('sem vigência quando não há data — campanhas anteriores ao recurso', () => {
    // Distinto de "expirada": ninguém informou vigência, não que ela acabou.
    expect(campaignValidityState(c(), NOW)).toBe('sem_vigencia');
  });

  it('contínua não tem vigência: devolve null e a UI não mostra selo', () => {
    // Ela re-enfileira indefinidamente; rotulá-la de "expirada" seria mentira.
    expect(campaignValidityState(c({ isContinuous: true }), NOW)).toBeNull();
    expect(campaignValidityState(c({ isContinuous: true, validityEnd: '2026-08-30T12:00:00Z' }), NOW)).toBeNull();
  });

  it('data inválida não quebra a tela', () => {
    expect(campaignValidityState(c({ validityEnd: 'não é data' }), NOW)).toBe('sem_vigencia');
  });
});
