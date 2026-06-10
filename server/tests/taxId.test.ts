import { describe, it, expect } from 'vitest';
import {
  isValidCnpjFormat,
  isValidCpfFormat,
  isValidTaxId,
  parseTaxIdLenient,
  formatCnpj,
  formatCpf,
  formatTaxId,
  detectTaxIdType,
  type ParsedTaxId,
} from '../lib/cnpj';

// CPFs reais matematicamente validos (digito verificador OK)
const VALID_CPF_1 = '52998224725';
const VALID_CPF_2 = '11144477735';

// CNPJs reais
const VALID_CNPJ_1 = '11444777000161'; // Banco do Brasil
const VALID_CNPJ_2 = '00360305000104'; // Caixa

describe('detectTaxIdType', () => {
  it('11 digitos => cpf', () => {
    expect(detectTaxIdType(VALID_CPF_1)).toBe('cpf');
    expect(detectTaxIdType('123.456.789-09')).toBe('cpf');
  });
  it('14 digitos => cnpj', () => {
    expect(detectTaxIdType(VALID_CNPJ_1)).toBe('cnpj');
    expect(detectTaxIdType('11.444.777/0001-61')).toBe('cnpj');
  });
  it('outros tamanhos => null', () => {
    expect(detectTaxIdType('123')).toBeNull();
    expect(detectTaxIdType('12345678901234567')).toBeNull();
  });
});

describe('isValidCpfFormat', () => {
  it('aceita CPF valido com formatacao', () => {
    expect(isValidCpfFormat('529.982.247-25')).toBe(true);
    expect(isValidCpfFormat(VALID_CPF_2)).toBe(true);
  });
  it('rejeita CPF com digito verificador errado', () => {
    expect(isValidCpfFormat('52998224724')).toBe(false);
  });
  it('rejeita CPF com todos digitos iguais', () => {
    expect(isValidCpfFormat('11111111111')).toBe(false);
    expect(isValidCpfFormat('00000000000')).toBe(false);
  });
  it('rejeita tamanho errado', () => {
    expect(isValidCpfFormat('1234567890')).toBe(false);
    expect(isValidCpfFormat(VALID_CNPJ_1)).toBe(false);
  });
});

describe('isValidTaxId', () => {
  it('aceita CPF valido', () => {
    expect(isValidTaxId(VALID_CPF_1)).toBe(true);
  });
  it('aceita CNPJ valido', () => {
    expect(isValidTaxId(VALID_CNPJ_1)).toBe(true);
  });
  it('rejeita CPF invalido', () => {
    expect(isValidTaxId('11111111111')).toBe(false);
  });
  it('rejeita CNPJ invalido', () => {
    expect(isValidTaxId('11111111111111')).toBe(false);
  });
  it('rejeita tamanhos errados', () => {
    expect(isValidTaxId('123')).toBe(false);
    expect(isValidTaxId('123456789012345')).toBe(false);
  });
});

describe('formatTaxId', () => {
  it('formata CPF: 000.000.000-00', () => {
    expect(formatCpf(VALID_CPF_1)).toBe('529.982.247-25');
    expect(formatTaxId(VALID_CPF_1)).toBe('529.982.247-25');
  });
  it('formata CNPJ: 00.000.000/0000-00', () => {
    expect(formatCnpj(VALID_CNPJ_2)).toBe('00.360.305/0001-04');
    expect(formatTaxId(VALID_CNPJ_2)).toBe('00.360.305/0001-04');
  });
  it('null/undefined/empty => string vazia', () => {
    expect(formatTaxId(null)).toBe('');
    expect(formatTaxId(undefined)).toBe('');
    expect(formatTaxId('')).toBe('');
  });
  it('tamanho invalido => retorna como veio', () => {
    expect(formatTaxId('abc')).toBe('abc');
  });
});

describe('parseTaxIdLenient', () => {
  it('CPF formatado válido (passo 2)', () => {
    expect(parseTaxIdLenient('111.444.777-35')).toEqual({
      value: '11144477735',
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CPF só dígitos válido (passo 2)', () => {
    expect(parseTaxIdLenient(VALID_CPF_1)).toEqual({
      value: VALID_CPF_1,
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CNPJ formatado válido (passo 3)', () => {
    expect(parseTaxIdLenient('11.444.777/0001-61')).toEqual({
      value: '11444777000161',
      type: 'cnpj',
    } satisfies ParsedTaxId);
  });

  it('CPF mascarado com 3 zeros (passo 4) — caso reportado', () => {
    // 01850379092 é CPF válido. 00001850379092 (14 dig) com leading zeros
    // deve cair no passo 4 e ser aceito como CPF.
    expect(parseTaxIdLenient('00001850379092')).toEqual({
      value: '01850379092',
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CPF mascarado com 3 leading zeros pra outro CPF válido (passo 4)', () => {
    // 11144477735 é CPF válido. 00011144477735 (14 dig com 3 leading zeros)
    // → últimos 11 são "11144477735" → CPF válido.
    expect(parseTaxIdLenient('00011144477735')).toEqual({
      value: '11144477735',
      type: 'cpf',
    } satisfies ParsedTaxId);
  });

  it('CNPJ com 1 dígito errado e últimos 11 não-CPF → null', () => {
    // 11222333000180 NÃO é CNPJ válido (último dig 0 deveria ser 1).
    // Últimos 11 dígitos = "22333000180" → NÃO é CPF válido.
    expect(parseTaxIdLenient('11222333000180')).toBeNull();
  });

  it('all-zeros (14 dig) → null', () => {
    // 14 zeros falha CNPJ (all-same). Últimos 11 zeros falha CPF (all-same).
    expect(parseTaxIdLenient('00000000000000')).toBeNull();
  });

  it('string sem dígitos → null', () => {
    expect(parseTaxIdLenient('---')).toBeNull();
    expect(parseTaxIdLenient('')).toBeNull();
  });

  it('comprimento errado (nem CPF nem CNPJ nem mascarado) → null', () => {
    expect(parseTaxIdLenient('1234567')).toBeNull();
    expect(parseTaxIdLenient('123456789012')).toBeNull();   // 12 dig
    expect(parseTaxIdLenient('1234567890123')).toBeNull();  // 13 dig
  });
});
