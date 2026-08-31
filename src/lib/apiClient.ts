import { useAuthStore } from '@/features/auth/store';

const BASE = '/api';

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      useAuthStore.getState().setAuth(data.user, data.accessToken);
      return data.accessToken as string;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Faz a requisição com o access token e, num 401, tenta uma vez com token
 * renovado. Devolve a Response crua — quem chama decide se lê JSON ou binário.
 */
async function requestWithAuth(path: string, init: RequestInit): Promise<Response> {
  const doFetch = async (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  };

  const token = useAuthStore.getState().accessToken;
  const res = await doFetch(token);
  if (res.status !== 401 || !token) return res;

  const newToken = await refreshAccessToken();
  if (!newToken) {
    useAuthStore.getState().clear();
    throw new ApiError(401, 'Unauthenticated');
  }
  return doFetch(newToken);
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await requestWithAuth(path, init);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    // Resposta sem JSON (502/504/413 do proxy, app reiniciando) cai aqui: sem o
    // status a tela mostra só "Request failed" e não dá pra distinguir app fora
    // do ar de payload grande. Em HTTP/2 o statusText vem sempre vazio.
    throw new ApiError(res.status, body.error || `Request failed (HTTP ${res.status})`, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Lê o filename do Content-Disposition; cai no padrão se o header não vier. */
function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(cd);
  return match?.[1] ?? fallback;
}

/**
 * Baixa um arquivo de um endpoint autenticado. Um `<a href>` não serve aqui:
 * o navegador não manda o header Authorization numa navegação comum, então é
 * preciso buscar com o token e transformar a resposta em download.
 */
export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  const res = await requestWithAuth(path, { method: 'GET' });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || `Request failed (HTTP ${res.status})`, body);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFrom(res, fallbackFilename);
  a.click();
  URL.revokeObjectURL(url);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}
