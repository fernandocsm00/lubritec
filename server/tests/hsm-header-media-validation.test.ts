import { describe, it, expect } from 'vitest';
import { validateComponentsForMeta } from '../services/hsmComponents';
import type { HsmComponent } from '@shared/types';

// Regra: header de mídia (imagem/vídeo/documento) exige example.header_handle
// antes de submeter à Meta — senão a Meta rejeita a criação de forma opaca.
describe('validateComponentsForMeta — header de imagem', () => {
  const body: HsmComponent = { type: 'BODY', text: 'Olá, tudo certo?' };

  it('rejeita header de imagem sem header_handle', () => {
    const comps: HsmComponent[] = [{ type: 'HEADER', format: 'IMAGE' }, body];
    expect(() => validateComponentsForMeta(comps)).toThrow(/imagem precisa de uma imagem/i);
  });

  it('aceita header de imagem com header_handle preenchido', () => {
    const comps: HsmComponent[] = [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::abc=='] } },
      body,
    ];
    expect(() => validateComponentsForMeta(comps)).not.toThrow();
  });

  it('não exige handle para header de texto', () => {
    const comps: HsmComponent[] = [
      { type: 'HEADER', format: 'TEXT', text: 'Promoção' },
      body,
    ];
    expect(() => validateComponentsForMeta(comps)).not.toThrow();
  });
});
