import { HttpError } from '../middleware/errorHandler';
import type { HsmComponent, HsmBody } from '@shared/types';

/** Texto do BODY de um template HSM (a mensagem principal). '' se não houver. */
export function hsmBodyText(components: HsmComponent[]): string {
  const body = components.find((c) => c.type === 'BODY');
  return body && 'text' in body ? body.text : '';
}

/** Count unique {{N}} placeholders in the BODY component of an HSM template. */
export function countBodyVariables(components: HsmComponent[]): number {
  for (const c of components) {
    if (c.type === 'BODY') {
      const matches = c.text.match(/\{\{\d+\}\}/g);
      return matches ? new Set(matches).size : 0;
    }
  }
  return 0;
}

/**
 * Remove componentes que a Meta rejeita por estarem "vazios":
 * - HEADER de texto sem `text` (subcode 2388043 — "HEADER não contém o campo text")
 * - FOOTER sem texto
 * - grupo de BUTTONS sem botões
 * Sempre aplicado (draft e submissão) pra que o registro salvo já fique limpo.
 */
export function sanitizeComponents(components: HsmComponent[]): HsmComponent[] {
  return components.filter((c) => {
    if (c.type === 'HEADER' && c.format === 'TEXT' && !c.text?.trim()) return false;
    if (c.type === 'FOOTER' && !c.text?.trim()) return false;
    if (c.type === 'BUTTONS' && (!c.buttons || c.buttons.length === 0)) return false;
    return true;
  });
}

/**
 * Valida as regras da Meta que causam rejeição no submit. Só roda quando o
 * template vai de fato para a Meta (submitNow), não no rascunho.
 */
export function validateComponentsForMeta(components: HsmComponent[]): void {
  const body = components.find((c): c is HsmBody => c.type === 'BODY');
  if (!body || !body.text.trim()) {
    throw new HttpError(422, 'O template precisa de um BODY com texto.');
  }

  // Header de mídia (imagem/vídeo/documento) exige example.header_handle — a
  // amostra que a Meta usa pra aprovar. Sem ela a Meta rejeita de forma opaca.
  const header = components.find((c) => c.type === 'HEADER');
  if (
    header?.type === 'HEADER' &&
    header.format !== 'TEXT' &&
    !(header.example?.header_handle?.[0])
  ) {
    throw new HttpError(422, 'O header de imagem precisa de uma imagem enviada antes de submeter à Meta.');
  }

  // Placeholders precisam ser numéricos: {{1}}, {{2}}, … ({{nome}} é inválido na Meta)
  const placeholders = body.text.match(/\{\{[^}]*\}\}/g) ?? [];
  const nonNumeric = [...new Set(placeholders.filter((p) => !/^\{\{\s*\d+\s*\}\}$/.test(p)))];
  if (nonNumeric.length > 0) {
    throw new HttpError(
      422,
      `Variáveis do BODY devem ser numéricas ({{1}}, {{2}}, …). Inválidas: ${nonNumeric.join(', ')}`,
    );
  }

  // Devem ser sequenciais começando em {{1}}
  const nums = [...new Set(placeholders.map((p) => parseInt(p.replace(/[^\d]/g, ''), 10)))]
    .sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      throw new HttpError(
        422,
        `Variáveis do BODY devem ser sequenciais começando em {{1}} (encontrado: ${nums.join(', ') || 'nenhuma'}).`,
      );
    }
  }

  // Cada variável precisa de um exemplo preenchido
  if (nums.length > 0) {
    const examples = body.example?.body_text?.[0] ?? [];
    const incomplete = examples.length < nums.length
      || examples.slice(0, nums.length).some((e) => !e?.trim());
    if (incomplete) {
      throw new HttpError(422, 'Preencha um exemplo para cada variável do BODY antes de enviar à Meta.');
    }
  }
}
