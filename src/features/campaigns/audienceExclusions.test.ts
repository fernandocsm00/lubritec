import { describe, it, expect } from 'vitest';
import { mergeImportExclusions } from './audienceExclusions';

describe('mergeImportExclusions', () => {
  it('importar mantém as exclusões manuais', () => {
    expect(mergeImportExclusions(['manual-1', 'manual-2'], [], []).sort())
      .toEqual(['manual-1', 'manual-2']);
  });

  it('ligar "excluir quem já participou" soma às manuais', () => {
    expect(mergeImportExclusions(['manual-1'], [], ['dup-1', 'dup-2']).sort())
      .toEqual(['dup-1', 'dup-2', 'manual-1']);
  });

  it('desligar tira só as da importação, não as manuais', () => {
    expect(mergeImportExclusions(['manual-1', 'dup-1', 'dup-2'], ['dup-1', 'dup-2'], []))
      .toEqual(['manual-1']);
  });

  it('não duplica quem já estava excluído', () => {
    expect(mergeImportExclusions(['x'], [], ['x'])).toEqual(['x']);
  });
});
