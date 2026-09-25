/**
 * Debounce por chave: `run(key, value)` só dispara depois de `waitMs()` sem
 * nenhum `schedule` daquela chave. Cada `schedule` recomeça a espera e fica com
 * o valor mais recente. Chaves diferentes não interferem entre si.
 *
 * Em memória, de propósito: o estado some se o processo cair — quem depende
 * disto precisa de uma rede de segurança persistida (ver aiPendingWorker).
 */
export interface KeyedDebouncer<T> {
  schedule(key: string, value: T): void;
  /** true enquanto a chave está esperando o silêncio. */
  has(key: string): boolean;
  cancel(key: string): void;
}

export function createKeyedDebouncer<T>(
  waitMs: () => number,
  run: (key: string, value: T) => void,
): KeyedDebouncer<T> {
  const timers = new Map<string, NodeJS.Timeout>();

  return {
    schedule(key, value) {
      clearTimeout(timers.get(key));
      const handle = setTimeout(() => {
        timers.delete(key);
        run(key, value);
      }, waitMs());
      // Não segura o processo vivo só por causa da espera (scripts, testes). No
      // servidor quem mantém o processo de pé é o listener HTTP.
      handle.unref?.();
      timers.set(key, handle);
    },
    has(key) {
      return timers.has(key);
    },
    cancel(key) {
      clearTimeout(timers.get(key));
      timers.delete(key);
    },
  };
}
