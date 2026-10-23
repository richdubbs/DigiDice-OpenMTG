/**
 * The server kit's pin (design 2.6; m12-multiplayer.md section 9): every name the hosted server takes from `@openmtg/net/server-kit`, with the exact type
 * milestone 13 relies on. A typecheck test: `npm run typecheck` fails when a re-exported name or signature changes (M12-5a rewrites `game/manual.ts`
 * and `game/limits.ts` in parallel; a change updates `packages/net/src/server-kit.ts` and this file in the same commit). The runtime part checks that
 * every name is there.
 */
import { describe, expect, it } from 'vitest';
import type { Action, AbilityCompiler, GameEvent, GameState, ManualOp, OracleCard, PlayerId } from '@openmtg/engine';
import type { ResolvedName } from '@openmtg/cards';
import * as kit from '@openmtg/net/server-kit';
import type {
  CardSource, DeckEntry, DeckProblems, DeckSubmission, DeckValidator, EventsForOptions, GateHandlers, GuestLimits, GuestMessage, JsonBounds, PreparedDeck, PrepareResult,
  RateConfig, ResolvedDeck,
} from '@openmtg/net/server-kit';
import {
  checkAction, checkDeckSubmission, cleanText, commanderVariantOf, DEFAULT_GUEST_LIMITS, describeOps, eventsFor, formatJoinCode, generateJoinCode, GuestGate,
  hasControl, hiddenActionInProgress, JOIN_CODE_LENGTH, jsonTextDepth, KeyedLimiter, LIMITS, measureJson, needsConsent, normalizeJoinCode, prepareDeck,
  printable, stopsVerdict, TokenBucket, unaliasOps, UNSEEN_ID, weakJoinCode,
} from '@openmtg/net/server-kit';

/** Exact type equality (not just assignability). */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const pin = <T extends true>(_: T): void => {};

// ---- validators and text (protocol/*)
pin<Equal<typeof checkAction, (x: unknown) => string | null>>(true);
pin<Equal<typeof checkDeckSubmission, (x: unknown) => string | null>>(true);
pin<Equal<typeof jsonTextDepth, (text: Buffer, maxDepth: number) => number | null>>(true);
pin<Equal<typeof measureJson, (value: unknown, b: JsonBounds) => 'depth' | 'nodes' | 'bytes' | null>>(true);
pin<Equal<JsonBounds, { maxDepth: number; maxNodes: number; maxBytes: number }>>(true);
pin<Equal<typeof cleanText, (s: string) => string>>(true);
pin<Equal<typeof hasControl, (s: string) => boolean>>(true);
pin<Equal<typeof printable, (s: string) => string>>(true);
pin<Equal<DeckEntry, { name: string; count: number }>>(true);
pin<Equal<DeckSubmission, { main: DeckEntry[]; sideboard: DeckEntry[]; commander?: DeckEntry[]; companion?: DeckEntry[] }>>(true);
pin<Equal<typeof LIMITS, {
  readonly name: 40; readonly chat: 500; readonly deckEntries: 300; readonly cardName: 200; readonly copies: 250; readonly mainCards: 250;
  readonly sideboardCards: 15; readonly commanderCards: 2; readonly companionCards: 1; readonly actionBytes: number; readonly actionDepth: 12;
  readonly actionNodes: 8192;
}>>(true);

