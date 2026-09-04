import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'node:path';
import { toCsv } from '../lib/csv';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_VALIDITY_FILTERS,
  LEAD_STATUSES,
  LEAD_SOURCES,
  IMBP_VALUES,
  SEGMENT_VALUES,
  type CampaignHsmVariable,
} from '../../shared/types';
import {
  listCampaigns,
  getCampaignById,
  createCampaign,
  dispatchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  deleteCampaign,
  listRecipients,
  getCampaignFunnel,
  getCampaignFunnelsBatch,
  listAllCampaignsForExport,
  listAllRecipientsForExport,
  getCampaignsAggregateStats,
  getCampaignsTimeseries,
  getTopCampaigns,
  listCampaignReportCities,
} from '../services/campaignsService';
import { buildCampaignReport } from '../services/campaignReportService';
import { campaignReportWorkbook, campaignReportFilename } from '../lib/campaignReportXlsx';
import { dryRun } from '../services/campaignsAudience';
import { importCampaignAudience } from '../services/campaignAudienceImport';
import { startScopedEnrichment } from '../services/enrichmentJobs';
import { HttpError } from '../middleware/errorHandler';
import { resolvePeriod, type PeriodKey } from '../lib/period';

const idParams = z.object({ id: z.string().uuid() });

const audienceFilterSchema = z.object({
  status: z.array(z.enum(LEAD_STATUSES)).optional(),
  source: z.array(z.enum(LEAD_SOURCES)).optional(),
  daysSinceCreated: z.number().int().min(0).max(3650).optional(),
  excludeLeadIds: z.array(z.string().uuid()).optional(),
  phoneCsv: z.array(z.string().min(8).max(20)).optional(),
  importedLeadIds: z.array(z.string().uuid()).optional(),
});

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  validity: z.enum(CAMPAIGN_VALIDITY_FILTERS).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

const hsmVariableSchema = z.object({
  index: z.number().int().min(1),
  source: z.enum(['static', 'lead_field']),
  value: z.string(),
});

const createBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  instanceId: z.string().min(1, 'instanceId is required'),
  templateId: z.string().uuid().nullable().optional(),
  hsmTemplateId: z.string().uuid().nullable().optional(),
  hsmVariables: z.array(hsmVariableSchema).optional(),
  messageBody: z.string().min(0).max(4000).optional(),
  mediaUrl: z.string().nullable().optional(),
  mediaMime: z.string().max(60).nullable().optional(),
  audienceFilter: audienceFilterSchema,
  scheduledAt: z.string().datetime().nullable().optional(),
  // Vigência comercial. Em branco, o serviço aplica o default de 7 dias.
  validityStart: z.string().datetime().nullable().optional(),
  validityEnd: z.string().datetime().nullable().optional(),
  ratePerMinute: z.number().int().min(1).max(120).optional(),
  qualificationQuestion: z.string().trim().max(500).nullable().optional(),
});

const recipientsQuery = z.object({
  status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    res.json(await listCampaigns(params));
  } catch (e) { next(e); }
}

// Filtros opcionais comuns aos 3 endpoints de relatório. Sliceiam metricas
// pelos atributos dos LEADS destinatários (campaigns nao tem essas colunas).
const reportFilterSchema = {
  imbp: z.enum(IMBP_VALUES).optional(),
  segment: z.enum(SEGMENT_VALUES).optional(),
  city: z.string().trim().min(1).max(120).optional(),
};

const aggregateStatsQuery = z.object({
  period: z.enum(['today', '7d', 'month', '30d', 'quarter']).optional(),
  kind: z.enum(['all', 'one_shot', 'continuous']).optional(),
  compare: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...reportFilterSchema,
});

export async function aggregateStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = aggregateStatsQuery.parse(req.query);
    const periodKey: PeriodKey = q.period ?? '30d';
    const range = resolvePeriod(periodKey);
    const kind = q.kind ?? 'all';
    const leadFilters = { imbp: q.imbp, segment: q.segment, city: q.city };

    const current = await getCampaignsAggregateStats({
      start: range.start,
      end: range.end,
      kind,
      ...leadFilters,
    });
    const base = {
      ...current,
      period: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        key: range.key,
        label: range.label,
      },
      kind,
    };
    if (!q.compare) {
      res.json(base);
      return;
    }
    const prev = await getCampaignsAggregateStats({
      start: range.prevStart,
      end: range.prevEnd,
      kind,
      ...leadFilters,
    });
    res.json({
      ...base,
      compareWith: {
        ...prev,
        period: {
          start: range.prevStart.toISOString(),
          end: range.prevEnd.toISOString(),
          key: range.key,
          label: 'Período anterior',
        },
        kind,
      },
    });
  } catch (e) { next(e); }
}

const timeseriesQuery = z.object({
  period: z.enum(['today', '7d', 'month', '30d', 'quarter']).optional(),
  kind: z.enum(['all', 'one_shot', 'continuous']).optional(),
  ...reportFilterSchema,
});

