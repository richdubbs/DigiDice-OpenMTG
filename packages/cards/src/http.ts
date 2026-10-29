/**
 * HTTP client for Scryfall. Follows https://scryfall.com/docs/api and /docs/api/rate-limits:
 *  - every request carries a descriptive User-Agent and an Accept header;
 *  - HTTPS only; only api.scryfall.com and *.scryfall.io are ever contacted;
 *  - one queue for api.scryfall.com: >= 100 ms between any two requests, and >= 600 ms between
 *    requests to /cards/named, /cards/collection, /cards/search and /cards/random
 *    (both limits apply; Scryfall's limit is 2/s, the extra 100 ms is a safety margin), >= 6 s between
 *    /cards/manifest requests. The queue is per ScryfallClient; CardDatabase shares one client;
 *  - HTTP 429: wait at least 30 s (or the Retry-After value, up to 120 s), retry once, then fail. A
 *    Retry-After above 120 s fails at once instead of retrying early. After a 429 this client doubles
 *    its spacing for the rest of its life, and after a failure it refuses new requests to that host
 *    until the requested wait has passed. Never loops;
 *  - *.scryfall.io (bulk files) has no rate limit but gets the same headers. OpenMTG never requests card images;
 *  - a request with no answer in REQUEST_TIMEOUT_MS (30 s) fails with ScryfallTimeoutError, like a network error (no retry; the queue moves on).
 *    JSON requests must be complete by then; a file download must have started (its body streams for as long as it takes).
 * fetch and the clock are injected so tests can mock them.
 */
export const USER_AGENT = 'OpenMTG/0.1 (open-source non-commercial fan project)';
export const ACCEPT_JSON = 'application/json';
export const ACCEPT_GZIP = 'application/gzip, application/octet-stream;q=0.9, */*;q=0.5';

export const API_HOST = 'api.scryfall.com';
export const MIN_SPACING_ANY_MS = 100;
export const MIN_SPACING_SLOW_MS = 600;
export const MIN_SPACING_MANIFEST_MS = 6000;
export const RATE_LIMIT_WAIT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 120_000;
/** How long a request may go without an answer (a JSON answer: complete; a download: its headers) before it fails like a network error. */
export const REQUEST_TIMEOUT_MS = 30_000;
const SLOW_PATHS = ['/cards/named', '/cards/collection', '/cards/search', '/cards/random'];

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class ScryfallHttpError extends Error {
  constructor(message: string, readonly status: number, readonly url: string, readonly code?: string) {
    super(message);
    this.name = 'ScryfallHttpError';
  }
}

/** HTTP 429 that this client will not retry (again): it persisted after the single retry, asked for too long a wait, or the wait is still running. */
export class ScryfallRateLimitError extends ScryfallHttpError {
  constructor(url: string, message?: string, /** How long Scryfall asked us to stay away, in ms. */ readonly waitMs: number = RATE_LIMIT_WAIT_MS) {
    super(
      message ??
        `Scryfall answered HTTP 429 (rate limit) again after waiting ${RATE_LIMIT_WAIT_MS / 1000} s and retrying once. ` +
          'Stopping instead of retrying in a loop; wait a few minutes and try again.',
      429,
      url,
      'rate_limited',
    );
    this.name = 'ScryfallRateLimitError';
  }
}

/**
 * Scryfall did not answer in time. A network error, like fetch's own "fetch failed": not retried, and the message carries ETIMEDOUT so callers that
 * tell an unreachable server from other failures (the server's update summary) count it as offline.
 */
export class ScryfallTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  constructor(readonly url: string, timeoutMs: number) {
    super(`Scryfall did not answer within ${timeoutMs / 1000} s (ETIMEDOUT): ${url}`);
    this.name = 'ScryfallTimeoutError';
  }
}

export interface ClientOptions {
  fetch?: typeof fetch;
  clock?: Clock;
  userAgent?: string;
  log?: (message: string) => void;
  /** REQUEST_TIMEOUT_MS unless given (tests). */
  timeoutMs?: number;
}

