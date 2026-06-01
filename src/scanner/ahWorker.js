import { config } from '../config.js';
import { repo } from '../db/index.js';
import { getAuctionsPage } from '../clients/hypixel.js';
import { decodeSingleItem } from '../items/nbt.js';
import { normalizeNbtItem } from '../items/extract.js';
import { classifyItem } from '../items/classify.js';
import { isRandomDyed, isAnimated } from '../items/data.js';
import { makeCtx, toFinding } from './context.js';
import { enqueueSeller } from './crawler.js';

let timer = null;
let running = false;

export function getWorkerStatus() {
  return {
    enabled: config.ahWorker.enabled,
    running,
    lastRun: Number(repo.getMeta('ah_last_run', 0)) || null,
    nextPage: Number(repo.getMeta('ah_page', 0)) || 0,
    lastCycle: repo.getMeta('ah_last_cycle', null),
  };
}

// Scan a slice of the live Auction House: decode each listing's NBT, classify
// it, and store both the finding and the seller account.
export async function runCycle() {
  const ctx = makeCtx();
  const startPage = Number(repo.getMeta('ah_page', 0)) || 0;

  const first = await getAuctionsPage(startPage);
  const totalPages = first.totalPages || 1;
  const pages = [first];
  for (let i = 1; i < config.ahWorker.maxPagesPerCycle; i++) {
    pages.push(await getAuctionsPage((startPage + i) % totalPages));
  }

  let scanned = 0;
  let newFindings = 0;
  for (const pg of pages) {
    for (const auc of pg.auctions || []) {
      const raw = await decodeSingleItem(auc.item_bytes).catch(() => null);
      if (!raw) continue;
      const it = normalizeNbtItem(raw, 'auction');
      if (!it) continue;
      scanned++;

      for (const fr of classifyItem(it, ctx)) {
        if (fr.drop && config.dropRandomDyed) continue; // skip Satin/Oxford etc.
        const f = toFinding(fr, it, {
          uuid: auc.auctioneer,
          username: null,
          source: 'ah',
          price: auc.starting_bid,
        });
        f.profile_id = auc.profile_id || null;
        if (repo.insertFinding(f).isNew) newFindings++;
      }

      // Never learn colours from random-dyed sets — their colour is a random
      // roll and would poison the learned default for that piece.
      if (it.hex && !(it.extra && it.extra.dye_item)
          && !isRandomDyed(it.itemId) && !isAnimated(it.itemId, it.hex)) {
        ctx.recordPieceColor(it.itemId, it.hex);
      }
      if (auc.auctioneer) {
        repo.upsertAccount({ uuid: auc.auctioneer, source: 'ah' });
        // Feed the seller into the crawl frontier — this is the keyless engine
        // behind "scan everyone": every active trader becomes a scan target.
        enqueueSeller(auc.auctioneer);
      }
    }
  }

  const nextPage = (startPage + config.ahWorker.maxPagesPerCycle) % totalPages;
  repo.setMeta('ah_page', nextPage);
  repo.setMeta('ah_last_run', Date.now());
  const summary = `pages ${startPage}..+${config.ahWorker.maxPagesPerCycle} of ${totalPages}; scanned ${scanned}; new findings ${newFindings}`;
  repo.setMeta('ah_last_cycle', summary);
  return { startPage, totalPages, scanned, newFindings };
}

export function startAhWorker() {
  if (!config.ahWorker.enabled || timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runCycle();
      console.log(`[ah] ${r.scanned} scanned, ${r.newFindings} new (page ${r.startPage}/${r.totalPages})`);
    } catch (e) {
      console.error('[ah] cycle error:', e.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 1000); // let the server bind first
  timer = setInterval(tick, config.ahWorker.intervalMs);
  console.log(`[ah] worker enabled — every ${config.ahWorker.intervalMs}ms, ${config.ahWorker.maxPagesPerCycle} pages/cycle`);
}