// ---- flood control (game/limits.ts, link/ratelimit.ts)
pin<Equal<RateConfig, { rate: number; burst: number }>>(true);
pin<Equal<GuestLimits, {
  actions: RateConfig; queue: number; stops: RateConfig; chat: RateConfig; syncEveryMs: number; strikes: RateConfig; joins: RateConfig;
  consent: RateConfig; // RPL-3: replay choices (protocol 5); the hosted protocol has no such message
}>>(true);
pin<Equal<typeof DEFAULT_GUEST_LIMITS, GuestLimits>>(true);
pin<Equal<ConstructorParameters<typeof GuestGate>, [limits: GuestLimits, h: GateHandlers, clock?: () => number]>>(true);
// The seated guest's messages the gate takes (milestone 9's protocol; M12-5a's protocol 4 may add types: then update this pin and say so).
pin<Equal<GuestMessage['type'], 'hello' | 'action' | 'sync' | 'chat' | 'bye'>>(true);
pin<Equal<GuestGate['offer'], (m: GuestMessage) => void>>(true);
pin<Equal<GuestGate['strike'], () => void>>(true);
pin<Equal<GuestGate['stop'], () => void>>(true);
pin<Equal<GuestGate['drain'], () => void>>(true);
pin<Equal<GuestGate['queued'], number>>(true);
pin<Equal<keyof GateHandlers, 'run' | 'refuse' | 'sync' | 'abuse' | 'fail'>>(true);
pin<Equal<GateHandlers['run'], (m: GuestMessage) => void>>(true);
pin<Equal<GateHandlers['refuse'], (m: GuestMessage, why: string) => void>>(true);
pin<Equal<GateHandlers['sync'], () => void>>(true);
pin<Equal<GateHandlers['abuse'], () => void>>(true);
pin<Equal<GateHandlers['fail'], (e: unknown) => void>>(true);
pin<Equal<ConstructorParameters<typeof TokenBucket>, [config: RateConfig, now: number]>>(true);
pin<Equal<TokenBucket['take'], (now: number) => boolean>>(true);
pin<Equal<TokenBucket['wait'], (now: number) => number>>(true);
pin<Equal<TokenBucket['full'], (now: number) => boolean>>(true);
pin<Equal<ConstructorParameters<typeof KeyedLimiter>, [each: RateConfig, total: RateConfig, now: number, maxKeys?: number]>>(true);
pin<Equal<KeyedLimiter['take'], (key: string, now: number) => boolean>>(true);
pin<Equal<KeyedLimiter['prune'], (now: number) => void>>(true);
pin<Equal<KeyedLimiter['size'], number>>(true);

// ---- decks (game/deck.ts)
pin<Equal<typeof prepareDeck, (sub: DeckSubmission, o: { cards: CardSource; format: string; validate?: DeckValidator; compiler?: AbilityCompiler; clock?: () => number }) => Promise<PrepareResult>>>(true);
pin<Equal<PrepareResult, { ok: true; deck: PreparedDeck } | { ok: false; errors: string[]; warnings: string[] }>>(true);
pin<Equal<keyof PreparedDeck, 'main' | 'sideboard' | 'commanders' | 'companion' | 'defs' | 'warnings'>>(true);
pin<Equal<PreparedDeck['main'], string[]>>(true);
pin<Equal<PreparedDeck['commanders'], string[]>>(true);
pin<Equal<DeckValidator, (deck: ResolvedDeck, format: string) => DeckProblems>>(true);
pin<Equal<keyof CardSource, 'resolveNames' | 'suggest'>>(true);
pin<Equal<CardSource['resolveNames'], (names: string[]) => Promise<{ resolved: ResolvedName[] }>>>(true);
pin<Equal<CardSource['suggest'], ((name: string, limit?: number) => string[]) | undefined>>(true);
pin<Equal<ResolvedDeck, {
  main: { card: OracleCard; count: number }[]; sideboard: { card: OracleCard; count: number }[]; commander?: { card: OracleCard; count: number }[];
  companion?: { card: OracleCard; count: number }[];
}>>(true);
pin<Equal<DeckProblems, { errors: string[]; warnings: string[]; commanders?: string[]; companion?: string }>>(true);
pin<Equal<typeof commanderVariantOf, (format: string) => import('@openmtg/engine').CommanderVariant | null>>(true);

