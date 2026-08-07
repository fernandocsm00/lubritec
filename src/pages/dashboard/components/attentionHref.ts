import type { DashboardAttentionItem } from '@shared/types';

/**
 * Backend manda filter genericos (ex: { awaitingUs: true, status: 'aguardando_atendimento' })
 * mas o WhatsappPage le statusChips=<keys> (convenção de URL diferente). Faz a
 * traducao aqui pra que o link aplique o filtro de fato ao chegar na Inbox.
 *
 * Unica fonte da traducao filter -> href pros itens de "Atenção" do dashboard —
 * usado tanto pelo StatusRibbon (ribbon expandido) quanto pelo AttentionList
 * (card antigo). Antes cada um tinha sua propria copia e só uma delas traduzia
 * `awaitingUs`/`status` pra `statusChips`; a outra jogava o filter cru na URL e
 * o link caia numa Inbox sem filtro nenhum.
 *
 * Tabela de traducao (so /whatsapp; outras rotas passam filter cru):
 *  - awaitingUs=true                 -> statusChips=aguardando_nos
 *  - noResponse=true                 -> statusChips=sem_retorno
 *  - status=aguardando_atendimento   -> statusChips=aguardando
 *  - status=em_atendimento           -> statusChips=em_atendimento
 *  - status=encerrada                -> statusChips=encerrada
 *  - queue=*                         -> queue (mantem)
 *  - owner=me                        -> assignment=mine
 *
 * Chaves sem traducao conhecida (ex: `stage`, `stale` — usadas por /inside-sales)
 * caem no fallback: passam cru como query param, igual ao comportamento de hoje
 * pras rotas que não são /whatsapp.
 */
export function buildAttentionHref(item: DashboardAttentionItem): string {
  if (item.route !== '/whatsapp') {
    // Outras rotas (/inside-sales etc): passa filter cru sem traducao.
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(item.filter)) params.set(k, String(v));
    const qs = params.toString();
    return qs ? `${item.route}?${qs}` : item.route;
  }

  // Rota /whatsapp: traduz filter -> URL params que WhatsappPage le.
  const params = new URLSearchParams();
  const statusChips: string[] = [];
  for (const [k, v] of Object.entries(item.filter)) {
    if (k === 'awaitingUs' && v) statusChips.push('aguardando_nos');
    else if (k === 'noResponse' && v) statusChips.push('sem_retorno');
    else if (k === 'status') {
      const s = String(v);
      if (s === 'aguardando_atendimento') statusChips.push('aguardando');
      else if (s === 'em_atendimento') statusChips.push('em_atendimento');
      else if (s === 'encerrada') statusChips.push('encerrada');
    } else if (k === 'queue') {
      params.set('queue', String(v));
    } else if (k === 'owner' && v === 'me') {
      params.set('assignment', 'mine');
    }
    // Demais chaves desconhecidas sao ignoradas (defensivo).
  }
  if (statusChips.length > 0) {
    params.set('statusChips', statusChips.join(','));
  }
  // Origin amplo pra nao filtrar fora conversas vindas de campanha.
  if (!params.has('origin')) params.set('origin', 'organic,campaign');
  // Assignment default 'all' se nao foi setado explicitamente.
  if (!params.has('assignment')) params.set('assignment', 'all');

  const qs = params.toString();
  return qs ? `${item.route}?${qs}` : item.route;
}
