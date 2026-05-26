import { db } from '../db/client';
import { leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicLead } from '@shared/types';
import { lookupCnpj } from './cnpjLookup';
import { updateLead } from './leadsService';
import { detectTaxIdType } from '../lib/cnpj';

/**
 * Enriquecimento single-lead via BrasilAPI.
 *
 * Fluxo:
 *  1. Carrega lead. Erros: not_found, no_cnpj, already_has_phone.
 *  2. Consulta BrasilAPI pelo CNPJ.
 *  3. Se vier `telefone` (ddd_telefone_1 ou _2), preenche o phone via updateLead.
 *     updateLead promove flow_stage de 'incomplete' → 'complete' automaticamente.
 *  4. Retorna o resultado: phone_found / phone_not_in_brasilapi / cnpj_not_found / api_error.
 */

export type EnrichmentStatus =
  | 'phone_found'
  | 'phone_not_in_brasilapi'
  | 'cnpj_not_found'
  | 'cnpj_inactive'
  | 'api_error';

export interface EnrichmentResult {
  status: EnrichmentStatus;
  lead?: PublicLead;
  phoneFound?: string;
  errorMessage?: string;
  source: 'brasilapi';
}

function normalizeBrasilApiPhone(raw: string): string | null {
  // BrasilAPI devolve "5499456069" ou "(54) 99945-6069" ou "5499945-6069".
  // Removemos não-dígitos. Se vier sem DDI, prepend 55 (Brasil).
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) {
    // Sem DDI brasileiro — adiciona 55.
    return `55${digits}`;
  }
  if (digits.length === 12 || digits.length === 13) {
    // Já tem DDI (12 = fixo, 13 = celular).
    return digits;
  }
  return null;
}

export async function enrichLead(leadId: string): Promise<EnrichmentResult> {
  const [row] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!row) throw new HttpError(404, 'Lead not found');
  if (!row.cnpj) {
    throw new HttpError(400, 'Lead sem CNPJ — não é possível enriquecer pela BrasilAPI');
  }
  if (row.phone) {
    throw new HttpError(400, 'Lead já tem telefone cadastrado');
  }
  // BrasilAPI só suporta CNPJ; CPF nao pode ser enriquecido. Retorna um
  // status "soft" sem erro pra fila de bulk enrichment pular silenciosamente.
  if (detectTaxIdType(row.cnpj) === 'cpf') {
    return {
      status: 'phone_not_in_brasilapi',
      source: 'brasilapi',
      errorMessage: 'CPF nao eh enriquecivel via BrasilAPI',
    };
  }

  const result = await lookupCnpj(row.cnpj);

  if (result.status === 'not_found') {
    return { status: 'cnpj_not_found', source: 'brasilapi' };
  }
  if (result.status === 'inactive') {
    return {
      status: 'cnpj_inactive',
      source: 'brasilapi',
      errorMessage: result.situacaoCadastral ?? 'Situação não ativa',
    };
  }
  if (result.status === 'error') {
    return {
      status: 'api_error',
      source: 'brasilapi',
      errorMessage: result.errorMessage ?? 'Erro desconhecido na BrasilAPI',
    };
  }

  // status === 'active'
  if (!result.telefone) {
    return { status: 'phone_not_in_brasilapi', source: 'brasilapi' };
  }

  const normalized = normalizeBrasilApiPhone(result.telefone);
  if (!normalized) {
    return { status: 'phone_not_in_brasilapi', source: 'brasilapi' };
  }

  // updateLead já promove flow_stage de incomplete → complete quando phone é setado.
  const updated = await updateLead({ id: leadId, phone: normalized });
  return {
    status: 'phone_found',
    lead: updated,
    phoneFound: normalized,
    source: 'brasilapi',
  };
}
