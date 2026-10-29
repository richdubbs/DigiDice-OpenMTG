import { describe, expect, it } from 'vitest';
import {
  MIN_SPACING_MANIFEST_MS,
  MIN_SPACING_SLOW_MS,
  RATE_LIMIT_WAIT_MS,
  REQUEST_TIMEOUT_MS,
  ScryfallClient,
  ScryfallHttpError,
  ScryfallRateLimitError,
  ScryfallTimeoutError,
  USER_AGENT,
} from '../src/http';
import { clientWith, fakeClock, json } from './helpers';

const NAMED = 'https://api.scryfall.com/cards/named?exact=Shock';
const BULK = 'https://api.scryfall.com/bulk-data';
const SETS = 'https://api.scryfall.com/sets';

describe('request headers', () => {
  it('sends User-Agent and Accept on every request (GET, POST, bulk download)', async () => {
    const { client, calls } = clientWith((c) => (c.url.includes('data.scryfall.io') ? new Response('gzipbytes') : json({ ok: true })));
    await client.getJson(NAMED);
    await client.postJson('https://api.scryfall.com/cards/collection', { identifiers: [{ name: 'Shock' }] });
    await client.getJson(BULK);
    await client.download('https://data.scryfall.io/oracle-cards/oracle-cards-1.jsonl.gz');
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.headers['User-Agent'], c.url).toBe(USER_AGENT);
      expect(c.headers['User-Agent']).toMatch(/^OpenMTG\/\S+ \(.+\)$/);
      expect(c.headers.Accept, c.url).toBeTruthy();
      expect(c.url.startsWith('https://')).toBe(true);
    }
    expect(calls[0]!.headers.Accept).toBe('application/json');
    expect(calls[1]!.headers['Content-Type']).toBe('application/json');
    expect(calls[1]!.method).toBe('POST');
    expect(calls[3]!.headers.Accept).toContain('gzip'); // bulk file Accept
  });

  it('honours a custom user agent', async () => {
    const m = clientWith(() => json({}));
    const { ScryfallClient } = await import('../src/http');
    const client = new ScryfallClient({ fetch: (async (_u: unknown, init?: RequestInit) => json({ ua: (init?.headers as Record<string, string>)['User-Agent'] })) as unknown as typeof fetch, userAgent: 'Test/1.0', clock: m.clock });
    expect(await client.getJson<{ ua: string }>(BULK)).toEqual({ ua: 'Test/1.0' });
  });

  it('refuses plain HTTP and hosts other than api.scryfall.com / *.scryfall.io', async () => {
    const { client, calls } = clientWith(() => json({}));
    await expect(client.getJson('http://api.scryfall.com/bulk-data')).rejects.toThrow(/HTTPS/);
    await expect(client.getJson('https://example.com/x')).rejects.toThrow(/Refusing host/);
    await expect(client.getJson('https://api.scryfall.com.evil.test/x')).rejects.toThrow(/Refusing host/);
    expect(calls).toHaveLength(0);
  });

  it('turns error answers into ScryfallHttpError with the API details', async () => {
    const { client } = clientWith(() => json({ object: 'error', status: 404, code: 'not_found', details: 'No cards found.' }, 404));
    await expect(client.getJson(NAMED)).rejects.toMatchObject({ name: 'ScryfallHttpError', status: 404, code: 'not_found' });
    await expect(client.getJson(NAMED)).rejects.toBeInstanceOf(ScryfallHttpError);
  });
});

