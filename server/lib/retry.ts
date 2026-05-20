/**
 * Pequeno helper de retry com backoff exponencial. Genérico o suficiente
 * pra usar com qualquer cliente HTTP que jogue erro em caso de falha.
 *
 * Uso:
 *   await retry(() => fetch(url), {
 *     attempts: 3,
 *     baseDelayMs: 300,
 *     shouldRetry: (err) => err instanceof MyTransientError,
 *   });
 */

export interface RetryOpts {
  /** Total de tentativas (incluindo a primeira). Default: 3. */
  attempts?: number;
  /** Delay base em ms. Cada retry dobra: base, base*2, base*4. Default: 300. */
  baseDelayMs?: number;
  /** Limite superior do delay. Default: 5000. */
  maxDelayMs?: number;
  /** Decide se um erro merece retry. Default: sempre. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 300;
  const maxDelay = opts.maxDelayMs ?? 5000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      if (!shouldRetry(err, attempt)) break;
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      // Jitter ±20% pra evitar thundering herd quando vários callers
      // sincronizam no mesmo erro transiente.
      const jitter = delay * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
  throw lastErr;
}
