import { describe, it, expect } from 'vitest';
import { toCsv, BOM } from '../lib/csv';

describe('toCsv', () => {
  it('monta cabeçalho e linhas separados por ponto-e-vírgula, com CRLF', () => {
    const csv = toCsv(['nome', 'total'], [['Campanha A', 10], ['Campanha B', 3]]);
    expect(csv).toBe(`${BOM}nome;total\r\nCampanha A;10\r\nCampanha B;3`);
  });

  it('começa com BOM para o Excel pt-BR reconhecer UTF-8', () => {
    expect(toCsv(['a'], [['x']]).startsWith(BOM)).toBe(true);
  });

  it('preserva acentos sem escapar', () => {
    expect(toCsv(['situação', 'razão'], [['não qualificado', 'endereço']]))
      .toBe(`${BOM}situação;razão\r\nnão qualificado;endereço`);
  });

  it('escapa campo que contém o separador', () => {
    expect(toCsv(['x'], [['a;b']])).toContain('"a;b"');
  });

  it('escapa aspas duplicando-as', () => {
    expect(toCsv(['x'], [['diz "oi"']])).toContain('"diz ""oi"""');
  });

  it('escapa campo com quebra de linha', () => {
    expect(toCsv(['x'], [['linha1\nlinha2']])).toContain('"linha1\nlinha2"');
  });

  it('trata null e undefined como vazio', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe(`${BOM}a;b\r\n;`);
  });

  it('não escapa o que não precisa', () => {
    expect(toCsv(['a'], [['simples']])).toBe(`${BOM}a\r\nsimples`);
  });

  it('aceita zero linhas, devolvendo só o cabeçalho', () => {
    expect(toCsv(['a', 'b'], [])).toBe(`${BOM}a;b`);
  });

  it('escapa também o cabeçalho quando necessário', () => {
    expect(toCsv(['a;b'], [['x']])).toContain('"a;b"');
  });
});
