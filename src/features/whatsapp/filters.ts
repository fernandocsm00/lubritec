import type {
  ConversationFilters, ConversationQueue, ConversationStatus, OriginKind, Uf,
} from '@shared/types';

/** Estado dos controles da Inbox, como vive na URL. */
export interface ConversationFilterState {
  queue: ConversationQueue;
  statusKeys: string[];
  origins: OriginKind[];
  assignment: 'mine' | 'unassigned' | 'all';
  uf: Uf | 'all';
  instanceId?: string;
  q: string;
}

/** Traduz os chips de status da barra para os campos que a API entende. */
export function statusChipsToFilters(keys: string[]): {
  status?: ConversationStatus[];
  awaitingUs?: boolean;
  noResponse?: boolean;
} {
  const result: { status?: ConversationStatus[]; awaitingUs?: boolean; noResponse?: boolean } = {};
  const statusList: ConversationStatus[] = [];
  if (keys.includes('aguardando')) statusList.push('aguardando_atendimento');
  if (keys.includes('em_atendimento')) statusList.push('em_atendimento');
  if (keys.includes('encerrada')) statusList.push('encerrada');
  if (statusList.length) result.status = statusList;
  if (keys.includes('aguardando_nos')) result.awaitingUs = true;
  if (keys.includes('sem_retorno')) result.noResponse = true;
  return result;
}

/**
 * Monta os filtros enviados à API a partir do estado da tela.
 *
 * REGRA CENTRAL: havendo busca, ela vai sozinha. Nenhum outro filtro é
 * enviado — nem fila, nem instância, nem status.
 *
 * O motivo é que buscar um contato é procurar em TUDO. Antes, o termo entrava
 * como só mais uma condição AND: procurar um telefone dentro de "Comercial +
 * Aguardando" não achava a conversa se ela estivesse encerrada, e o usuário
 * não tinha como saber que o filtro é que estava escondendo.
 *
 * Os chips continuam na URL e voltam a valer assim que a busca é limpa — o que
 * muda é só o que é enviado. Quem exibe a barra deve sinalizar essa suspensão,
 * senão a tela mostra "Comercial + Aguardando" ativos enquanto lista uma
 * conversa encerrada da Recepção.
 */
export function buildConversationFilters(state: ConversationFilterState): ConversationFilters {
  const q = state.q.trim();
  if (q) return { q };

  return {
    queue: state.queue,
    ...statusChipsToFilters(state.statusKeys),
    origin: state.origins,
    assignment: state.assignment,
    uf: state.uf === 'all' ? undefined : state.uf,
    instanceId: state.instanceId,
  };
}
