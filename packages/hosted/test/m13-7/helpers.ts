/**
 * Test helpers for the results ledger (in process, fake time only, no sockets): scripted tables of real engine games with a few synthetic sorceries
 * (each player loses life, a player loses or wins the game, poison counters), a driver that plays them through the table actor, and a memory ledger
 * store (the `GameStore` methods the ledger uses; M13-4 builds the real stores).
 */
import { expect } from 'vitest';
import { compileCardDetailed, defaultCompileSources, type CardDef, type GameConfig, type OracleCard, type PlayerId } from '@openmtg/engine';
import { chooseAction } from '@openmtg/ai';
import type { SeatNumber } from '@openmtg/hosted/api';
import type { GameRecord, GameStore, LedgerSeat, LogRecord, VoidReason } from '../../src';
import { Harness } from '../m13-2/harness';
import { compiledDefs } from '../../../engine/test/fixtures';

export const SECRET = 'm13-7-ledger-secret-0123456789abcdef0123456789';

/** Synthetic sorceries for {R} (the default compiler's templates; probed in M13-7). */
export const SPELLS = {
  quake: { name: 'Test Quake', text: 'Each player loses 3 life.' },
  doom: { name: 'Test Doom', text: 'Target player loses the game.' },
  triumph: { name: 'Test Triumph', text: 'You win the game.' },
  venom: { name: 'Test Venom', text: 'Target player gets ten poison counters.' },
} as const;

export type SpellKey = keyof typeof SPELLS;

function spellDef(key: SpellKey): CardDef {
  const s = SPELLS[key];
  const card = { name: s.name, layout: 'normal', type_line: 'Sorcery', mana_cost: '{R}', cmc: 1, colors: ['R'], oracle_text: s.text } as unknown as OracleCard;
  return compileCardDetailed(card, defaultCompileSources()).def;
}

/**
 * A two-player game: p1 ('One') holds Mountains and 20 copies of the spell, p2 ('Two') only Mountains (`p2Cards` of them: 7 empties p2's library
 * with the opening hand). No mulligans.
 */
export function scriptedConfig(seed: string, spell: SpellKey | null, o: { startingLife?: number; p2Cards?: number } = {}): GameConfig {
  const defs: CardDef[] = [...compiledDefs(['Mountain']), ...(spell ? [spellDef(spell)] : [])];
  const p1 = [...Array<string>(20).fill('Mountain'), ...Array<string>(20).fill(spell ? SPELLS[spell].name : 'Mountain')];
  const p2 = Array<string>(o.p2Cards ?? 40).fill('Mountain');
  return {
    seed: `${seed}/seed`, // never the game id: the hidden-information scan checks that the seed is never sent
    players: [
      { name: 'One', deck: p1 },
      { name: 'Two', deck: p2 },
    ],
    defs,
    options: { skipMulligans: true, ...(o.startingLife !== undefined ? { startingLife: o.startingLife } : {}) },
  };
}

/** The name of a view object's card. */
function nameOf(h: Harness, seat: number, id: string): string | undefined {
  const v = h.b(seat).view!;
  const o = v.objects[id];
  return o ? v.defs[o.defId]?.name : undefined;
}

/**
 * Drives the table: every player plays a land when they may; `caster` casts `spell` (targeting `target` when it asks) once; every other priority
 * is a pass, every other decision the AI's. Stops at the end of the game or after `max` actions. Time advances `stepMs` per action.
 */
export function drive(h: Harness, o: { caster?: PlayerId; spell?: string; target?: PlayerId; max?: number; stepMs?: number } = {}): void {
  let cast = false;
  const max = o.max ?? 600;
  for (let i = 0; i < max && !h.actor.ended; i++) {
    const d = h.state.pending;
    if (!d) break;
    const seat = h.seatOf(d.player);
    const b = h.b(seat);
    h.at += o.stepMs ?? 500;
    if (d.kind === 'priority') {
      // Every player plays a land a turn: hands never pass seven, so nobody discards (a discard's old hand id: M13-2's known NETFIX2 case).
      const land = b.legal.find((l) => l.kind === 'playLand');
      if (land) {
        h.act(seat, land.action);
        continue;
      }
      if (o.spell && !cast && d.player === o.caster) {
        const castIt = b.legal.find((l) => l.kind === 'cast' && l.action.type === 'cast' && nameOf(h, seat, l.action.card) === o.spell);
        if (castIt) {
          const { reply } = h.act(seat, castIt.action);
          expect(reply?.ok, 'the cast is accepted').toBe(true);
          cast = true;
          continue;
        }
      }
      h.act(seat, { type: 'pass', player: d.player });
      continue;
    }
    if (d.kind === 'chooseTargets' && o.target) {
      h.act(seat, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: o.target }] } });
      continue;
    }
    if (d.kind === 'payCost') {
      h.act(seat, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'payCost', auto: true } });
      continue;
    }
    const view = b.view!;
    h.act(seat, chooseAction(view, view.pending!, `drive-${i}`));
  }
}

