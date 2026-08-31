import { describe, it, expect } from 'vitest';
import { buildConversationFilters, type ConversationFilterState } from './filters';

const base: ConversationFilterState = {
  queue: 'comercial',
  statusKeys: ['aguardando', 'em_atendimento'],
  origins: ['organic', 'campaign'],
  assignment: 'all',
  uf: 'all',
  instanceId: 'inst-uuid-1',
  q: '',
};

describe('buildConversationFilters', () => {
  it('sem busca, aplica todos os filtros da tela', () => {
    const f = buildConversationFilters(base);

    expect(f.queue).toBe('comercial');
    expect(f.status).toEqual(['aguardando_atendimento', 'em_atendimento']);
    expect(f.origin).toEqual(['organic', 'campaign']);
    expect(f.assignment).toBe('all');
    expect(f.instanceId).toBe('inst-uuid-1');
    expect(f.q).toBeUndefined();
  });

  it('com busca, manda SÓ a busca — nenhum outro filtro interfere', () => {
    // O caso que motivou isto: procurar um telefone dentro de "Comercial +
    // Aguardando" não achava a conversa porque ela estava encerrada. Buscar é
    // procurar em tudo; os chips continuam na URL e voltam a valer ao limpar.
    const f = buildConversationFilters({ ...base, q: '54999456069' });

    expect(f).toEqual({ q: '54999456069' });
  });

  it('ignora a instância também — o contato pode ter falado pela outra linha', () => {
    const f = buildConversationFilters({ ...base, q: 'Fernando' });

    expect(f.instanceId).toBeUndefined();
    expect(f.queue).toBeUndefined();
  });

  it('busca só de espaços não conta como busca', () => {
    const f = buildConversationFilters({ ...base, q: '   ' });

    expect(f.queue).toBe('comercial');
    expect(f.q).toBeUndefined();
  });

  it('apara espaços em volta do termo', () => {
    expect(buildConversationFilters({ ...base, q: '  Fernando  ' })).toEqual({ q: 'Fernando' });
  });

  it('traduz os chips de status, incluindo encerrada', () => {
    const f = buildConversationFilters({ ...base, statusKeys: ['encerrada'] });
    expect(f.status).toEqual(['encerrada']);
  });

  it('traduz os chips derivados (aguardando nós / sem retorno)', () => {
    const f = buildConversationFilters({ ...base, statusKeys: ['aguardando_nos', 'sem_retorno'] });
    expect(f.awaitingUs).toBe(true);
    expect(f.noResponse).toBe(true);
  });

  it('uf "all" não vira filtro', () => {
    expect(buildConversationFilters({ ...base, uf: 'all' }).uf).toBeUndefined();
    expect(buildConversationFilters({ ...base, uf: 'RS' }).uf).toBe('RS');
  });
});