describe('rate limiting (fake clock)', () => {
  it('spaces /cards/named, /cards/collection, /cards/search and /cards/random by 600 ms (2/s limit plus a margin)', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({}), clock);
    const t0 = clock.now();
    await client.getJson('https://api.scryfall.com/cards/named?exact=A');
    await client.postJson('https://api.scryfall.com/cards/collection', {});
    await client.getJson('https://api.scryfall.com/cards/search?q=x');
    await client.getJson('https://api.scryfall.com/cards/random');
    expect(MIN_SPACING_SLOW_MS).toBe(600);
    expect(calls.map((c) => c.at - t0)).toEqual([0, 600, 1200, 1800]);
  });

  it('spaces /cards/manifest by 6 s', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({}), clock);
    const t0 = clock.now();
    await client.getJson('https://api.scryfall.com/cards/manifest');
    await client.getJson('https://api.scryfall.com/cards/manifest');
    expect(MIN_SPACING_MANIFEST_MS).toBe(6000);
    expect(calls.map((c) => c.at - t0)).toEqual([0, 6000]);
  });

  it('spaces other api.scryfall.com requests by >= 100 ms', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({}), clock);
    const t0 = clock.now();
    await client.getJson(BULK);
    await client.getJson(SETS);
    await client.getJson(`${SETS}/mh2`);
    expect(calls.map((c) => c.at - t0)).toEqual([0, 100, 200]);
  });

  it('applies both limits: a slow endpoint needs 600 ms since the last slow call and 100 ms since any call', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({}), clock);
    const t0 = clock.now();
    await client.getJson(NAMED); // t=0 (slow)
    await client.getJson(BULK); // t=100 (other, 100 ms after any)
    await client.getJson(NAMED); // t=600 (600 after the last slow; 500 after the last any)
    await client.getJson(BULK); // t=700
    expect(calls.map((c) => c.at - t0)).toEqual([0, 100, 600, 700]);
  });

  it('does not sleep when enough real time has passed', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({}), clock);
    await client.getJson(NAMED);
    clock.t += 2000;
    const before = clock.sleeps.length;
    await client.getJson(NAMED);
    expect(clock.sleeps.length).toBe(before);
    expect(calls[1]!.at - calls[0]!.at).toBe(2000);
  });

  it('serializes concurrent callers through one queue', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({}), clock);
    const t0 = clock.now();
    await Promise.all([1, 2, 3, 4].map((i) => client.getJson(`https://api.scryfall.com/cards/named?exact=${i}`)));
    expect(calls.map((c) => c.at - t0)).toEqual([0, 600, 1200, 1800]);
    expect(calls.map((c) => c.url.slice(-1))).toEqual(['1', '2', '3', '4']);
  });

  it('does not rate-limit bulk file hosts (*.scryfall.io)', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => new Response('x'), clock);
    await client.download('https://data.scryfall.io/oracle-cards/a.jsonl.gz');
    await client.download('https://data.scryfall.io/oracle-cards/a.jsonl.gz');
    expect(clock.sleeps).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});

