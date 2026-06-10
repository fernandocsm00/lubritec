import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'lubritec:chunk-reload';

export function lazyWithRetry<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await importFn();
      window.sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isChunkError =
        /Failed to fetch dynamically imported module/i.test(message) ||
        /Importing a module script failed/i.test(message) ||
        /ChunkLoadError/i.test(message);

      if (isChunkError && !window.sessionStorage.getItem(RELOAD_FLAG)) {
        window.sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
