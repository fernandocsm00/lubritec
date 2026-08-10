import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { listObjects, type StorageEndpoint } from '../lib/storageMigration';

const SRC: StorageEndpoint = {
  url: 'https://old.supabase.co',
  key: 'service-role-old',
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
