import { processNextEnrichment, ENRICHMENT_TICK_MS } from './enrichmentJobs';

/**
 * Worker em background que processa o job de enriquecimento bulk.
 * Tick fixo de ~21s (BrasilAPI free tier ~3 req/min).
 * Singleton — uma instância do worker por processo.
 *
 * Não compete com campaignsDispatcher (workers independentes; ambos in-process).
 */

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startEnrichmentWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (isProcessing) return;
    isProcessing = true;
    processNextEnrichment()
      .catch((err) => console.error('[enrichment-worker] tick failed:', err))
      .finally(() => { isProcessing = false; });
  }, ENRICHMENT_TICK_MS);
  // Primeira tentativa pouco depois do boot pra não competir com migrations.
  setTimeout(() => {
    if (isProcessing) return;
    isProcessing = true;
    processNextEnrichment()
      .catch((err) => console.error('[enrichment-worker] initial tick failed:', err))
      .finally(() => { isProcessing = false; });
  }, 8_000);
}

export function stopEnrichmentWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
