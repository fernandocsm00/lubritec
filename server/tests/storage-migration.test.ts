import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { listObjects, copyObject, type StorageEndpoint } from '../lib/storageMigration';

const SRC: StorageEndpoint = {
  url: 'https://old.supabase.co',
  key: 'service-role-old',
  bucket: 'hsm-headers',
};

const DST: StorageEndpoint = {
  url: 'https://new.supabase.co',
  key: 'service-role-new',
  bucket: 'hsm-headers',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('listObjects', () => {
  it('desce nas pastas e devolve caminhos completos dos objetos', async () => {
    const fetchMock = vi.mocked(fetch);
    // 1ª chamada: raiz -> uma pasta (id null) e um objeto solto
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { name: 'headers', id: null },
        { name: 'solto.png', id: 'obj-1', metadata: { size: 10, mimetype: 'image/png' } },
      ]),
    );
    // 2ª chamada: dentro de headers/
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { name: 'a.jpg', id: 'obj-2', metadata: { size: 20, mimetype: 'image/jpeg' } },
      ]),
    );

    const paths = await listObjects(SRC);

    // A pasta vem primeiro na listagem e é resolvida por recursão antes de o
    // objeto solto ser empilhado — a ordem reflete a travessia, não o nome.
    expect(paths).toEqual(['headers/a.jpg', 'solto.png']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe('https://old.supabase.co/storage/v1/object/list/hsm-headers');
    expect((firstInit as RequestInit).method).toBe('POST');
    expect(JSON.parse((firstInit as RequestInit).body as string).prefix).toBe('');

    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(secondInit.body as string).prefix).toBe('headers');
  });

  it('lança erro quando a API responde não-ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'invalid key',
    } as unknown as Response);

    await expect(listObjects(SRC)).rejects.toThrow(/401/);
  });
});

describe('copyObject', () => {
  it('baixa autenticado da origem e sobe no destino com upsert', async () => {
    const fetchMock = vi.mocked(fetch);
    const bytes = new Uint8Array([1, 2, 3, 4]);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response);

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    const result = await copyObject(SRC, DST, 'headers/a.jpg');

    expect(result).toEqual({ path: 'headers/a.jpg', bytes: 4 });

    const [downloadUrl, downloadInit] = fetchMock.mock.calls[0];
    expect(downloadUrl).toBe('https://old.supabase.co/storage/v1/object/hsm-headers/headers/a.jpg');
    expect((downloadInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer service-role-old',
    });

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(uploadUrl).toBe('https://new.supabase.co/storage/v1/object/hsm-headers/headers/a.jpg');
    expect((uploadInit as RequestInit).method).toBe('POST');
    expect((uploadInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer service-role-new',
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    });
  });

  it('usa application/octet-stream quando a origem não informa content-type', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({}),
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await copyObject(SRC, DST, 'x.bin');

    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(uploadInit.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' });
  });

  it('propaga erro de download sem tentar subir', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as unknown as Response);

    await expect(copyObject(SRC, DST, 'sumiu.jpg')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
