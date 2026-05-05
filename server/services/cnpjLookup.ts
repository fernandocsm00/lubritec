/**
 * BrasilAPI CNPJ lookup. Free, no auth, ~3 req/min limit.
 * Docs: https://brasilapi.com.br/docs#tag/CNPJ
 *
 * Returns a normalized result with the fields the import pipeline needs.
 * Network or API failures map to status 'error' so the caller can keep going
 * and surface the row in the rejection report rather than aborting the batch.
 */

import { normalizeCnpj } from '../lib/cnpj';

export type CnpjLookupStatus = 'active' | 'inactive' | 'not_found' | 'error';

export interface CnpjLookupResult {
  cnpj: string;
  status: CnpjLookupStatus;
  razaoSocial: string | null;
  situacaoCadastral: string | null;
  telefone: string | null;
  errorMessage?: string;
}

const BRASILAPI_BASE = 'https://brasilapi.com.br/api/cnpj/v1';
const REQUEST_TIMEOUT_MS = 8000;

interface BrasilApiResponse {
  cnpj: string;
  razao_social?: string;
  descricao_situacao_cadastral?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
}

export async function lookupCnpj(rawCnpj: string): Promise<CnpjLookupResult> {
  const cnpj = normalizeCnpj(rawCnpj);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BRASILAPI_BASE}/${cnpj}`, {
      signal: controller.signal,
    });

    if (res.status === 404) {
      return {
        cnpj,
        status: 'not_found',
        razaoSocial: null,
        situacaoCadastral: null,
        telefone: null,
      };
    }

    if (!res.ok) {
      return {
        cnpj,
        status: 'error',
        razaoSocial: null,
        situacaoCadastral: null,
        telefone: null,
        errorMessage: `BrasilAPI ${res.status}`,
      };
    }

    const data = (await res.json()) as BrasilApiResponse;
    const situacao = (data.descricao_situacao_cadastral ?? '').toUpperCase();
    const isActive = situacao === 'ATIVA';

    return {
      cnpj,
      status: isActive ? 'active' : 'inactive',
      razaoSocial: data.razao_social ?? null,
      situacaoCadastral: data.descricao_situacao_cadastral ?? null,
      telefone: data.ddd_telefone_1 ?? data.ddd_telefone_2 ?? null,
    };
  } catch (err) {
    return {
      cnpj,
      status: 'error',
      razaoSocial: null,
      situacaoCadastral: null,
      telefone: null,
      errorMessage: err instanceof Error ? err.message : 'unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