export async function timeseriesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = timeseriesQuery.parse(req.query);
    const periodKey: PeriodKey = q.period ?? '30d';
    const range = resolvePeriod(periodKey);
    const buckets = await getCampaignsTimeseries({
      start: range.start,
      end: range.end,
      kind: q.kind ?? 'all',
      imbp: q.imbp,
      segment: q.segment,
      city: q.city,
    });
    res.json({
      buckets,
      period: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        key: range.key,
        label: range.label,
      },
    });
  } catch (e) { next(e); }
}

const topQuery = z.object({
  period: z.enum(['today', '7d', 'month', '30d', 'quarter']).optional(),
  kind: z.enum(['all', 'one_shot', 'continuous']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  ...reportFilterSchema,
});

export async function topCampaignsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = topQuery.parse(req.query);
    const periodKey: PeriodKey = q.period ?? '30d';
    const range = resolvePeriod(periodKey);
    const items = await getTopCampaigns({
      start: range.start,
      end: range.end,
      kind: q.kind ?? 'all',
      limit: q.limit ?? 5,
      imbp: q.imbp,
      segment: q.segment,
      city: q.city,
    });
    res.json({
      items,
      period: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        key: range.key,
        label: range.label,
      },
    });
  } catch (e) { next(e); }
}

// Lista cidades distintas (com contagem de leads) que aparecem em recipients de
// campanhas. Alimenta o combobox de Cidade no filtro do relatório.
export async function reportCitiesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const items = await listCampaignReportCities();
    res.json({ items });
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const campaign = await getCampaignById(id);
    const funnel = await getCampaignFunnel(id);
    res.json({ ...campaign, funnel });
  } catch (e) { next(e); }
}

const dryRunOptsSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export async function dryRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = audienceFilterSchema.parse(req.body);
    // page/pageSize vem do query string (opcional, default page=1, pageSize=50).
    const opts = dryRunOptsSchema.parse(req.query);
    res.json(await dryRun(filters, opts));
  } catch (e) { next(e); }
}

export async function importAudienceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new HttpError(400, 'Nenhum arquivo enviado (campo "file").');
    const result = await importCampaignAudience(req.file.buffer, req.user!.userId);
    res.json(result);
  } catch (e) { next(e); }
}

const enrichAudienceBody = z.object({
  leadIds: z.array(z.string().uuid()).min(1, 'Nenhum lead para enriquecer.'),
});

export async function enrichAudienceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadIds } = enrichAudienceBody.parse(req.body);
    const job = await startScopedEnrichment(leadIds, 'phone2', req.user!.userId);
    res.status(201).json(job);
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createBody.parse(req.body);
    const created = await createCampaign({
      name: data.name,
      description: data.description ?? null,
      instanceId: data.instanceId,
      templateId: data.templateId ?? null,
      hsmTemplateId: data.hsmTemplateId ?? null,
      hsmVariables: (data.hsmVariables ?? []) as CampaignHsmVariable[],
      messageBody: data.messageBody ?? '',
      mediaUrl: data.mediaUrl ?? null,
      mediaMime: data.mediaMime ?? null,
      audienceFilter: data.audienceFilter,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      validityStart: data.validityStart ? new Date(data.validityStart) : null,
      validityEnd: data.validityEnd ? new Date(data.validityEnd) : null,
      ratePerMinute: data.ratePerMinute,
      createdByUserId: req.user!.userId,
      qualificationQuestion: data.qualificationQuestion ?? null,
    });
    res.status(201).json(created);
  } catch (e) { next(e); }
}

export async function dispatchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await dispatchCampaign(id));
  } catch (e) { next(e); }
}

export async function pauseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await pauseCampaign(id));
  } catch (e) { next(e); }
}

export async function resumeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await resumeCampaign(id));
  } catch (e) { next(e); }
}

export async function cancelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await cancelCampaign(id));
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteCampaign(id);
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function recipientsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const params = recipientsQuery.parse(req.query);
    res.json(await listRecipients({ campaignId: id, ...params }));
  } catch (e) { next(e); }
}

// Diretorio onde as imagens re-encodadas vao parar. Servido via express.static
// em /uploads/campaigns/.
const CAMPAIGN_MEDIA_DIR = path.join(process.cwd(), 'uploads', 'campaigns');
// Limite de dimensao pra evitar enviar imagem 4000x3000 desnecessariamente
// pesada ao WhatsApp — 1600px e o sweet spot da Meta.
const MAX_IMAGE_DIMENSION = 1600;

