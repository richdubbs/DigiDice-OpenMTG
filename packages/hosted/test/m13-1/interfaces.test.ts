/**
 * The interface contracts (design 4.5, 4.6, 8.1, 10.2): capacity units and the admission signals, the matcher's rounding, the store's method list, the
 * logger's redaction and escaping, the metrics' fixed names and labels, and the test doubles other packages use.
 */
import { describe, expect, it } from 'vitest';
import {
  admissible, capacityUnits, checkMetric, DEFAULT_ADMISSION_LIMITS, DEFAULT_MATCH_POLICY, escapeLogText, estimateWaitMs, formatLogLine, GAME_STORE_METHODS,
  HOSTED_FORMATS, ImmediateAdmission, isRedactedField, MemoryLogger, MemoryMetrics, METRIC_LABEL_VALUES, METRICS, NULL_LOGGER, queueKeyString,
  roundedWaiting, softSignal, type Admission, type CapacitySignals, type EnterRefusal, type GameStore, type Matcher, type MatcherContext,
  type MetricName, type QueueKey,
} from '@openmtg/hosted';
import * as hosted from '@openmtg/hosted';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const pin = <T extends true>(_: T): void => {};
pin<Equal<(typeof GAME_STORE_METHODS)[number], keyof GameStore>>(true);
// (M13-10 widened it, additively: the welcome's capacity, a waiting table's place, the sessions that wait, and the restart's ordered asks)
pin<Equal<keyof Admission, 'request' | 'withdraw' | 'begun' | 'released' | 'freed' | 'tick' | 'size' | 'drain' | 'capacityState' | 'lookup' | 'isWaiting' | 'hasWaitingSession' | 'restore'>>(true);
pin<Equal<ReturnType<Admission['size']>, { starts: number; units: number; reserved: number }>>(true);
pin<Equal<keyof Matcher, 'enter' | 'leave' | 'tick' | 'requeueFront' | 'missed' | 'status' | 'queued'>>(true);
// The matcher is given the session lookup it cannot know itself ('atTable'), and whether a queue is offered ('notOffered').
pin<Equal<MatcherContext['sessionBusy'], (session: string) => boolean>>(true);
pin<Equal<MatcherContext['offered'], (key: QueueKey) => boolean>>(true);
pin<Equal<EnterRefusal, 'inQueue' | 'atTable' | 'address' | 'cooldown' | 'notOffered'>>(true);

const calm: CapacitySignals = { runningUnits: 0, cpu: 0.1, p95ActionMs: 20, workerHeap: 0.3, outbound: 0.05 };
const L = DEFAULT_ADMISSION_LIMITS;

