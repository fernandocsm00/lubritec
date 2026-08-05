import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { uploadResumableHeaderSample } from '../services/whatsapp/metaCloud/mediaUpload';
import { MetaGraphError } from '../services/whatsapp/metaCloud/client';

// O nó /{app_id}/uploads pertence ao APP, não à WABA: com o access token de
// system user a Meta devolve 400 code 100 subcode 33 ("Object with ID ... does
// not exist / missing permissions"). Autenticação correta é o app access token
// `{app-id}|{app-secret}`.
const APP_ID = '1262216740302784';
const APP_SECRET = 'super-secret';
const APP_TOKEN = `${APP_ID}|${APP_SECRET}`;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function callUpload() {
  return uploadResumableHeaderSample({
    appId: APP_ID,
    appSecret: APP_SECRET,
    buffer: Buffer.from('fake-jpeg-bytes'),
    mimeType: 'image/jpeg',
    fileName: 'header.jpg',
  });
}

describe('uploadResumableHeaderSample', () => {
  it('autentica os dois passos com o app access token e devolve o handle', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:SESSION' }))
      .mockResolvedValueOnce(jsonResponse({ h: '4::aW1hZ2U=' }));

    const handle = await callUpload();
    expect(handle).toBe('4::aW1hZ2U=');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(startUrl).toContain(`/${APP_ID}/uploads?`);
    expect(startUrl).toContain('file_type=image%2Fjpeg');
    expect(startUrl).toContain(`file_length=${Buffer.from('fake-jpeg-bytes').byteLength}`);
    expect(startInit.headers.Authorization).toBe(`Bearer ${APP_TOKEN}`);

    const [sessionUrl, sessionInit] = fetchMock.mock.calls[1];
    expect(sessionUrl).toContain('/upload:SESSION');
    expect(sessionInit.headers.Authorization).toBe(`OAuth ${APP_TOKEN}`);
    expect(sessionInit.headers.file_offset).toBe('0');
  });

  it('propaga o code da Meta quando a criação da sessão falha', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Unsupported post request.', code: 100, error_subcode: 33 } }, false, 400),
    );

    await expect(callUpload()).rejects.toMatchObject({
      name: 'MetaGraphError',
      status: 400,
      code: 100,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falha quando a Meta não devolve o handle no passo 2', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:SESSION' }))
      .mockResolvedValueOnce(jsonResponse({ semHandle: true }));

    await expect(callUpload()).rejects.toBeInstanceOf(MetaGraphError);
  });
});
