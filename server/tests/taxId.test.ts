import { describe, it, expect } from 'vitest';
import {
  isValidCnpjFormat,
  isValidCpfFormat,
  isValidTaxId,
  formatCnpj,
  formatCpf,
  formatTaxId,
  detectTaxIdType,
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