/** The table seats' identity rows for the ledger: session `s-<seat>`, a fixed fingerprint per seat. */
export function ledgerSeats(n: number): LedgerSeat[] {
  return Array.from({ length: n }, (_, i) => ({ seat: (i + 1) as SeatNumber, session: `01JSESSION000000000000000S${i + 1}`, account: null, deckHash: 'abcd'[i]!.repeat(64) }));
}

/** The game row of a scripted table. */
export function ledgerGame(game: string, seats: 2 | 3 | 4 = 2) {
  return { game, format: 'casual', variant: null, seats, source: 'listed' as const, startedAt: 0, engineBuild: 'test-build' };
}

/** The ledger part of a store, in memory, append-only: a result is written once; a finished game is never voided and a void game never finished. */
export class MemoryLedgerStore implements Pick<GameStore, 'finishGame' | 'voidGame' | 'results' | 'sessionResults'> {
  readonly finished = new Map<string, { record: GameRecord; last: LogRecord | undefined }>();
  readonly voided = new Map<string, { reason: VoidReason; status: 'void' | 'quarantined'; record?: GameRecord }>();
  /** Calls of `results`. */
  readonly reads: { since: string; limit: number }[] = [];
  /** Calls of `sessionResults`. */
  readonly sessionReads: { session: string; since: string; limit: number }[] = [];

  async finishGame(id: string, record: GameRecord, last?: LogRecord): Promise<void> {
    if (this.finished.has(id) || this.voided.has(id)) throw new Error(`append-only: game ${id} already has its result`);
    if (record.game !== id) throw new Error('record of another game');
    this.finished.set(id, { record: structuredClone(record), last: last ? structuredClone(last) : undefined });
  }

  async voidGame(id: string, reason: VoidReason, status: 'void' | 'quarantined' = 'void', record?: GameRecord): Promise<void> {
    if (this.finished.has(id) || this.voided.has(id)) throw new Error(`append-only: game ${id} already has its result`);
    if (record && (record.game !== id || record.outcome !== 'void' || record.reason !== reason)) throw new Error("voidGame: the record must be this game's void record");
    this.voided.set(id, { reason, status, ...(record ? { record: structuredClone(record) } : {}) });
  }

  /** The session's games (a placement of it) ended at or after `since`, newest first, at most `limit` (M13-4's contract). */
  async sessionResults(session: string, o: { since: Date; limit: number; before?: { endedAt: string; game: string } }): Promise<GameRecord[]> {
    this.sessionReads.push({ session, since: o.since.toISOString(), limit: o.limit });
    const s = o.since.toISOString();
    const b = o.before;
    return [...this.finished.values()]
      .map((f) => f.record)
      .filter((r) => r.endedAt >= s && r.placements.some((p) => p.session === session))
      .filter((r) => !b || r.endedAt < b.endedAt || (r.endedAt === b.endedAt && r.game < b.game))
      .sort((x, y) => (x.endedAt < y.endedAt ? 1 : x.endedAt > y.endedAt ? -1 : x.game < y.game ? 1 : -1))
      .slice(0, o.limit)
      .map((r) => structuredClone(r));
  }

  /** Games ended at or after `since`, oldest first, at most `limit`. */
  async results(since: Date, limit: number): Promise<GameRecord[]> {
    this.reads.push({ since: since.toISOString(), limit });
    const s = since.toISOString();
    return [...this.finished.values()]
      .map((f) => f.record)
      .filter((r) => r.endedAt >= s)
      .sort((a, b) => (a.endedAt < b.endedAt ? -1 : a.endedAt > b.endedAt ? 1 : a.game < b.game ? -1 : 1))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
}