export async function uploadMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Invalid or missing file' });
    }

    // Garante que o diretorio existe (era criado pelo multer disk storage antes;
    // agora que mudamos pra memory storage, criamos aqui se nao existir).
    await fs.mkdir(CAMPAIGN_MEDIA_DIR, { recursive: true });

    // Re-encoda pra JPEG normalizado (sRGB, strip EXIF, max 1600px). Isso resolve:
    //   - HEIC/AVIF/WebP renomeados como .png que UazAPI rejeita
    //   - PNG 16-bit ou APNG que decoders simples nao suportam
    //   - Imagens enormes que estouram limites do WhatsApp
    // Se sharp nao decodificar (formato realmente exotico/corrompido), erra
    // aqui e retornamos 400 amigavel — vendedor nao descobre so no disparo.
    const filename = `${crypto.randomBytes(16).toString('hex')}.jpg`;
    const outPath = path.join(CAMPAIGN_MEDIA_DIR, filename);

    try {
      await sharp(req.file.buffer, { failOn: 'truncated' })
        .rotate() // respeita EXIF orientation antes de remover metadados
        .resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(outPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[campaigns:upload-media] sharp failed:', msg);
      return res.status(400).json({
        error: 'Formato de imagem não suportado. Use JPG, PNG ou WebP.',
      });
    }

    res.json({
      mediaUrl: `/uploads/campaigns/${filename}`,
      mediaMime: 'image/jpeg',
    });
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Exportação CSV
//
// Duas exportações, espelhando os dois níveis de dado da tela de detalhe: o
// resumo por campanha (métricas do funil) e a lista de destinatários. Ambas
// ignoram paginação de propósito — o usuário quer a planilha inteira, não a
// página que está vendo — e respeitam os mesmos filtros da tela.
// ---------------------------------------------------------------------------

/** Formata data para o CSV em pt-BR (a planilha é lida por humanos, não por máquina). */
function csvDateTime(value: Date | string | null): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Situação da vigência no momento da exportação. */
function validityLabel(end: Date | null): string {
  if (!end) return 'sem vigência';
  return end.getTime() >= Date.now() ? 'vigente' : 'expirada';
}

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

const CAMPAIGNS_CSV_HEADERS = [
  'nome', 'status', 'tipo', 'criada_em', 'agendada_para',
  'vigencia_inicio', 'vigencia_fim', 'vigencia_situacao',
  'total_destinatarios', 'enviadas', 'falhas', 'pulados',
  'pulados_cooldown', 'pulados_outros', 'respondidas',
  'em_negociacao', 'ganho', 'perdido', 'valor_ganho',
];

export async function exportCampaignsCsvHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, status } = listQuery.parse(req.query);
    const rows = await listAllCampaignsForExport({ q, status });
    const funnels = await getCampaignFunnelsBatch(rows.map((r) => r.id));

    const body = rows.map((c) => {
      const f = funnels.get(c.id);
      return [
        c.name,
        c.status,
        c.isContinuous ? 'contínua' : 'disparo único',
        csvDateTime(c.createdAt),
        csvDateTime(c.scheduledAt),
        csvDateTime(c.validityStart),
        csvDateTime(c.validityEnd),
        validityLabel(c.validityEnd),
        f?.totalRecipients ?? 0,
        f?.sent ?? 0,
        f?.failed ?? 0,
        f?.skipped ?? 0,
        f?.skippedByCooldown ?? 0,
        f?.skippedOther ?? 0,
        f?.replied ?? 0,
        f?.inDeal ?? 0,
        f?.won ?? 0,
        f?.lost ?? 0,
        // Vírgula decimal: é assim que o Excel pt-BR entende número.
        (f?.totalWonValue ?? 0).toFixed(2).replace('.', ','),
      ];
    });

    sendCsv(res, 'campanhas.csv', toCsv(CAMPAIGNS_CSV_HEADERS, body));
  } catch (e) { next(e); }
}

export async function exportRecipientsCsvHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { status } = recipientsQuery.parse(req.query);
    // Valida a existência antes de exportar: campanha inexistente deve dar 404,
    // não um CSV vazio que o usuário confundiria com "nenhum destinatário".
    const campaign = await getCampaignById(id);
    const rows = await listAllRecipientsForExport({ campaignId: id, status });

    const body = rows.map((r) => [
      r.leadName,
      r.phone,
      r.status,
      csvDateTime(r.sentAt),
      r.failureReason ?? '',
    ]);

    const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campanha';
    sendCsv(res, `destinatarios-${slug}.csv`, toCsv(['lead', 'telefone', 'status', 'enviada_em', 'erro'], body));
  } catch (e) { next(e); }
}

/**
 * Relatório completo da campanha em Excel. Diferente do CSV de destinatários,
 * que só diz o status do disparo, aqui cada fase do funil vira uma aba com os
 * clientes nominais — a pergunta que a tela não responde é "quem são os 4 que
 * fecharam", não "quantos fecharam".
 */
export async function exportCampaignReportXlsxHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const report = await buildCampaignReport(id);
    const buffer = await campaignReportWorkbook(report).xlsx.writeBuffer();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${campaignReportFilename(report.campaign)}"`,
    );
    res.send(Buffer.from(buffer));
  } catch (e) { next(e); }
}
