import ExcelJS from 'exceljs';
import type { PublicCampaign } from '@shared/types';
import type {
  CampaignReport,
  CampaignReportPhase,
  CampaignReportRow,
} from '../services/campaignReportService';

/**
 * Monta o relatório de campanha em Excel: uma aba de resumo (o que a tela já
 * mostra) e uma aba por fase do funil listando NOMINALMENTE os clientes.
 *
 * A planilha é lida por humanos, não por máquina — datas em pt-BR, valores como
 * número de verdade (pra somar no Excel) e abas vazias mantidas, porque uma aba
 * ausente faria o usuário achar que o relatório veio incompleto.
 */

const TZ = 'America/Sao_Paulo';

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "10/06/2026 09:00" — sem a vírgula que o toLocaleString insere. */
function brDateTime(value: Date | string | null): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(
    dateTimeFormat.formatToParts(d).map((part) => [part.type, part.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const BASE_HEADERS = ['Cliente', 'CNPJ/CPF', 'Telefone', 'Cidade', 'IMBP', 'Segmento', 'Enviada em'];

/** Larguras fixas: o auto-fit do Excel não roda em arquivo gerado. */
const BASE_WIDTHS = [34, 20, 18, 20, 26, 12, 18];

/**
 * Nome visível da aba e as colunas que só fazem sentido naquela fase. A ordem
 * aqui é a ordem das abas no arquivo.
 */
const PHASE_SHEETS: Array<{
  phase: CampaignReportPhase;
  title: string;
  extraHeaders: string[];
  extraWidths: number[];
  extras: (row: CampaignReportRow) => unknown[];
}> = [
  { phase: 'enviados', title: 'Enviados', extraHeaders: [], extraWidths: [], extras: () => [] },
  {
    phase: 'falhas',
    title: 'Falhas',
    extraHeaders: ['Motivo'],
    extraWidths: [30],
    extras: (r) => [r.failureReason ?? ''],
  },
  {
    phase: 'pulados',
    title: 'Pulados',
    extraHeaders: ['Motivo'],
    extraWidths: [30],
    extras: (r) => [r.failureReason ?? ''],
  },
  { phase: 'pendentes', title: 'Pendentes', extraHeaders: [], extraWidths: [], extras: () => [] },
  {
    phase: 'respondidas',
    title: 'Respondidas',
    extraHeaders: ['Respondeu em'],
    extraWidths: [18],
    extras: (r) => [brDateTime(r.repliedAt)],
  },
  {
    phase: 'sem_resposta',
    title: 'Sem resposta',
    extraHeaders: [],
    extraWidths: [],
    extras: () => [],
  },
  {
    phase: 'em_negociacao',
    title: 'Em negociação',
    extraHeaders: ['Etapa', 'Valor'],
    extraWidths: [22, 14],
    extras: (r) => [r.dealStage ?? '', r.proposalValue ?? ''],
  },
  {
    phase: 'ganho',
    title: 'Ganho',
    extraHeaders: ['Valor'],
    extraWidths: [14],
    extras: (r) => [r.proposalValue ?? ''],
  },
  {
    phase: 'perdido',
    title: 'Perdido',
    extraHeaders: ['Motivo da perda'],
    extraWidths: [24],
    extras: (r) => [r.lossReason ?? ''],
  },
];

function styleHeader(ws: ExcelJS.Worksheet): void {
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' }, // lubritec-blue
  };
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function addResumo(wb: ExcelJS.Workbook, report: CampaignReport): void {
  const { campaign, funnel, phases } = report;
  const ws = wb.addWorksheet('Resumo');
  ws.columns = [{ width: 28 }, { width: 40 }];

  const rows: Array<[string, unknown]> = [
    ['Campanha', campaign.name],
    ['Status', campaign.status],
    ['Tipo', campaign.isContinuous ? 'contínua' : 'disparo único'],
    ['Criada em', brDateTime(campaign.createdAt)],
    ['Agendada para', brDateTime(campaign.scheduledAt)],
    ['Vigência início', brDateTime(campaign.validityStart)],
    ['Vigência fim', brDateTime(campaign.validityEnd)],
    ['Vigência', validityLabel(campaign.validityEnd)],
    ['', ''],
    ['Destinatários', funnel.totalRecipients],
    ['Enviadas', funnel.sent],
    ['Falhas', funnel.failed],
    ['Pulados', funnel.skipped],
    ['— por cooldown 24h', funnel.skippedByCooldown],
    ['— outros motivos', funnel.skippedOther],
    ['Respondidas', funnel.replied],
    ['Sem resposta', phases.sem_resposta.length],
    ['Em negociação', funnel.inDeal],
    ['Ganho', funnel.won],
    ['Perdido', funnel.lost],
    ['Valor total ganho', funnel.totalWonValue],
  ];

  for (const [label, value] of rows) {
    const row = ws.addRow([label, value]);
    if (label.startsWith('—')) row.getCell(1).font = { italic: true, color: { argb: 'FF666666' } };
    else if (label) row.getCell(1).font = { bold: true };
  }
  ws.getCell(`B${rows.length}`).numFmt = '#,##0.00';
}

/** Situação da vigência no momento da exportação. */
function validityLabel(end: string | null): string {
  if (!end) return 'sem vigência';
  return new Date(end).getTime() >= Date.now() ? 'vigente' : 'expirada';
}

export function campaignReportWorkbook(report: CampaignReport): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LubriConnect';
  wb.created = new Date();

  addResumo(wb, report);

  for (const spec of PHASE_SHEETS) {
    const ws = wb.addWorksheet(spec.title);
    ws.columns = [...BASE_WIDTHS, ...spec.extraWidths].map((width) => ({ width }));
    ws.addRow([...BASE_HEADERS, ...spec.extraHeaders]);
    styleHeader(ws);

    for (const r of report.phases[spec.phase]) {
      ws.addRow([
        r.leadName,
        r.cnpj ?? '',
        r.phone ?? '',
        r.city ?? '',
        r.imbp ?? '',
        r.segment ?? '',
        brDateTime(r.sentAt),
        ...spec.extras(r),
      ]);
    }

    // Valor é dinheiro: formata a coluna inteira em vez de célula a célula.
    const valorIndex = spec.extraHeaders.indexOf('Valor');
    if (valorIndex >= 0) {
      ws.getColumn(BASE_HEADERS.length + valorIndex + 1).numFmt = '#,##0.00';
    }
  }

  return wb;
}

/** relatorio-reativacao-junho.xlsx — sem acento, que Content-Disposition não carrega bem. */
export function campaignReportFilename(campaign: PublicCampaign): string {
  const slug = campaign.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `relatorio-${slug || 'campanha'}.xlsx`;
}