describe('HTTP 429 handling', () => {
  it('waits at least 30 s, retries once, and then succeeds', async () => {
    const clock = fakeClock();
    let n = 0;
    const { client, calls } = clientWith(() => (++n === 1 ? json({ status: 429, code: 'too_many_requests' }, 429) : json({ ok: true })), clock);
    const t0 = clock.now();
    expect(await client.getJson(NAMED)).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(30_000);
    expect(clock.sleeps).toContain(RATE_LIMIT_WAIT_MS);
    expect(clock.now() - t0).toBeGreaterThanOrEqual(30_000);
  });

  it('fails with a clear error after a second 429 and never retries more than once', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({ status: 429 }, 429), clock);
    const err = await client.getJson(NAMED).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScryfallRateLimitError);
    expect((err as Error).message).toMatch(/429/);
    expect((err as Error).message).toMatch(/30 s/);
    expect(calls).toHaveLength(2);
    expect(clock.sleeps.filter((s) => s >= 30_000)).toHaveLength(1);
  });

  it('honours a longer Retry-After header', async () => {
    const clock = fakeClock();
    let n = 0;
    const { client, calls } = clientWith(() => (++n === 1 ? json({}, 429, { 'retry-after': '60' }) : json({ ok: 1 })), clock);
    await client.getJson(NAMED);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(60_000);
  });

  it('refuses new requests during the wait after a failure, then works again (fresh retry budget)', async () => {
    const clock = fakeClock();
    let mode: 'limit' | 'ok' = 'limit';
    const { client, calls } = clientWith(() => (mode === 'limit' ? json({}, 429) : json({ ok: true })), clock);
    await expect(client.getJson(NAMED)).rejects.toBeInstanceOf(ScryfallRateLimitError);
    expect(calls).toHaveLength(2);
    mode = 'ok';
    // Still inside the 30 s wait that Scryfall imposed: fail fast, send nothing.
    const early = await client.getJson(NAMED).catch((e: unknown) => e);
    expect(early).toBeInstanceOf(ScryfallRateLimitError);
    expect((early as Error).message).toMatch(/remain/);
    expect(calls).toHaveLength(2);
    clock.t += RATE_LIMIT_WAIT_MS;
    expect(await client.getJson(NAMED)).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it('does not retry early when Retry-After is longer than the 120 s cap: it fails at once and blocks later calls for that long', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => json({}, 429, { 'retry-after': '600' }), clock);
    const err = await client.getJson(NAMED).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScryfallRateLimitError);
    expect((err as Error).message).toMatch(/600 s/);
    expect((err as ScryfallRateLimitError).waitMs).toBe(600_000);
    expect(calls).toHaveLength(1);
    expect(clock.sleeps.every((s) => s < 30_000)).toBe(true);
    clock.t += 599_000;
    await expect(client.getJson(NAMED)).rejects.toBeInstanceOf(ScryfallRateLimitError);
    expect(calls).toHaveLength(1);
  });

  it('caps the retry wait at 120 s for a Retry-After between 30 and 120 s', async () => {
    const clock = fakeClock();
    let n = 0;
    const { client, calls } = clientWith(() => (++n === 1 ? json({}, 429, { 'retry-after': '100' }) : json({ ok: 1 })), clock);
    await client.getJson(NAMED);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(100_000);
  });

  it('slows down for the rest of its life after a 429, even a recovered one', async () => {
    const clock = fakeClock();
    let n = 0;
    const { client, calls } = clientWith(() => (++n === 1 ? json({}, 429) : json({ ok: 1 })), clock);
    await client.getJson(NAMED); // 429, wait 30 s, retry ok
    await client.getJson(NAMED);
    expect(calls[2]!.at - calls[1]!.at).toBe(2 * MIN_SPACING_SLOW_MS);
  });

  it('applies the same single-retry rule to bulk downloads', async () => {
    const clock = fakeClock();
    const { client, calls } = clientWith(() => new Response('', { status: 429 }), clock);
    await expect(client.download('https://data.scryfall.io/x.jsonl.gz')).rejects.toBeInstanceOf(ScryfallRateLimitError);
    expect(calls).toHaveLength(2);
  });
});

describe('request timeout', () => {
  /** A fetch that answers `answer(url)`, or never when it returns null (until the request is aborted, as the real fetch does). */
  function hanging(answer: (url: string) => Response | null) {
    const calls: string[] = [];
    const fetchImpl = ((input: string, init?: RequestInit) => {
      calls.push(input);
      const res = answer(input);
      if (res) return Promise.resolve(res);
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }) as unknown as typeof fetch;
    return { client: new ScryfallClient({ fetch: fetchImpl, clock: fakeClock(), timeoutMs: 30 }), calls };
  }

  it('is 30 s by default', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('fails a request with no answer like a network error (no retry), and the queue moves on', async () => {
    const { client, calls } = hanging((url) => (url.includes('/sets') ? json({ ok: true }) : null));
    const slow = client.getJson(NAMED);
    const next = client.getJson(SETS);
    await expect(slow).rejects.toBeInstanceOf(ScryfallTimeoutError);
    await expect(slow).rejects.toThrow(/ETIMEDOUT/);
    expect(await next).toEqual({ ok: true });
    expect(calls).toEqual([NAMED, SETS]);
  });

  it('times out a JSON body that stops arriving', async () => {
    // half a JSON body, then nothing; the real fetch errors the body stream when the request is aborted
    const fetchImpl = (async (_u: string, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"a":'));
            init?.signal?.addEventListener('abort', () => c.error(init.signal!.reason));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const client = new ScryfallClient({ fetch: fetchImpl, clock: fakeClock(), timeoutMs: 30 });
    await expect(client.getJson(BULK)).rejects.toBeInstanceOf(ScryfallTimeoutError);
  });

  it('lets a file download stream for longer than the timeout once it has started', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response('gzipbytes');
    }) as unknown as typeof fetch;
    const client = new ScryfallClient({ fetch: fetchImpl, clock: fakeClock(), timeoutMs: 20 });
    const res = await client.download('https://data.scryfall.io/oracle-cards/x.jsonl.gz');
    await new Promise((r) => setTimeout(r, 60));
    expect(signal?.aborted).toBe(false);
    expect(await res.text()).toBe('gzipbytes');
  });
});
