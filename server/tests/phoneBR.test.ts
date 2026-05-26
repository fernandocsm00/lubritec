import { describe, it, expect } from 'vitest';
import { toCanonicalBrPhone, arePhonesEquivalent } from '../lib/phoneBR';

describe('toCanonicalBrPhone', () => {
  describe('celular ja canonico', () => {
    it('aceita 13 digitos com 55 + DDD + 9 + 8 (caso normal)', () => {
      expect(toCanonicalBrPhone('5554996532189')).toBe('5554996532189');
      expect(toCanonicalBrPhone('5511987654321')).toBe('5511987654321');
    });
  });

  describe('celular sem o 9 prefix (inbound WhatsApp legacy)', () => {
    it('injeta o 9 quando 12 digitos com 55 + DDD + 8', () => {
      expect(toCanonicalBrPhone('555496532189')).toBe('5554996532189');
      expect(toCanonicalBrPhone('551187654321')).toBe('5511987654321');
    });
  });

  describe('sem o 55 do pais', () => {
    it('prepend 55 quando 11 digitos (celular ja com 9)', () => {
      expect(toCanonicalBrPhone('54996532189')).toBe('5554996532189');
      expect(toCanonicalBrPhone('11987654321')).toBe('5511987654321');
    });
    it('prepend 55 e injeta 9 quando 10 digitos (celular sem 9)', () => {
      expect(toCanonicalBrPhone('5496532189')).toBe('5554996532189');
      expect(toCanonicalBrPhone('1187654321')).toBe('5511987654321');
    });
  });

  describe('formato com pontuacao / sufixo WhatsApp', () => {
    it('extrai digitos de "+55 54 99653-2189"', () => {
      expect(toCanonicalBrPhone('+55 54 99653-2189')).toBe('5554996532189');
    });
    it('extrai digitos de "5554996532189@s.whatsapp.net"', () => {
      expect(toCanonicalBrPhone('5554996532189@s.whatsapp.net')).toBe('5554996532189');
    });
    it('lida com prefixo internacional 00', () => {
      expect(toCanonicalBrPhone('005554996532189')).toBe('5554996532189');
    });
  });

  describe('fixo BR (8 digitos apos DDD, sem 9 prefix)', () => {
    it('mantem 12 digitos quando ja canonico', () => {
      expect(toCanonicalBrPhone('551133224455')).toBe('551133224455');
    });
    it('NAO injeta 9 quando primeiro digito apos DDD eh 2-5 (telefone fixo)', () => {
      // 32 eh fixo (numero comeca com 3) -- nao mexer
      expect(toCanonicalBrPhone('1132445566')).toBe('551132445566');
    });
  });

  describe('invalidos', () => {
    it('retorna null pra string vazia/null/undefined', () => {
      expect(toCanonicalBrPhone('')).toBeNull();
      expect(toCanonicalBrPhone(null)).toBeNull();
      expect(toCanonicalBrPhone(undefined)).toBeNull();
    });
    it('retorna null pra DDD invalido', () => {
      // DDDs 30, 39, 56-59, 60, 70, 72, 76, 78, 80, 90 nao sao atribuidos.
      expect(toCanonicalBrPhone('5530987654321')).toBeNull();
      expect(toCanonicalBrPhone('5556987654321')).toBeNull();
    });
    it('retorna null quando muito curto ou muito longo', () => {
      expect(toCanonicalBrPhone('123')).toBeNull();
      expect(toCanonicalBrPhone('123456789012345')).toBeNull();
    });
  });
});

describe('arePhonesEquivalent', () => {
  it('reconhece o mesmo numero em formatos diferentes', () => {
    expect(arePhonesEquivalent('5554996532189', '555496532189')).toBe(true);
    expect(arePhonesEquivalent('54996532189', '5554996532189')).toBe(true);
    expect(arePhonesEquivalent('+55 54 99653-2189', '5554996532189@s.whatsapp.net')).toBe(true);
  });
  it('false para numeros diferentes', () => {
    expect(arePhonesEquivalent('5554996532189', '5511987654321')).toBe(false);
  });
  it('false quando um dos lados eh invalido', () => {
    expect(arePhonesEquivalent('5554996532189', null)).toBe(false);
    expect(arePhonesEquivalent('abc', '5554996532189')).toBe(false);
  });
});
