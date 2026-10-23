/**
 * One-off lookups of names that are not in the local index, via POST /cards/collection
 * (batches of up to 75 {"name": ...} identifiers; the answer lists unmatched ones in not_found).
 * Every answer, including "not found", is cached on disk (see lookup-cache.ts), and concurrent
 * callers asking for the same name share one request.
 */
import type { OracleCard } from '@openmtg/engine';
import { API_HOST, systemClock, type Clock, type ScryfallClient } from './http';
import { LookupCache } from './lookup-cache';
import type { NameIndex } from './name-index';
import { canonicalKey, looseKeyVariants, looseName, requestName } from './normalize';
import { isNonGameObject, trimCard, type RawCard } from './trim';

export const COLLECTION_URL = `https://${API_HOST}/cards/collection`;
export const COLLECTION_BATCH = 75;

interface CollectionResponse {
  data?: RawCard[];
  not_found?: Array<{ name?: string }>;
}

export interface FetchMissingOptions {
  client: ScryfallClient;
  cache: LookupCache;
  index: NameIndex;
  clock?: Clock;
  log?: (message: string) => void;
  /** Requests in progress, by cache key. Share one map per index so concurrent callers never ask twice. */
  inflight?: Map<string, Promise<unknown>>;
}

/**
 * Resolve names that the index does not have. Found cards are added to the index and cached;
 * names cached as not-found within 24 h cause no request; names that are ambiguous locally cause
 * no request either. Returns the number of API calls this call made.
 */
export async function fetchMissingCards(names: string[], opts: FetchMissingOptions): Promise<{ requests: number }> {
  const clock = opts.clock ?? systemClock;
  const inflight = opts.inflight ?? new Map<string, Promise<unknown>>();
  const pending = new Map<string, string>(); // cache key -> name to request
  const waits: Promise<unknown>[] = [];
  for (const name of names) {
    if (opts.index.has(name) || opts.index.ambiguous(name).length) continue;
    const key = canonicalKey(name);
    if (!key || pending.has(key)) continue;
    const cached = opts.cache.fresh(name, clock.now());
    if (cached) {
      if (cached.card) opts.index.add(cached.card);
      continue;
    }
    const running = inflight.get(key);
    if (running) {
      waits.push(running);
      continue;
    }
    pending.set(key, requestName(name));
  }
  const queue = [...pending.entries()];
  let requests = 0;
  if (queue.length) {
    // Registered synchronously, before the first await, so a concurrent call sees it.
    const work = requestBatches(queue, opts, clock);
    for (const [key] of queue) inflight.set(key, work);
    try {
      requests = await work;
    } finally {
      for (const [key] of queue) if (inflight.get(key) === work) inflight.delete(key);
    }
  }
  await Promise.all(waits);
  return { requests };
}

async function requestBatches(queue: Array<[string, string]>, opts: FetchMissingOptions, clock: Clock): Promise<number> {
  const log = opts.log ?? (() => {});
  let requests = 0;
  for (let i = 0; i < queue.length; i += COLLECTION_BATCH) {
    const batch = queue.slice(i, i + COLLECTION_BATCH);
    log(`Looking up ${batch.length} name(s) with POST /cards/collection...`);
    const res = await opts.client.postJson<CollectionResponse>(COLLECTION_URL, { identifiers: batch.map(([, n]) => ({ name: n })) });
    requests++;
    const returnedCards: OracleCard[] = [];
    const returned = new Map<string, OracleCard>(); // loose name (full or face) -> card
    for (const raw of res.data ?? []) {
      if (typeof raw.name !== 'string' || typeof raw.layout !== 'string') continue;
      const card = trimCard(raw, 'card');
      returnedCards.push(card);
      for (const name of [card.name, ...(card.card_faces ?? []).map((f) => f.name)]) {
        const k = looseName(name);
        if (!returned.has(k)) returned.set(k, card);
      }
    }
    const notFound = new Set((res.not_found ?? []).map((n) => canonicalKey(n.name ?? '')));
    const stamp = new Date(clock.now()).toISOString();
    const claimed = new Set<OracleCard>();
    const unmatched: Array<[string, string]> = [];

    const store = (sent: string, card: OracleCard) => {
      if (isNonGameObject(card as unknown as RawCard)) {
        opts.cache.set(sent, { fetched_at: stamp, card: null, reason: `Scryfall returned a ${card.layout} object (out of scope)` });
      } else {
        opts.cache.set(sent, { fetched_at: stamp, card });
        opts.index.add(card);
      }
    };

    for (const [key, sent] of batch) {
      const card = looseKeyVariants(sent).map((k) => returned.get(k)).find((c) => c !== undefined);
      if (card) {
        claimed.add(card);
        store(sent, card);
      } else if (notFound.has(key)) {
        opts.cache.set(sent, { fetched_at: stamp, card: null, reason: 'not found' });
      } else {
        unmatched.push([key, sent]);
      }
    }
    // Scryfall neither reported these names as not found nor returned a card under a name we can match
    // (it matches names more loosely than we do). Pair them with the cards nobody claimed when that is
    // unambiguous (the response order is not guaranteed to follow the request); otherwise record a
    // 24 h "unmatched" answer. Either way the name is never requested again within 24 h.
    const unclaimed = returnedCards.filter((c) => !claimed.has(c));
    if (unmatched.length === 1 && unclaimed.length === 1) {
      const [, sent] = unmatched[0]!;
      store(sent, unclaimed[0]!);
      opts.index.addNameAlias(sent, unclaimed[0]!);
    } else {
      for (const [, sent] of unmatched) {
        log(`Scryfall answered for "${sent}" but no returned card matches that name; not asking again for 24 h.`);
        opts.cache.set(sent, { fetched_at: stamp, card: null, reason: 'unmatched: Scryfall did not report this name as not found but returned no card with that name' });
      }
    }
    await opts.cache.save();
  }
  return requests;
}