describe('M13-1: capacity admission contract', () => {
  it('units: a 1v1 game 1, a 3-player pod 4, a 4-player pod 5 (configurable)', () => {
    expect([capacityUnits(2), capacityUnits(3), capacityUnits(4)]).toEqual([1, 4, 5]);
    expect(capacityUnits(4, { two: 1, three: 3, four: 6 })).toBe(6);
    // the expected mix (answer 16): about 400 1v1 games and 100 pods is the default soft limit
    expect(400 * capacityUnits(2) + 100 * capacityUnits(4)).toBe(L.capacityUnits);
  });

  it('the soft limit: units, CPU 75%, p95 100 ms, worker heap 80%, outbound 80%', () => {
    expect(softSignal(calm, L)).toBeNull();
    expect(softSignal({ ...calm, runningUnits: 900 }, L)).toBe('units');
    expect(softSignal({ ...calm, cpu: 0.75 }, L)).toBe('cpu');
    expect(softSignal({ ...calm, p95ActionMs: 100 }, L)).toBe('p95');
    expect(softSignal({ ...calm, p95ActionMs: null }, L)).toBeNull();
    expect(softSignal({ ...calm, workerHeap: 0.8 }, L)).toBe('heap');
    expect(softSignal({ ...calm, outbound: 0.8 }, L)).toBe('outbound');
  });

  it('admissible: the units fit beside running and reserved units, and no other soft signal is set (the head and an empty queue alike)', () => {
    expect(admissible(calm, L, 5, 0)).toBe(true);
    expect(admissible({ ...calm, runningUnits: 899 }, L, 1, 0)).toBe(true);
    expect(admissible({ ...calm, runningUnits: 899 }, L, 5, 0)).toBe(false); // a pod waits until 5 units are free...
    expect(admissible({ ...calm, runningUnits: 895 }, L, 5, 0)).toBe(true); // ...and then nobody behind it can pass it (FIFO)
    // any soft signal but units stops admissions, the head included (design 4.6's critical level, 90%, is above every soft level: subsumed)
    for (const s of [{ cpu: 0.9 }, { p95ActionMs: 150 }, { workerHeap: 0.85 }, { outbound: 0.8 }, { workerHeap: 0.95 }, { outbound: 0.99 }]) {
      expect(admissible({ ...calm, ...s }, L, 1, 0), JSON.stringify(s)).toBe(false);
    }
    expect('critical' in hosted).toBe(false);
  });

  it('reserved units: one freed slot admits one head, not several within a ready-check window', () => {
    // 5 units free; a pod is admitted and its ready check runs (reserved 5): the next head (a 1v1) does not fit until the pod begins or is released.
    const s = { ...calm, runningUnits: 895 };
    expect(admissible(s, L, 5, 0)).toBe(true);
    expect(admissible(s, L, 1, 5)).toBe(false);
    // the pod began: the runtime counts it as running, the reservation ends
    expect(admissible({ ...calm, runningUnits: 900 }, L, 1, 0)).toBe(false);
    // the pod's ready check failed: released, the units are free again
    expect(admissible(s, L, 1, 0)).toBe(true);
  });

  it('estimates the wait from the units freed in the last 10 minutes', () => {
    expect(estimateWaitMs(10, 0)).toBeNull();
    expect(estimateWaitMs(10, 100)).toBe(60_000);
    expect(estimateWaitMs(5, 5, 60_000)).toBe(60_000);
  });

  it('ImmediateAdmission (a test double for M13-6) admits everything until drained, and keeps reservations until begun or released', () => {
    const a: Admission = new ImmediateAdmission();
    const r = { table: 'g1', source: 'listed' as const, seats: 2 as const, units: 1, sessions: ['s1', 's2'], addressKeys: ['k1', 'k2'], since: 0 };
    expect(a.request(r, 0)).toEqual({ kind: 'admitted' });
    expect(a.request({ ...r, table: 'g3', seats: 4, units: 5 }, 0)).toEqual({ kind: 'admitted' });
    expect(a.size()).toEqual({ starts: 0, units: 0, reserved: 6 });
    a.begun('g1', 1);
    a.released('g3', 1);
    expect(a.size().reserved).toBe(0);
    a.drain();
    expect(a.request({ ...r, table: 'g2' }, 1)).toMatchObject({ kind: 'refused', reason: 'draining' });
  });

  it('the hard limits of design 4.6', () => {
    expect(L.queueMax).toBe(300);
    expect(L.waitMaxMs).toBe(20 * 60_000);
    expect(L.perAddress).toBe(2);
  });
});

describe('M13-1: matchmaking contract', () => {
  it('queue keys, the policy of design 4.5, and the rounded waiting count', () => {
    expect(queueKeyString({ format: 'commander', size: 'pod' })).toBe('commander/pod');
    expect(queueKeyString({ format: 'pauper', size: 2 })).toBe('pauper/2');
    expect(DEFAULT_MATCH_POLICY).toMatchObject({ podFill: 4, podThreeAfterMs: 90_000, rematchAfterMs: 60_000, perAddress: 2 });
    expect([0, 1, 5, 6, 7, 8, 12, 50, 51, 55, 123].map(roundedWaiting)).toEqual([0, 1, 5, 5, 5, 10, 10, 50, 50, 60, 120]);
  });
});

describe('M13-1: storage contract', () => {
  it('lists the GameStore methods (M13-4 implements them for memory, file and PostgreSQL)', () => {
    expect(GAME_STORE_METHODS).toHaveLength(25); // M13-4 added countEngineError, sessionResults and setReportStatus; M13-6 tableRow, openTables and markSeatLeft
    expect(new Set(GAME_STORE_METHODS).size).toBe(25);
  });
});

