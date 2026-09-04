import { describe, it, expect } from 'vitest';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createConversation, createMessage, createDeal,
} from './helpers';
import { getCampaignFunnel } from '../services/campaignsService';
import { buildCampaignReport } from '../services/campaignReportService';

/**
 * O relatório em Excel existe para responder "QUEM está em cada fase" — a tela
 * já responde "quantos". Por isso o teste central é de reconciliação: a
 * quantidade de linhas de cada aba tem que bater com o card correspondente do
 * funil. Se divergir, o usuário abre a planilha e não confia mais na tela.
 */
describe('buildCampaignReport', () => {
  /**
   * Cenário completo, com um lead em cada fase, montado uma vez e reusado pelos
   * testes de agrupamento.
   */
  async function seedFullScenario() {
    const u = await createUser({ email: `rep-${Date.now()}@x.com`, role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id, name: 'Relatório' });
    const sentAt = new Date(Date.now() - 60_000);

    // Enviado, respondeu, fechou negócio
    const ganhador = await createLead({ name: 'Ganhador', phone: '5511970000001' });
    await createCampaignRecipient({ campaignId: c.id, leadId: ganhador.id, status: 'sent', sentAt });
    const convG = await createConversation({ phone: ganhador.phone!, leadId: ganhador.id });
    await createMessage({ conversationId: convG.id, direction: 'in', body: 'quero', sentAt: new Date() });
    await createDeal({ leadId: ganhador.id, stage: 'ganho', proposalValue: 1500 });

    // Enviado, respondeu, perdeu
    const perdedor = await createLead({ name: 'Perdedor', phone: '5511970000002' });
    await createCampaignRecipient({ campaignId: c.id, leadId: perdedor.id, status: 'sent', sentAt });
    const convP = await createConversation({ phone: perdedor.phone!, leadId: perdedor.id });
    await createMessage({ conversationId: convP.id, direction: 'in', body: 'caro', sentAt: new Date() });
    await createDeal({ leadId: perdedor.id, stage: 'perdido', lossReason: 'preco' });

    // Enviado, NÃO respondeu, mas está em negociação (entrou pelo comercial)
    const negociando = await createLead({ name: 'Negociando', phone: '5511970000003' });
    await createCampaignRecipient({ campaignId: c.id, leadId: negociando.id, status: 'sent', sentAt });
    await createDeal({ leadId: negociando.id, stage: 'em_negociacao', proposalValue: 800 });

    const falhou = await createLead({ name: 'Falhou', phone: '5511970000004' });
    await createCampaignRecipient({
      campaignId: c.id, leadId: falhou.id, status: 'failed', failureReason: 'numero_invalido',
    });

    const pulado = await createLead({ name: 'Pulado', phone: '5511970000005' });
    await createCampaignRecipient({
      campaignId: c.id, leadId: pulado.id, status: 'skipped', failureReason: 'cooldown_24h',
    });

    const pendente = await createLead({ name: 'Pendente', phone: '5511970000006' });
    await createCampaignRecipient({ campaignId: c.id, leadId: pendente.id, status: 'pending' });

    return { campaignId: c.id };
  }

  /** Nomes dos leads de uma fase, ordenados — comparação estável. */
  function namesIn(report: Awaited<ReturnType<typeof buildCampaignReport>>, phase: string): string[] {
    return report.phases[phase as keyof typeof report.phases]
      .map((r) => r.leadName)
      .sort();
  }

  it('separa os destinatários por status de disparo', async () => {
    const { campaignId } = await seedFullScenario();

    const report = await buildCampaignReport(campaignId);

    expect(namesIn(report, 'enviados')).toEqual(['Ganhador', 'Negociando', 'Perdedor']);
    expect(namesIn(report, 'falhas')).toEqual(['Falhou']);
    expect(namesIn(report, 'pulados')).toEqual(['Pulado']);
    expect(namesIn(report, 'pendentes')).toEqual(['Pendente']);
  });

  it('separa quem respondeu de quem recebeu e ficou calado', async () => {
    const { campaignId } = await seedFullScenario();

    const report = await buildCampaignReport(campaignId);

    expect(namesIn(report, 'respondidas')).toEqual(['Ganhador', 'Perdedor']);
    expect(namesIn(report, 'sem_resposta')).toEqual(['Negociando']);
  });

  it('separa os negócios por etapa e carrega valor e motivo da perda', async () => {
    const { campaignId } = await seedFullScenario();

    const report = await buildCampaignReport(campaignId);

    expect(namesIn(report, 'em_negociacao')).toEqual(['Negociando']);
    expect(namesIn(report, 'ganho')).toEqual(['Ganhador']);
    expect(namesIn(report, 'perdido')).toEqual(['Perdedor']);
    expect(report.phases.ganho[0].proposalValue).toBe(1500);
    expect(report.phases.perdido[0].lossReason).toBe('preco');
  });

  it('a contagem de cada fase bate com o card do funil na tela', async () => {
    const { campaignId } = await seedFullScenario();

    const report = await buildCampaignReport(campaignId);
    const funnel = await getCampaignFunnel(campaignId);

    expect(report.phases.enviados.length).toBe(funnel.sent);
    expect(report.phases.falhas.length).toBe(funnel.failed);
    expect(report.phases.pulados.length).toBe(funnel.skipped);
    expect(report.phases.respondidas.length).toBe(funnel.replied);
    expect(report.phases.em_negociacao.length).toBe(funnel.inDeal);
    expect(report.phases.ganho.length).toBe(funnel.won);
    expect(report.phases.perdido.length).toBe(funnel.lost);
  });

  it('leva os dados cadastrais do cliente para a linha da fase', async () => {
    const u = await createUser({ email: `rep-cad-${Date.now()}@x.com`, role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });
    const lead = await createLead({
      name: 'Auto Peças Silva',
      phone: '5511970000010',
      cnpj: '12345678000199',
      city: 'Porto Alegre',
      imbp: '000011-PVL-REVENDA',
      segment: 'PVL',
    });
    await createCampaignRecipient({
      campaignId: c.id, leadId: lead.id, phone: lead.phone!, status: 'sent', sentAt: new Date(),
    });

    const report = await buildCampaignReport(c.id);

    expect(report.phases.enviados[0]).toMatchObject({
      leadName: 'Auto Peças Silva',
      cnpj: '12345678000199',
      phone: '5511970000010',
      city: 'Porto Alegre',
      imbp: '000011-PVL-REVENDA',
      segment: 'PVL',
    });
  });

  it('campanha sem destinatários devolve todas as fases vazias, não ausentes', async () => {
    const u = await createUser({ email: `rep-vazia-${Date.now()}@x.com`, role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id, name: 'Vazia' });

    const report = await buildCampaignReport(c.id);

    expect(report.campaign.name).toBe('Vazia');
    for (const rows of Object.values(report.phases)) {
      expect(rows).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Montagem da planilha
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import { campaignReportWorkbook, campaignReportFilename } from '../lib/campaignReportXlsx';
import type { CampaignReport } from '../services/campaignReportService';

/** Lê a aba de volta como matriz de strings — é assim que o usuário vai ver. */
function sheetRows(wb: ExcelJS.Workbook, name: string): unknown[][] {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`aba "${name}" não existe`);
  const out: unknown[][] = [];
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    out.push(values.slice(1)); // exceljs indexa a partir de 1
  });
  return out;
}

async function reportOf(campaignId: string): Promise<CampaignReport> {
  return buildCampaignReport(campaignId);
}

describe('campaignReportWorkbook', () => {
  async function seedOneOfEach() {
    const u = await createUser({ email: `wb-${Date.now()}@x.com`, role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id, name: 'Reativação Junho' });
    const sentAt = new Date('2026-06-10T12:00:00Z');

    const g = await createLead({
      name: 'Oficina Alfa', phone: '5511960000001', cnpj: '11222333000181',
      city: 'Canoas', imbp: '000011-PVL-REVENDA', segment: 'PVL',
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: g.id, phone: g.phone!, status: 'sent', sentAt });
    const conv = await createConversation({ phone: g.phone!, leadId: g.id });
    await createMessage({ conversationId: conv.id, direction: 'in', sentAt: new Date('2026-06-10T13:00:00Z') });
    await createDeal({ leadId: g.id, stage: 'ganho', proposalValue: 2400.5 });

    const f = await createLead({ name: 'Posto Beta', phone: '5511960000002' });
    await createCampaignRecipient({
      campaignId: c.id, leadId: f.id, phone: f.phone!, status: 'failed', failureReason: 'numero_invalido',
    });

    const p = await createLead({ name: 'Loja Gama', phone: '5511960000003' });
    await createCampaignRecipient({ campaignId: c.id, leadId: p.id, phone: p.phone!, status: 'sent', sentAt });
    await createDeal({ leadId: p.id, stage: 'perdido', lossReason: 'preco' });

    return c.id;
  }

  it('cria a aba de resumo e uma aba por fase, mesmo as vazias', async () => {
    const wb = campaignReportWorkbook(await reportOf(await seedOneOfEach()));

    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      'Resumo', 'Enviados', 'Falhas', 'Pulados', 'Pendentes',
      'Respondidas', 'Sem resposta', 'Em negociação', 'Ganho', 'Perdido',
    ]);
  });

  it('o resumo traz os dados da campanha e os números do funil', async () => {
    const wb = campaignReportWorkbook(await reportOf(await seedOneOfEach()));

    const flat = sheetRows(wb, 'Resumo').map((r) => r.map(String).join('|')).join('\n');
    expect(flat).toContain('Reativação Junho');
    expect(flat).toContain('Enviadas|2');
    expect(flat).toContain('Falhas|1');
    expect(flat).toContain('Ganho|1');
    expect(flat).toContain('Perdido|1');
  });

  it('lista os clientes da fase com as colunas de cadastro', async () => {
    const wb = campaignReportWorkbook(await reportOf(await seedOneOfEach()));

    const rows = sheetRows(wb, 'Enviados');
    expect(rows[0]).toEqual([
      'Cliente', 'CNPJ/CPF', 'Telefone', 'Cidade', 'IMBP', 'Segmento', 'Enviada em',
    ]);
    expect(rows.find((r) => r[0] === 'Oficina Alfa')).toEqual([
      'Oficina Alfa', '11222333000181', '5511960000001', 'Canoas',
      '000011-PVL-REVENDA', 'PVL', '10/06/2026 09:00',
    ]);
  });

  it('acrescenta a coluna de motivo nas falhas', async () => {
    const wb = campaignReportWorkbook(await reportOf(await seedOneOfEach()));

    const rows = sheetRows(wb, 'Falhas');
    expect(rows[0][rows[0].length - 1]).toBe('Motivo');
    expect(rows[1][rows[1].length - 1]).toBe('numero_invalido');
  });

  it('acrescenta valor no ganho e motivo da perda no perdido', async () => {
    const wb = campaignReportWorkbook(await reportOf(await seedOneOfEach()));

    const ganho = sheetRows(wb, 'Ganho');
    expect(ganho[0][ganho[0].length - 1]).toBe('Valor');
    expect(ganho[1][ganho[1].length - 1]).toBe(2400.5);

    const perdido = sheetRows(wb, 'Perdido');
    expect(perdido[0][perdido[0].length - 1]).toBe('Motivo da perda');
    expect(perdido[1][perdido[1].length - 1]).toBe('preco');
  });

  it('acrescenta a data da resposta nas respondidas', async () => {
    const wb = campaignReportWorkbook(await reportOf(await seedOneOfEach()));

    const rows = sheetRows(wb, 'Respondidas');
    expect(rows[0][rows[0].length - 1]).toBe('Respondeu em');
    expect(rows[1][rows[1].length - 1]).toBe('10/06/2026 10:00');
  });

  it('nomeia o arquivo pelo nome da campanha', async () => {
    const report = await reportOf(await seedOneOfEach());
    expect(campaignReportFilename(report.campaign)).toBe('relatorio-reativacao-junho.xlsx');
  });
});

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  const u = await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/campaigns/:id/relatorio.xlsx', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/campaigns/11111111-1111-4111-8111-111111111111/relatorio.xlsx');
    expect(res.status).toBe(401);
  });

  it('403 pra recepção', async () => {
    const { userId } = await loginAs('rel-admin@x.com', 'admin');
    const { token } = await loginAs('rel-recep@x.com', 'recepcao');
    const c = await createCampaign({ createdByUserId: userId });

    const res = await request(app)
      .get(`/api/campaigns/${c.id}/relatorio.xlsx`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('404 para campanha inexistente, em vez de planilha vazia', async () => {
    const { token } = await loginAs('rel-404@x.com', 'admin');

    const res = await request(app)
      .get('/api/campaigns/11111111-1111-4111-8111-111111111111/relatorio.xlsx')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('devolve um xlsx baixável com as abas do relatório', async () => {
    const { token, userId } = await loginAs('rel-ok@x.com', 'admin');
    const c = await createCampaign({ createdByUserId: userId, name: 'Reativação Julho' });
    const lead = await createLead({ name: 'Cliente Um', phone: '5511950000001' });
    await createCampaignRecipient({
      campaignId: c.id, leadId: lead.id, phone: lead.phone!, status: 'sent', sentAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/campaigns/${c.id}/relatorio.xlsx`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (ch: Buffer) => chunks.push(ch));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('relatorio-reativacao-julho.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    expect(wb.worksheets.map((ws) => ws.name)).toContain('Enviados');
    expect(sheetRows(wb, 'Enviados')[1][0]).toBe('Cliente Um');
  });
});

/**
 * O relatório não deduplica destinatário por lead, e isso só é correto porque o
 * banco garante a unicidade (UNIQUE (campaign_id, lead_id), migration 012).
 * Se alguém derrubar a constraint, a planilha passa a contar o mesmo cliente
 * duas vezes em silêncio — este teste é o alarme.
 */
describe('invariante: um destinatário por lead em cada campanha', () => {
  it('o banco recusa o segundo destinatário do mesmo lead', async () => {
    const u = await createUser({ email: 'uniq@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id });
    const l = await createLead({ phone: '5511900000001' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l.id, status: 'sent', sentAt: new Date() });

    await expect(
      createCampaignRecipient({ campaignId: c.id, leadId: l.id, status: 'sent', sentAt: new Date() }),
    ).rejects.toThrow();
  });
});
