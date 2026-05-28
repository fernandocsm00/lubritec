import { describe, it, expect } from 'vitest';
import { brtInputToUtcIso, utcIsoToBrtInput } from '../../src/lib/datetimeBR';

/**
 * Bug capturado em 2026-05-27: usuario agendou campanha pras 08:30 e ela
 * disparou as 05:30 BRT. Causa: new Date("YYYY-MM-DDTHH:mm").toISOString() no
 * frontend interpretava a hora no TZ do NAVEGADOR (UTC), nao em BRT.
 *
 * Estes testes travam a conversao em BRT explicito, independente de TZ.
 */
describe('datetimeBR — conversao datetime-local <-> ISO UTC em BRT fixo', () => {
  describe('brtInputToUtcIso', () => {
    it('08:30 BRT → 11:30 UTC (offset -03:00)', () => {
      expect(brtInputToUtcIso('2026-05-27T08:30')).toBe('2026-05-27T11:30:00.000Z');
    });

    it('00:00 BRT → 03:00 UTC mesmo dia', () => {
      expect(brtInputToUtcIso('2026-05-27T00:00')).toBe('2026-05-27T03:00:00.000Z');
    });

    it('22:00 BRT vira 01:00 UTC do dia seguinte (vira a meia-noite)', () => {
      expect(brtInputToUtcIso('2026-05-27T22:00')).toBe('2026-05-28T01:00:00.000Z');
    });

    it('string vazia retorna vazio', () => {
      expect(brtInputToUtcIso('')).toBe('');
    });

    it('string invalida retorna vazio (nao lanca)', () => {
      expect(brtInputToUtcIso('nao-e-data')).toBe('');
    });
  });

  describe('utcIsoToBrtInput', () => {
    it('11:30 UTC → 08:30 BRT', () => {
      expect(utcIsoToBrtInput('2026-05-27T11:30:00.000Z')).toBe('2026-05-27T08:30');
    });

    it('01:00 UTC do dia seguinte → 22:00 BRT do dia anterior', () => {
      expect(utcIsoToBrtInput('2026-05-28T01:00:00.000Z')).toBe('2026-05-27T22:00');
    });

    it('round-trip: input BRT → UTC → BRT preserva a hora original', () => {
      const original = '2026-05-27T08:30';
      const utc = brtInputToUtcIso(original);
      const backToBrt = utcIsoToBrtInput(utc);
      expect(backToBrt).toBe(original);
    });

    it('string vazia retorna vazio', () => {
      expect(utcIsoToBrtInput('')).toBe('');
    });
  });
});