// ---- hidden information (game/redact.ts)
// RPL-0 moved both to the engine (core/view-events.ts) and widened the viewer: null is the open view, which a replay may show
pin<Equal<typeof eventsFor, (state: GameState, events: readonly GameEvent[], viewer: PlayerId | null, opts?: EventsForOptions) => GameEvent[]>>(true); // NETFIX1
pin<Equal<typeof UNSEEN_ID, ''>>(true);
pin<Equal<typeof hiddenActionInProgress, (state: GameState, viewer: PlayerId | null) => boolean>>(true);

// ---- by-hand changes (game/manual.ts)
pin<Equal<Parameters<typeof needsConsent>, [action: Action]>>(true);
pin<Equal<ReturnType<typeof needsConsent>, boolean>>(true);
pin<Equal<typeof describeOps, (state: GameState, ops: readonly ManualOp[], viewer: PlayerId) => string[]>>(true);
pin<Equal<typeof unaliasOps, (state: GameState, player: PlayerId, ops: ManualOp[]) => ManualOp[]>>(true);

// ---- setStops (game/stops.ts)
pin<Equal<typeof stopsVerdict, (state: GameState, action: Action) => 'over' | 'unchanged' | null>>(true);

// ---- invite codes (wire/codes.ts)
pin<Equal<typeof generateJoinCode, () => string>>(true);
pin<Equal<typeof normalizeJoinCode, (input: string) => string | null>>(true);
pin<Equal<typeof formatJoinCode, (code: string) => string>>(true);
pin<Equal<typeof weakJoinCode, (input: string) => string | null>>(true);

describe('M13-1: @openmtg/net/server-kit', () => {
  it('re-exports every piece the hosted server relies on', () => {
    const names = [
      'LIMITS', 'checkAction', 'checkDeckSubmission', 'jsonTextDepth', 'measureJson', 'cleanText', 'hasControl', 'printable', 'GuestGate', 'DEFAULT_GUEST_LIMITS',
      'TokenBucket', 'KeyedLimiter', 'prepareDeck', 'commanderVariantOf', 'eventsFor', 'hiddenActionInProgress', 'needsConsent', 'describeOps', 'unaliasOps',
      'stopsVerdict', 'generateJoinCode', 'normalizeJoinCode', 'formatJoinCode', 'weakJoinCode', 'JOIN_CODE_LENGTH', 'UNSEEN_ID', // NETFIX1/2
    ];
    for (const n of names) expect(kit, n).toHaveProperty(n);
    expect(Object.keys(kit).sort()).toEqual([...names].sort());
  });

  it('keeps the limits the hosted gateway reuses (design 3.1: actions 64 KB, depth 12, 8,192 values)', () => {
    expect(LIMITS.actionBytes).toBe(64 * 1024);
    expect(LIMITS.actionDepth).toBe(12);
    expect(LIMITS.actionNodes).toBe(8192);
    expect(JOIN_CODE_LENGTH).toBe(16);
  });

  it('keeps the seated guest limits of design 3.6 (actions 20/s burst 50, queue 32, stops 1/s, chat 2/s)', () => {
    expect(DEFAULT_GUEST_LIMITS.actions).toEqual({ rate: 20, burst: 50 });
    expect(DEFAULT_GUEST_LIMITS.queue).toBe(32);
    expect(DEFAULT_GUEST_LIMITS.stops.rate).toBe(1);
    expect(DEFAULT_GUEST_LIMITS.chat.rate).toBe(2);
  });

  it('runs the pure pieces as the hosted server will (token bucket on a fake clock, invite codes)', () => {
    const b = new TokenBucket({ rate: 1, burst: 2 }, 0);
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false]);
    expect(b.wait(0)).toBe(1000);
    expect(b.take(1000)).toBe(true);
    const code = generateJoinCode();
    const raw = normalizeJoinCode(code);
    expect(raw).toHaveLength(16);
    expect(weakJoinCode(raw!)).toBeNull();
    expect(needsConsent({ type: 'pass', player: 'p1' })).toBe(false);
  });
});
