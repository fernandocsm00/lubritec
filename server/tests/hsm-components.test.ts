import { describe, it, expect } from 'vitest';
import { sanitizeComponents, validateComponentsForMeta, countBodyVariables } from '../services/hsmComponents';
import type { HsmComponent } from '@shared/types';

describe('sanitizeComponents', () => {
  it('remove HEADER de texto vazio (causa do subcode 2388043)', () => {
    const input: HsmComponent[] = [
      { type: 'HEADER', format: 'TEXT', text: '   ' },
      { type: 'BODY', text: 'Olá!' },
    ];
    expect(sanitizeComponents(input)).toEqual([{ type: 'BODY', text: 'Olá!' }]);
  });

  it('mantém HEADER de texto preenchido', () => {
    const input: HsmComponent[] = [
      { type: 'HEADER', format: 'TEXT', text: 'Lubritec' },
      { type: 'BODY', text: 'Olá!' },
    ];
    expect(sanitizeComponents(input)).toEqual(input);
  });

  it('mantém HEADER de mídia (sem campo text)', () => {
    const input: HsmComponent[] = [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Olá!' },
    ];
    expect(sanitizeComponents(input)).toEqual(input);
  });

  it('remove FOOTER vazio e grupo de BUTTONS vazio', () => {
    const input: HsmComponent[] = [
      { type: 'BODY', text: 'Olá!' },
      { type: 'FOOTER', text: '' },
      { type: 'BUTTONS', buttons: [] },
    ];
    expect(sanitizeComponents(input)).toEqual([{ type: 'BODY', text: 'Olá!' }]);
  });
});

describe('validateComponentsForMeta', () => {
  it('rejeita variáveis não-numéricas ({{nome}})', () => {
    const comps: HsmComponent[] = [{ type: 'BODY', text: 'Olá {{nome}}, tudo bem?' }];
    expect(() => validateComponentsForMeta(comps)).toThrow(/numéricas/);
  });

  it('rejeita variáveis fora de sequência', () => {
    const comps: HsmComponent[] = [{
      type: 'BODY',
      text: 'Oi {{1}} e {{3}}',
      example: { body_text: [['a', 'b']] },
    }];
    expect(() => validateComponentsForMeta(comps)).toThrow(/sequenciais/);
  });

  it('rejeita quando falta exemplo para uma variável', () => {
    const comps: HsmComponent[] = [{
      type: 'BODY',
      text: 'Oi {{1}} e {{2}}',
      example: { body_text: [['só um']] },
    }];
    expect(() => validateComponentsForMeta(comps)).toThrow(/exemplo/);
  });

  it('rejeita BODY ausente ou vazio', () => {
    expect(() => validateComponentsForMeta([])).toThrow(/BODY/);
    expect(() => validateComponentsForMeta([{ type: 'BODY', text: '  ' }])).toThrow(/BODY/);
  });

  it('aceita template numérico válido com exemplos', () => {
    const comps: HsmComponent[] = [{
      type: 'BODY',
      text: 'Olá {{1}}, sua troca na {{2}} foi um sucesso.',
      example: { body_text: [['João', 'Lubritec']] },
    }];
    expect(() => validateComponentsForMeta(comps)).not.toThrow();
  });

  it('aceita template sem variáveis', () => {
    const comps: HsmComponent[] = [{ type: 'BODY', text: 'Mensagem fixa sem variáveis.' }];
    expect(() => validateComponentsForMeta(comps)).not.toThrow();
  });
});

describe('countBodyVariables', () => {
  it('conta variáveis únicas', () => {
    expect(countBodyVariables([{ type: 'BODY', text: '{{1}} {{2}} {{1}}' }])).toBe(2);
  });
});
