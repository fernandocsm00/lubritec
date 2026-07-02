import type { Request, Response, NextFunction } from 'express';
import { eq, and, ne, count } from 'drizzle-orm';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db } from '../db/client';
import { whatsappInstance, conversations } from '../db/schema';
import { HttpError } from '../middleware/errorHandler';
import { encryptSecret } from '../lib/crypto';
import { resolveProvider, invalidateProvider } from '../services/whatsapp/providerRegistry';
import { uazapiConfigSchema } from '../services/whatsapp/uazapi/configSchema';
import type {
  InstanceListItem,
  InstanceDetailResponse,
  CreateInstanceRequest,
} from '@shared/types';

const createBodySchema = z.object({
  provider: z.enum(['uazapi', 'meta_cloud']),
  displayName: z.string().min(1).max(80),
  isDefault: z.boolean().optional(),
  uazapi: z.object({
    baseUrl: z.string().url().optional(),
    adminToken: z.string().optional(),
  }).optional(),
  metaCloud: z.object({
    wabaId: z.string().min(1),
    phoneNumberId: z.string().min(1),
    accessToken: z.string().min(1),
    appSecret: z.string().min(1),
  }).optional(),
});

const patchBodySchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

function toListItem(row: typeof whatsappInstance.$inferSelect): InstanceListItem {
  return {
    id: row.id,
    provider: row.provider as InstanceListItem['provider'],
    displayName: row.displayName,
    phoneNumber: row.phoneNumber,
    profileName: row.profileName,
    isDefault: row.isDefault,
    isArchived: row.isArchived,
    lastStatus: row.lastStatus,
    lastStatusAt: row.lastStatusAt?.toISOString() ?? null,
  };
}

export async function listHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.isArchived, false));
    res.json({ items: rows.map(toListItem) });
  } catch (e) { next(e); }
}

export async function detailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const [row] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!row) throw new HttpError(404, 'Instance not found');

    const provider = await resolveProvider(id);
    const live = await provider.getStatus();

    const body: InstanceDetailResponse = {
      ...toListItem(row),
      status: live.status,
      qrCode: live.qrCode,
    };
    if (row.provider === 'uazapi') {
      const cfg = uazapiConfigSchema.parse(row.providerConfig);
      body.uazapi = {
        baseUrl: cfg.baseUrl,
        webhookSynced: cfg.webhookSynced,
        webhookUrl: cfg.webhookUrl,
      };
    }
    res.json(body);
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const input: CreateInstanceRequest = createBodySchema.parse(req.body);

    if (input.provider === 'meta_cloud') {
      if (!input.metaCloud) {
        throw new HttpError(422, 'metaCloud config required for meta_cloud provider');
      }
      // Credenciais coladas do painel da Meta costumam vir com espaços/quebras
      // de linha. Sem trim, um token com \n quebra o header HTTP do fetch
      // ("Invalid header value") e o erro vira um 500 opaco. Trim resolve.
      const wabaId = input.metaCloud.wabaId.trim();
      const phoneNumberId = input.metaCloud.phoneNumberId.trim();
      const accessToken = input.metaCloud.accessToken.trim();
      const appSecret = input.metaCloud.appSecret.trim();
      if (!wabaId || !phoneNumberId || !accessToken || !appSecret) {
        throw new HttpError(422,
          'Todos os campos da Meta Cloud são obrigatórios (WABA ID, Phone Number ID, Access Token, App Secret).');
      }

      // Validate credentials by calling Meta Graph BEFORE inserting any row
      const { getPhoneNumberInfo, MetaGraphError } = await import(
        '../services/whatsapp/metaCloud/client'
      );
      let phoneInfo: { display_phone_number: string; verified_name: string; id: string };
      try {
        phoneInfo = await getPhoneNumberInfo({ phoneNumberId, accessToken });
      } catch (err) {
        if (err instanceof MetaGraphError) {
          throw new HttpError(422,
            `Validação das credenciais Meta falhou (HTTP ${err.status}). Verifique WABA ID, ` +
            `Phone Number ID e se o access token tem as permissões whatsapp_business_management/messaging.`,
          );
        }
        // Qualquer outra falha (timeout, DNS, header inválido) NÃO deve virar 500
        // opaco — devolve 422 com a causa pra UI mostrar algo acionável.
        const detail = err instanceof Error ? err.message : String(err);
        throw new HttpError(422, `Não foi possível validar as credenciais Meta: ${detail}`);
      }

      const verifyToken = crypto.randomBytes(32).toString('hex');
      const cfg = {
        wabaId,
        phoneNumberId,
        accessToken: encryptSecret(accessToken),
        appSecret: encryptSecret(appSecret),
        webhookVerifyToken: verifyToken,
        webhookSubscribed: false,
      };

      const [{ value: existingCount }] = await db
        .select({ value: count() }).from(whatsappInstance);
      const shouldBeDefault = (existingCount === 0) || input.isDefault === true;

      let createdRow: typeof whatsappInstance.$inferSelect | undefined;
      await db.transaction(async (tx) => {
        if (shouldBeDefault) {
          await tx.update(whatsappInstance)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(whatsappInstance.isDefault, true));
        }
        const [row] = await tx.insert(whatsappInstance).values({
          provider: 'meta_cloud',
          displayName: input.displayName,
          isDefault: shouldBeDefault,
          phoneNumber: phoneInfo.display_phone_number,
          profileName: phoneInfo.verified_name,
          lastStatus: 'connected',
          lastStatusAt: new Date(),
          providerConfig: cfg,
        }).returning();
        createdRow = row;
      });

      if (!createdRow) throw new HttpError(500, 'Insert returned no row');
      return res.status(201).json(toListItem(createdRow));
    }

    // UazAPI
    const baseUrl = input.uazapi?.baseUrl
      ?? process.env.UAZAPI_BASE_URL ?? 'https://api.uazapi.com';
    const adminToken = input.uazapi?.adminToken
      ?? process.env.UAZAPI_ADMIN_TOKEN ?? process.env.UAZAPI_TOKEN ?? null;

    const cfg = {
      baseUrl,
      instanceId: null,
      instanceToken: adminToken ? encryptSecret(adminToken) : null,
      webhookSecret: null,
      webhookUrl: null,
      webhookSynced: false,
    };

    const [{ value: existingCount }] = await db
      .select({ value: count() }).from(whatsappInstance);
    const shouldBeDefault = (existingCount === 0) || input.isDefault === true;

    let createdRow: typeof whatsappInstance.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.update(whatsappInstance)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(whatsappInstance.isDefault, true));
      }
      const [row] = await tx.insert(whatsappInstance).values({
        provider: 'uazapi',
        displayName: input.displayName,
        isDefault: shouldBeDefault,
        providerConfig: cfg,
      }).returning();
      createdRow = row;
    });

    if (!createdRow) throw new HttpError(500, 'Insert returned no row');
    res.status(201).json(toListItem(createdRow));
  } catch (e) {
    if (e instanceof z.ZodError) return next(new HttpError(422, e.issues[0].message));
    next(e);
  }
}