describe('M13-1: observability contract', () => {
  const at = new Date('2026-10-15T12:00:00Z');

  it('escapes control and bidi characters and unpaired surrogates from clients', () => {
    expect(escapeLogText('ok 🐉')).toBe('ok 🐉');
    expect(escapeLogText('a\u001b[2Jb')).toBe('a\\u{1b}[2Jb');
    expect(escapeLogText('x‮y')).toBe('x\\u{202e}y');
    expect(escapeLogText('\ud800!')).toBe('\\u{d800}!');
    expect(escapeLogText('new\nline')).toBe('new\\u{a}line');
    expect(escapeLogText('back\\slash')).toBe('back\\\\slash');
  });

  it('formats one JSON line, redacting secret, code and free-text fields whatever the caller passes', () => {
    const line = formatLogLine(at, 'info', 'tableCreated', {
      game: 'g1', seat: 2, action: 'cast', ms: 3.5, token: 'a'.repeat(64), password: 'hunter22', inviteCode: 'ABCD-EFGH', sessionToken: 'x', deck: '4 Bolt',
      text: 'chat words', ledgerSecret: 's', seed: 'abc', errorCode: 'stale', error: 'stale', close: 4004, title: 'Bad\u202eTitle', kind: 'listed',
      name: 'Al\u202eice',
    });
    const o = JSON.parse(line) as Record<string, unknown>;
    expect(o).toMatchObject({ time: '2026-10-15T12:00:00.000Z', level: 'info', event: 'tableCreated', game: 'g1', seat: 2, action: 'cast', ms: 3.5, error: 'stale', close: 4004, kind: 'listed' });
    for (const k of ['token', 'password', 'inviteCode', 'sessionToken', 'deck', 'text', 'ledgerSecret', 'seed', 'errorCode', 'title']) expect(o[k], k).toBe('[redacted]');
    expect(o['name']).toBe('Al\\u{202e}ice');
    expect(line).not.toMatch(/hunter22|aaaaaaaa|ABCD-EFGH|Bolt|chat words|Title/);
  });

  it('redacts every spelling of a secret or code key (normalized: lowercase, letters and digits only)', () => {
    const redacted = [
      'databaseUrl', 'DATABASE_URL', 'invite_code', 'inviteCodes', 'codes', 'code', 'passwords', 'tokens', 'apiKey', 'api-key', 'authHeader', 'Authorization',
      'bearer', 'privateKey', 'credentials', 'dsn', 'joinCodeRaw', 'passwd', 'cookie', 'salt', 'deckList', 'closeCode', 'reason', 'voidReason', 'note',
      'title', 'chatText', 'message', 'hand', 'library',
    ];
    for (const k of redacted) expect(isRedactedField(k), k).toBe(true);
    for (const k of ['game', 'seat', 'action', 'ms', 'error', 'close', 'kind', 'status', 'format', 'seq', 'units', 'name', 'worker']) expect(isRedactedField(k), k).toBe(false);
  });

  it('refuses nested values and cuts long strings', () => {
    const o = JSON.parse(formatLogLine(at, 'warn', 'x', { obj: { hand: ['Bolt'] } as never, long: 'y'.repeat(1000) })) as Record<string, string>;
    expect(o['obj']).toBe('[not a flat value]');
    expect(o['long']!.length).toBeLessThan(310);
  });

  it('MemoryLogger and children share the lines; NULL_LOGGER drops them', () => {
    const log = new MemoryLogger({}, undefined, () => at);
    log.child({ game: 'g7' }).log('info', 'applied', { seat: 1 });
    expect(log.entries()).toEqual([{ time: at.toISOString(), level: 'info', event: 'applied', game: 'g7', seat: 1 }]);
    NULL_LOGGER.child({}).log('error', 'nothing');
  });

  it('metrics: fixed names, a fixed set of labels, and closed sets of label values', () => {
    const m = new MemoryMetrics(4);
    m.inc(METRICS.actions);
    m.inc(METRICS.voids, { reason: 'abandoned' }, 2);
    m.observe(METRICS.actionSeconds, 0.012, { format: 'pauper' });
    m.set(METRICS.capacitySoft, 1, { signal: 'units' });
    m.set(METRICS.workerHeapBytes, 1e9, { worker: '3' });
    m.set(METRICS.matchQueue, 7, { format: 'commander', size: 'pod' });
    m.inc(METRICS.refusals, { reason: 'serverBusy' });
    m.inc(METRICS.refusals, { reason: 'queueFull' });
    m.set(METRICS.tables, 2, { status: 'waitingCapacity' });
    expect(m.values.get('openmtg_hosted_voids_total{reason="abandoned"}')).toBe(2);
    expect(() => m.inc('openmtg_hosted_made_up' as MetricName)).toThrow(/Unknown metric/);
    expect(() => m.inc(METRICS.actions, { game: 'g1' } as never)).toThrow(/not allowed/);
    // free values never become label values
    const bad: Record<string, string>[] = [
      { format: 'historic' }, { format: 'Alice' }, { size: '5' }, { size: 'two' }, { worker: '4' }, { worker: '-1' }, { worker: '01' }, { worker: 'w1' },
      { reason: 'player Alice timed out' }, { status: 'g123' }, { kind: '01JSESSION' }, { signal: 'memory' }, { store: 'sqlite' },
    ];
    for (const l of bad) expect(() => m.inc(METRICS.actions, l), JSON.stringify(l)).toThrow(/not below|not one of/);
    expect(() => checkMetric(METRICS.workerHeapBytes, { worker: '6' }, 7)).not.toThrow();
    expect(() => checkMetric(METRICS.workerHeapBytes, { worker: '7' }, 7)).toThrow();
    expect(METRIC_LABEL_VALUES.format).toEqual(HOSTED_FORMATS.map((x) => x.id));
    for (const name of Object.values(METRICS)) expect(name).toMatch(/^openmtg_hosted_[a-z0-9_]+$/);
  });
});
