import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentMock = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { extractBudgetFromImage } from '../services/geminiClient';

function mockGeminiJson(obj: unknown) {
  generateContentMock.mockResolvedValueOnce({
    text: JSON.stringify(obj),
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  generateContentMock.mockReset();
});

describe('extractBudgetFromImage', () => {
  it('extrai o total quando a imagem é um orçamento', async () => {
    mockGeminiJson({ ehOrcamento: true, total: 3443.04, rotulo: 'Valor total' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toEqual({ total: 3443.04, rotulo: 'Valor total' });
  });

  it('devolve null quando não é orçamento (foto de produto, print de conversa)', async () => {
    mockGeminiJson({ ehOrcamento: false, total: null, rotulo: null });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('devolve null quando o rótulo é de linha de produto', async () => {
    // Defesa do budgetLabel aplicada aqui: prefere não sugerir a sugerir errado.
    mockGeminiJson({ ehOrcamento: true, total: 1821.87, rotulo: 'Preço Total' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('devolve null quando o JSON vem malformado', async () => {
    generateContentMock.mockResolvedValueOnce({ text: 'desculpe, não consegui ler' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('devolve null quando o total não é número positivo', async () => {
    mockGeminiJson({ ehOrcamento: true, total: 0, rotulo: 'Valor total' });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toBeNull();
  });

  it('aceita JSON embrulhado em cerca de código', async () => {
    // O modelo às vezes ignora "sem cercas" e devolve ```json ... ```.
    generateContentMock.mockResolvedValueOnce({
      text: '```json\n{"ehOrcamento":true,"total":1500,"rotulo":"Total"}\n```',
    });

    const r = await extractBudgetFromImage(Buffer.from('img'), 'image/jpeg');

    expect(r).toEqual({ total: 1500, rotulo: 'Total' });
  });

  it('não lança quando o Gemini falha — caminho pós-envio é best-effort', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('rate limit'));

    await expect(extractBudgetFromImage(Buffer.from('img'), 'image/jpeg')).resolves.toBeNull();
  });

  it('manda a imagem como inlineData em base64', async () => {
    mockGeminiJson({ ehOrcamento: true, total: 100, rotulo: 'Total' });

    await extractBudgetFromImage(Buffer.from('abc'), 'image/png');

    const call = generateContentMock.mock.calls[0][0];
    const parts = call.contents[0].parts;
    const img = parts.find((p: Record<string, unknown>) => p.inlineData).inlineData;
    expect(img.mimeType).toBe('image/png');
    expect(img.data).toBe(Buffer.from('abc').toString('base64'));
  });
});