export async function patchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const patch = patchBodySchema.parse(req.body);
    const [existing] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!existing) throw new HttpError(404, 'Instance not found');

    await db.transaction(async (tx) => {
      if (patch.isDefault === true) {
        await tx.update(whatsappInstance)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(whatsappInstance.isDefault, true), ne(whatsappInstance.id, id)));
      }
      await tx.update(whatsappInstance).set({
        displayName: patch.displayName ?? existing.displayName,
        isDefault: patch.isDefault ?? existing.isDefault,
        isArchived: patch.isArchived ?? existing.isArchived,
        updatedAt: new Date(),
      }).where(eq(whatsappInstance.id, id));
    });

    invalidateProvider(id);
    const [updated] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!updated) throw new HttpError(500, 'Update lost the row');
    res.json(toListItem(updated));
  } catch (e) {
    if (e instanceof z.ZodError) return next(new HttpError(422, e.issues[0].message));
    next(e);
  }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const [{ value: convCount }] = await db.select({ value: count() }).from(conversations)
      .where(eq(conversations.instanceId, id));
    if (convCount > 0) {
      throw new HttpError(409,
        `Há ${convCount} conversa(s) vinculada(s) a essa linha. Arquive em vez de excluir.`);
    }
    await db.delete(whatsappInstance).where(eq(whatsappInstance.id, id));
    invalidateProvider(id);
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function connectInstanceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const [row] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!row) throw new HttpError(404, 'Instance not found');

    if (row.provider === 'meta_cloud') {
      const provider = await resolveProvider(id);
      const live = await provider.getStatus();
      await db.update(whatsappInstance).set({
        lastStatus: live.status,
        lastStatusAt: new Date(),
        phoneNumber: live.phoneNumber ?? row.phoneNumber,
        profileName: live.profileName ?? row.profileName,
        updatedAt: new Date(),
      }).where(eq(whatsappInstance.id, id));
      invalidateProvider(id);
      return res.json({
        status: live.status,
        qrCode: live.qrCode,
        phoneNumber: live.phoneNumber ?? row.phoneNumber,
        profileName: live.profileName ?? row.profileName,
        lastStatusAt: live.lastCheckedAt,
      });
    }

    if (!row.isDefault) {
      throw new HttpError(501,
        'Connect for non-default instances will be supported in a follow-up. ' +
        'Mark as default first.');
    }
    const { connect } = await import('../services/whatsappInstanceService');
    const result = await connect({});
    invalidateProvider(id);
    res.json(result);
  } catch (e) { next(e); }
}

export async function webhookInfoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const [row] = await db.select().from(whatsappInstance)
      .where(eq(whatsappInstance.id, id)).limit(1);
    if (!row) throw new HttpError(404, 'Instance not found');
    if (row.provider !== 'meta_cloud') {
      throw new HttpError(400, 'webhook-info is only available for meta_cloud provider');
    }
    const { metaCloudConfigSchema } = await import('../services/whatsapp/metaCloud/configSchema');
    const cfg = metaCloudConfigSchema.parse(row.providerConfig);
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const body = {
      callbackUrl: `${appUrl.replace(/\/$/, '')}/api/whatsapp/webhook/meta/${id}`,
      verifyToken: cfg.webhookVerifyToken,
      subscribed: cfg.webhookSubscribed,
    };
    res.json(body);
  } catch (e) { next(e); }
}