interface Bucket {
  name: string;
  spacingMs: number;
}

/** Which spacing rules apply to a request URL; null = not rate limited by us. */
export function bucketsFor(url: URL): Bucket[] | null {
  if (url.hostname !== API_HOST) return null;
  const buckets: Bucket[] = [{ name: 'any', spacingMs: MIN_SPACING_ANY_MS }];
  if (SLOW_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
    buckets.push({ name: 'slow', spacingMs: MIN_SPACING_SLOW_MS });
  } else if (url.pathname.startsWith('/cards/manifest')) {
    buckets.push({ name: 'manifest', spacingMs: MIN_SPACING_MANIFEST_MS });
  }
  return buckets;
}

/** A request's timeout: armed when the request is sent, disarmed once the part of the answer the caller waits for has arrived. */
class Deadline {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly ms: number) {}
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  get expired(): boolean {
    return this.controller.signal.aborted;
  }
  arm(): void {
    this.disarm();
    this.timer = setTimeout(() => this.controller.abort(), this.ms);
  }
  disarm(): void {
    clearTimeout(this.timer);
  }
}

function isAllowedHost(host: string): boolean {
  return host === API_HOST || host === 'scryfall.io' || host.endsWith('.scryfall.io');
}

export class ScryfallClient {
  /** Number of HTTP requests actually sent (429 retries included). */
  requestCount = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  /** Progress messages (429 waits). Replaceable, because several CardDatabases can share one client. */
  log: (message: string) => void;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly lastSent = new Map<string, number>();
  /** Per host: no request until this time (ms), after a 429 that was not retried. */
  private readonly blockedUntil = new Map<string, number>();
  /** Spacing multiplier: 1, then 2 for the rest of this client's life after any HTTP 429. */
  private spacingFactor = 1;

  constructor(options: ClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.clock = options.clock ?? systemClock;
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.log = options.log ?? (() => {});
  }

  /** GET an API URL and parse the JSON body. Throws ScryfallHttpError for non-2xx answers. */
  async getJson<T>(url: string): Promise<T> {
    return this.requestJson<T>(url, 'GET');
  }

  /** POST a JSON body and parse the JSON answer. */
  async postJson<T>(url: string, body: unknown): Promise<T> {
    return this.requestJson<T>(url, 'POST', JSON.stringify(body));
  }

  /** GET a file (bulk data). The caller streams `res.body`. Throws for non-2xx answers. */
  async download(url: string, accept: string = ACCEPT_GZIP): Promise<Response> {
    const res = await this.execute(url, 'GET', accept, undefined, new Deadline(this.timeoutMs));
    if (!res.ok) throw await this.errorFrom(res, url);
    return res;
  }

  /** A JSON request whose answer, body included, must arrive within the timeout. */
  private async requestJson<T>(url: string, method: 'GET' | 'POST', body?: string): Promise<T> {
    const deadline = new Deadline(this.timeoutMs);
    const res = await this.execute(url, method, ACCEPT_JSON, body, deadline, true);
    try {
      if (!res.ok) throw await this.errorFrom(res, url);
      return (await res.json()) as T;
    } catch (e) {
      throw deadline.expired ? new ScryfallTimeoutError(url, this.timeoutMs) : e;
    } finally {
      deadline.disarm();
    }
  }

  private async errorFrom(res: Response, url: string): Promise<ScryfallHttpError> {
    let code: string | undefined;
    let details = '';
    try {
      const j = (await res.json()) as { code?: string; details?: string };
      code = j.code;
      details = j.details ?? '';
    } catch {
      /* body was not JSON */
    }
    return new ScryfallHttpError(`Scryfall request failed: HTTP ${res.status} ${url}${details ? ` (${details})` : ''}`, res.status, url, code);
  }

