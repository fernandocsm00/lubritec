import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentMock = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { generateReplyDetailed, _resetGeminiClient } from '../services/geminiClient';

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  _resetGeminiClient();
  generateContentMock.mockReset();
});

function okReply(text = 'oi, tudo bem?') {
  generateContentMock.mockResolvedValueOnce({
    text,
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
}

const input = { systemInstruction: 'seja breve', history: [], userMessage: 'oi' };

describe('generateReplyDetailed', () => {
  it('manda timeout de HTTP na chamada', async () => {
    okReply();

    await generateReplyDetailed(input);

    const { config } = generateContentMock.mock.calls[0][0];
    expect(config.httpOptions?.timeout).toBeGreaterThan(0);
  });

  it('deixa teto de saída folgado para o thinking não engolir a resposta', async () => {
    // O 2.5 Flash vem com thinking LIGADO e os tokens de raciocínio saem do
    // mesmo maxOutputTokens. Com 1024 o modelo gastava tudo pensando e devolvia
    // vazio — que virava 'empty response', 3 retries sem timeout, e 502 do proxy.
    okReply();

    await generateReplyDetailed(input);

    const { config } = generateContentMock.mock.calls[0][0];
    expect(config.maxOutputTokens).toBeGreaterThanOrEqual(4000);
  });

  it('NÃO retenta timeout — retentar multiplicaria a espera e voltaria a estourar o proxy', async () => {
    const err = new Error('request timed out');
    err.name = 'AbortError';
    generateContentMock.mockRejectedValue(err);

    await expect(generateReplyDetailed(input)).rejects.toThrow(/timed out|timeout/i);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('continua retentando erro transitório de rede', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('fetch failed'));
    okReply('segunda tentativa');

    const r = await generateReplyDetailed(input);

    expect(r.text).toBe('segunda tentativa');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('não retenta erro de configuração (sem API key)', async () => {
    generateContentMock.mockRejectedValue(new Error('GEMINI_API_KEY missing'));
    await expect(generateReplyDetailed(input)).rejects.toThrow();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});

describe('escolha do modelo', () => {
  it('usa gemini-3.6-flash por padrão', async () => {
    delete process.env.GEMINI_MODEL;
    okReply();

    await generateReplyDetailed(input);

    expect(generateContentMock.mock.calls[0][0].model).toBe('gemini-3.6-flash');
  });

  it('respeita GEMINI_MODEL quando definida', async () => {
    // Existe para que a próxima aposentadoria de modelo seja uma troca de
    // variável no painel, e não commit + build + deploy com a IA fora do ar.
    process.env.GEMINI_MODEL = 'gemini-3.7-flash';
    okReply();

    await generateReplyDetailed(input);

    expect(generateContentMock.mock.calls[0][0].model).toBe('gemini-3.7-flash');
    delete process.env.GEMINI_MODEL;
  });
});

describe('cota estourada (429)', () => {
  // O free tier do Gemini dá 20 requisições por dia por modelo. Retentar um 429
  // consome 3 dessas 20 por clique, e todas falham: o Google pede espera de ~4s
  // e o backoff daqui é de 500ms/1s. É desperdício garantido de uma cota mínima.
  const quota429 = JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
      status: 'RESOURCE_EXHAUSTED',
    },
  });

  it('não retenta: uma tentativa só', async () => {
    generateContentMock.mockRejectedValue(new Error(quota429));

    await expect(generateReplyDetailed(input)).rejects.toThrow();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('preserva a mensagem do Google para o operador ver a causa', async () => {
    generateContentMock.mockRejectedValue(new Error(quota429));

    await expect(generateReplyDetailed(input)).rejects.toThrow(/quota/i);
  });

  it('reconhece RESOURCE_EXHAUSTED mesmo sem o código numérico', async () => {
    generateContentMock.mockRejectedValue(new Error('{"error":{"status":"RESOURCE_EXHAUSTED"}}'));

    await expect(generateReplyDetailed(input)).rejects.toThrow();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('continua retentando 503 do servidor, que é transitório de verdade', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'));
    okReply('recuperou');

    const r = await generateReplyDetailed(input);

    expect(r.text).toBe('recuperou');
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});
