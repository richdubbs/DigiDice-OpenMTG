/**
 * M13-14: the structured logger (design 10.2, 6.3, 11): one JSON object a line; fields that name a secret, a code, free text or a hidden zone are
 * redacted whatever their value; every string is scrubbed of tokens, invite codes, bearer credentials, URL passwords and the configured secrets' exact
 * values, cut, and escaped; values are flat. A fixed list of inputs, no randomness.
 */
import { describe, expect, it } from 'vitest';
import {
  escapeLogText, formatLogLine, isAddressField, isRedactedField, LOG_VALUE_MAX, logScrubber, MemoryLogger, REDACTED, scrubLogText, secretValuesOf, StdoutLogger,
} from '../../src/obs';

const T = new Date('2026-10-22T12:00:00.000Z');
const TOKEN = 'ab'.repeat(32);
const SECRET = '0123456789abcdef'.repeat(4);
const line = (fields: Record<string, string | number | boolean | null | undefined>, event = 'tableMade', scrub = scrubLogText) =>
  JSON.parse(formatLogLine(T, 'info', event, fields, scrub)) as Record<string, unknown>;

describe('M13-14 the logger: what is never written', () => {
  it('a line is time, level, event, then the fields, as one JSON object', () => {
    expect(formatLogLine(T, 'warn', 'adoptFailed', { game: 'G1', seat: 2, ok: false, none: null })).toBe(
      '{"time":"2026-10-22T12:00:00.000Z","level":"warn","event":"adoptFailed","game":"G1","seat":2,"ok":false,"none":null}',
    );
  });

  it('fields that name a secret, a code, free text or a hidden zone are redacted whatever they hold', () => {
    const keys = ['token', 'sessionToken', 'password', 'tablePassword', 'salt', 'seed', 'secret', 'authorization', 'databaseUrl', 'invite_code', 'Invite-Code',
      'code', 'codes', 'errorCode', 'reason', 'voidReason', 'title', 'text', 'chat', 'message', 'note', 'deck', 'decks', 'hand', 'library', 'cards', 'cardName', 'sideboard', 'decklist'];
    for (const k of keys) {
      expect(isRedactedField(k), k).toBe(true);
      expect(line({ [k]: 'harmless' })[k], k).toBe(REDACTED);
    }
    for (const k of ['game', 'seat', 'action', 'ms', 'error', 'close', 'format', 'kind', 'status', 'detail', 'event2']) expect(isRedactedField(k), k).toBe(false);
  });

  it('a client address is written only in connection events', () => {
    for (const k of ['address', 'ip', 'peer', 'remote_address', 'X-Forwarded-For']) expect(isAddressField(k), k).toBe(true);
    expect(line({ address: '203.0.113.9' }, 'connectionOpen')['address']).toBe('203.0.113.9');
    expect(line({ address: '203.0.113.9' }, 'tableMade')['address']).toBe(REDACTED);
  });

  it('secrets inside free text are scrubbed by their shape: tokens, hashes, invite codes, bearer credentials, URL passwords', () => {
    const cases: [string, string][] = [
      [`hello with ${TOKEN} in it`, `hello with ${REDACTED} in it`],
      [`a longer run ${TOKEN}ff`, `a longer run ${REDACTED}`],
      ['code K7Q2-M9XD-4TPA-HW3N given', `code ${REDACTED} given`],
      ['code k7q2 m9xd 4tpa hw3n given', `code ${REDACTED} given`],
      ['Authorization: Bearer abc.def-123', `Authorization: Bearer ${REDACTED}`],
      ['connect postgres://owner:hunter2pass@db:5432/x failed', `connect postgres://owner:${REDACTED}@db:5432/x failed`],
    ];
    for (const [input, out] of cases) expect(scrubLogText(input), input).toBe(out);
    // not secrets: short hex, ordinary words, times
    for (const keep of ['game 01JABCDEF ok', 'deadbeef', 'at 12:00:00', 'ABCD-EFGH']) expect(scrubLogText(keep), keep).toBe(keep);
  });

  it('the configured secrets\' exact values are scrubbed from every field, the URL\'s password too; short values are not searched for', () => {
    const env = { LEDGER_SECRET: SECRET, METRICS_TOKEN: 'cd'.repeat(32), DATABASE_URL: 'postgres://svc:pa%24%24word99@db/openmtg', OTHER: 'not a secret' };
    const secrets = secretValuesOf(env);
    expect(secrets).toEqual(expect.arrayContaining([SECRET, 'cd'.repeat(32), 'postgres://svc:pa%24%24word99@db/openmtg', 'pa%24%24word99', 'pa$$word99']));
    expect(secrets).not.toContain('not a secret');
    const scrub = logScrubber(secrets);
    const l = line({ detail: 'the pass is pa$$word99 and the url postgres://svc:pa%24%24word99@db/openmtg' }, 'configWarning', scrub);
    expect(JSON.stringify(l)).not.toMatch(/pa\$\$word99|pa%24%24word99/);
    expect(logScrubber(['short'])('a short word')).toBe('a short word');
  });

  it('a secret is scrubbed before the value is cut, so no piece of it is left at the cut', () => {
    const v = `${'x'.repeat(LOG_VALUE_MAX - 10)}${TOKEN}`;
    const out = line({ detail: v })['detail'] as string;
    expect(out).not.toMatch(/ab{1}ab/);
    expect(out.endsWith('...') || out.endsWith(REDACTED)).toBe(true);
    expect(line({ detail: 'y'.repeat(LOG_VALUE_MAX + 50) })['detail']).toBe(`${'y'.repeat(LOG_VALUE_MAX)}...`);
  });

  it('control and bidi characters and broken surrogates from a client are escaped; a backslash is doubled; emoji stay', () => {
    expect(escapeLogText('a\nb‮c\u0000d\ud800e\\f🔥')).toBe('a\\u{a}b\\u{202e}c\\u{0}d\\u{d800}e\\\\f🔥');
    const l = formatLogLine(T, 'info', 'x‮', { detail: 'line\nbreak' });
    expect(l).not.toMatch(/‮/);
    expect(JSON.parse(l)).toMatchObject({ event: 'x\\u{202e}', detail: 'line\\u{a}break' });
  });

  it('only flat values: an object or array that reaches the logger is not written', () => {
    const l = JSON.parse(formatLogLine(T, 'info', 'e', { view: { hand: ['Forest'] } as unknown as string, list: ['a'] as unknown as string }));
    expect(l).toMatchObject({ view: '[not a flat value]', list: '[not a flat value]' });
    expect(JSON.stringify(l)).not.toMatch(/Forest/);
  });
});

describe('M13-14 the process logger', () => {
  it('writes at its level and above, adds a child\'s fields, scrubs with the secrets it was given, and never throws when the sink fails', () => {
    const lines: string[] = [];
    const log = new StdoutLogger('info', { worker: 1 }, (l) => lines.push(l), logScrubber([SECRET]));
    log.log('debug', 'quiet', {});
    log.child({ game: 'G1' }).log('warn', 'loud', { detail: `has ${SECRET}` });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', event: 'loud', worker: 1, game: 'G1', detail: `has ${REDACTED}` });
    const broken = new StdoutLogger('debug', {}, () => {
      throw new Error('EPIPE');
    });
    expect(() => broken.log('error', 'e', {})).not.toThrow();
  });

  it('the test logger formats as the real one does', () => {
    const m = new MemoryLogger({}, undefined, () => T);
    m.log('info', 'e', { token: TOKEN, game: 'G' });
    expect(m.lines[0]).toBe(formatLogLine(T, 'info', 'e', { token: TOKEN, game: 'G' }));
  });
});