  /**
   * `deadline` aborts the request when the timeout runs out. It is armed when the request is sent (after its turn in the queue, again for the retry after
   * a 429) and disarmed when the answer's headers arrive, unless `untilBody`: then the caller disarms it once it has read the body.
   */
  private execute(rawUrl: string, method: 'GET' | 'POST', accept: string, body: string | undefined, deadline: Deadline, untilBody = false): Promise<Response> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return Promise.reject(new Error(`Invalid URL: ${rawUrl}`));
    }
    if (url.protocol !== 'https:') return Promise.reject(new Error(`Refusing non-HTTPS URL: ${rawUrl}`));
    if (!isAllowedHost(url.hostname)) return Promise.reject(new Error(`Refusing host ${url.hostname}: only api.scryfall.com and *.scryfall.io are allowed`));
    const buckets = bucketsFor(url);
    const run = () => this.attempt(url, method, accept, body, buckets, deadline, untilBody);
    if (!buckets) return run();
    // One queue for api.scryfall.com: requests are sent strictly one after another.
    const result = this.tail.then(run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async attempt(url: URL, method: 'GET' | 'POST', accept: string, body: string | undefined, buckets: Bucket[] | null, deadline: Deadline, untilBody: boolean): Promise<Response> {
    const headers: Record<string, string> = { 'User-Agent': this.userAgent, Accept: accept };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const blocked = this.blockedUntil.get(url.hostname);
    if (blocked !== undefined) {
      const remaining = blocked - this.clock.now();
      if (remaining > 0) {
        throw new ScryfallRateLimitError(
          url.toString(),
          `Scryfall asked us to stay away after an HTTP 429; ${Math.ceil(remaining / 1000)} s of that wait remain. Not sending the request; try again later.`,
          remaining,
        );
      }
      this.blockedUntil.delete(url.hostname);
    }
    for (let attempt = 0; ; attempt++) {
      if (buckets) await this.waitTurn(buckets);
      this.requestCount++;
      const init: RequestInit = { method, headers, signal: deadline.signal };
      if (body !== undefined) init.body = body;
      deadline.arm();
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), init);
      } catch (e) {
        deadline.disarm();
        // a timeout is a network error: no retry, and the queue moves on to the next request (execute)
        throw deadline.expired ? new ScryfallTimeoutError(url.toString(), this.timeoutMs) : e;
      }
      if (res.status !== 429) {
        if (!untilBody) deadline.disarm();
        return res;
      }
      deadline.disarm(); // the wait below is ours, not Scryfall's
      this.spacingFactor = 2; // "then slow down"
      const retryAfter = Number(res.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
      const penaltyMs = Math.max(RATE_LIMIT_WAIT_MS, retryAfterMs);
      await res.body?.cancel().catch(() => undefined);
      if (retryAfterMs > MAX_RETRY_AFTER_MS) {
        this.blockedUntil.set(url.hostname, this.clock.now() + penaltyMs);
        throw new ScryfallRateLimitError(
          url.toString(),
          `Scryfall answered HTTP 429 and asked for a wait of ${Math.ceil(retryAfterMs / 1000)} s (Retry-After), longer than the ${MAX_RETRY_AFTER_MS / 1000} s this tool waits. ` +
            'Not retrying; try again after that time.',
          penaltyMs,
        );
      }
      if (attempt >= 1) {
        this.blockedUntil.set(url.hostname, this.clock.now() + penaltyMs);
        throw new ScryfallRateLimitError(url.toString(), undefined, penaltyMs);
      }
      this.log(`Scryfall rate limit (HTTP 429): waiting ${Math.round(penaltyMs / 1000)} s, then retrying once.`);
      await this.clock.sleep(penaltyMs);
    }
  }

  /** Sleep until every applicable spacing rule is satisfied, then record the send time. */
  private async waitTurn(buckets: Bucket[]): Promise<void> {
    const now = this.clock.now();
    let wait = 0;
    for (const b of buckets) {
      const last = this.lastSent.get(b.name);
      if (last !== undefined) wait = Math.max(wait, last + b.spacingMs * this.spacingFactor - now);
    }
    if (wait > 0) await this.clock.sleep(wait);
    const sentAt = this.clock.now();
    for (const b of buckets) this.lastSent.set(b.name, sentAt);
  }
}
