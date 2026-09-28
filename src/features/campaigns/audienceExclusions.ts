/**
 * Exclusões da audiência vêm de dois lugares: o vendedor desmarcando leads na
 * prévia ("Ver e excluir leads…") e a importação por CNPJ ("excluir quem já
 * participou"). Até 28/09/2026 a importação SOBRESCREVIA a lista inteira e
 * apagava o que tinha sido desmarcado à mão.
 *
 * Troca as exclusões que vieram da importação (`prevImport` → `nextImport`)
 * e preserva o resto, que é manual.
 */
export function mergeImportExclusions(
  current: string[],
  prevImport: string[],
  nextImport: string[],
): string[] {
  const prev = new Set(prevImport);
  const manual = current.filter((id) => !prev.has(id));
  return Array.from(new Set([...manual, ...nextImport]));
}
