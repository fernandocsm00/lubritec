import { describe, it, expect } from 'vitest';
import { businessMinutesBetween, type BusinessHoursConfig } from '../lib/businessHours';

// Seg-sex, 08:00-18:00, horário de Brasília. 10h úteis = 600 min por dia.
const CFG: BusinessHoursConfig = {
  startHour: 8,
  endHour: 18,
  days: [1, 2, 3, 4, 5],
  timeZone: 'America/Sao_Paulo',
};

// Brasília é UTC-3 (sem horário de verão desde 2019).
// 2026-08-05 é uma QUARTA; 2026-08-08 é um SÁBADO; 2026-08-10 é uma SEGUNDA.
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe('businessMinutesBetween', () => {
  it('conta minutos corridos dentro do expediente', () => {
    expect(businessMinutesBetween(brt('2026-08-05T09:00'), brt('2026-08-05T11:30'), CFG))
      .toBe(150);
  });

  it('ignora o tempo depois do fechamento', () => {
    // 17:30 -> 19:00 num dia útil: só valem os 30 min até as 18:00.
    expect(businessMinutesBetween(brt('2026-08-05T17:30'), brt('2026-08-05T19:00'), CFG))
      .toBe(30);
  });

  it('mensagem que chega de madrugada só começa a contar na abertura', () => {
    // Chegou 02:00, agora são 09:00 -> 1h de expediente (08:00-09:00).
    expect(businessMinutesBetween(brt('2026-08-05T02:00'), brt('2026-08-05T09:00'), CFG))
      .toBe(60);
  });

  it('atravessa a noite somando só os dois pedaços de expediente', () => {
    // Quarta 17:00 -> quinta 09:00 = 60 (17-18) + 60 (8-9).
    expect(businessMinutesBetween(brt('2026-08-05T17:00'), brt('2026-08-06T09:00'), CFG))
      .toBe(120);
  });

  it('atravessa o fim de semana sem contar sábado e domingo', () => {
    // Sexta 17:00 -> segunda 09:00 = 60 (sex 17-18) + 60 (seg 8-9). Fim de
    // semana vale ZERO — é o que impede a pilha de "esperando há 60h" toda
    // segunda de manhã.
    expect(businessMinutesBetween(brt('2026-08-07T17:00'), brt('2026-08-10T09:00'), CFG))
      .toBe(120);
  });

  it('conta o dia útil inteiro quando atravessa um dia completo', () => {
    // Quarta 08:00 -> sexta 08:00 = quarta (600) + quinta (600).
    expect(businessMinutesBetween(brt('2026-08-05T08:00'), brt('2026-08-07T08:00'), CFG))
      .toBe(1200);
  });

  it('devolve zero quando o intervalo inteiro cai fora do expediente', () => {
    // Sábado inteiro.
    expect(businessMinutesBetween(brt('2026-08-08T09:00'), brt('2026-08-08T17:00'), CFG))
      .toBe(0);
  });

  it('devolve zero quando from é posterior a to', () => {
    expect(businessMinutesBetween(brt('2026-08-05T11:00'), brt('2026-08-05T09:00'), CFG))
      .toBe(0);
  });

  it('devolve zero quando nenhum dia é útil na configuração', () => {
    // Configuração degenerada não pode fazer o relógio correr pra sempre.
    const vazio = { ...CFG, days: [] };
    expect(businessMinutesBetween(brt('2026-08-05T09:00'), brt('2026-08-05T17:00'), vazio))
      .toBe(0);
  });

  it('span absurdo é truncado pelo teto do loop, sem estourar', () => {
    // O teto de 400 iterações existe pra que um bug de avanço de cursor não vire
    // loop infinito dentro do watchdog. Pendência real nunca chega perto disso;
    // o que importa é que o retorno seja finito e a função não lance.
    const r = businessMinutesBetween(brt('2020-01-01T09:00'), brt('2026-08-05T09:00'), CFG);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThan(0);
  });
});
