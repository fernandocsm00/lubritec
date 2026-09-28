import { closeEndedCampaigns } from './campaignClosure';

/**
 * Rotina que fecha os cards das campanhas cuja vigência acabou. 15 min basta:
 * a vigência é contada em dias, e o botão "Encerrar campanha" fecha na hora.
 *
 * Single-instance assumption, igual ao slaWatchdog: a Lubritec roda num só
 * processo. A varredura é idempotente (cards_closed_at), então um tick
 * duplicado não fecha nada duas vezes.
 */
const TICK_MS = 15 * 60_000;

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startCampaignClosureWorker(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  // Tick inicial pouco depois do boot.
  setTimeout(tick, 30_000);
}

export function stopCampaignClosureWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const r = await closeEndedCampaigns();
    if (r.campaigns > 0) {
      console.log(`[campaign-closure] tick: ${r.campaigns} campanha(s) encerrada(s), ${r.cards} card(s) fechado(s)`);
    }
  } catch (err) {
    console.error('[campaign-closure] tick failed:', err);
  } finally {
    isProcessing = false;
  }
}
