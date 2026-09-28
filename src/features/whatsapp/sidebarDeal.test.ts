import { describe, it, expect } from 'vitest';
import { pickSidebarDeal, dealOptionLabel } from './sidebarDeal';

const novo = { id: 'novo' };
const velho = { id: 'velho' };
const fechado = { id: 'fechado' };

describe('pickSidebarDeal', () => {
  it('sem escolha, mostra o aberto mais recente (primeiro da lista)', () => {
    expect(pickSidebarDeal([novo, velho], null, fechado)).toBe(novo);
  });

  it('respeita o card escolhido', () => {
    expect(pickSidebarDeal([novo, velho], 'velho', fechado)).toBe(velho);
  });

  it('escolha que deixou de estar aberta volta pro mais recente', () => {
    expect(pickSidebarDeal([novo], 'velho', fechado)).toBe(novo);
  });

  it('sem nenhum aberto, cai no card fechado mais recente', () => {
    expect(pickSidebarDeal([], null, fechado)).toBe(fechado);
    expect(pickSidebarDeal([], null, null)).toBeNull();
  });
});

describe('dealOptionLabel', () => {
  it('campanha e etapa', () => {
    expect(dealOptionLabel({ campaignName: 'Teste Andrei III', stage: 'lead_no_comercial' }))
      .toBe('Teste Andrei III · Lead no Comercial');
    expect(dealOptionLabel({ campaignName: null, stage: 'proposta_enviada' }))
      .toBe('Sem campanha · Proposta enviada');
  });
});
