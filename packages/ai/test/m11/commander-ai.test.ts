/**
 * M11-3 (docs/design/m11-commander.md 7): the minimal Commander AI. No tuning (milestone 10 is on hold): the bot scores a cast of its commander from the
 * command zone like the same card in its hand, with the commander tax in the cost (CR 903.8); answers the 903.9 choice with the command zone; attacks
 * with its commander like any creature, plus one bonus: a commander whose hit reaches the variant's commander-damage limit attacks (CR 903.10a, 704.6c),
 * read from the variant's data (`options.commander.damageLimit`: none in Brawl, CR 903.12h, nor in Duel Commander by OpenMTG's choice).
 *
 * The unit tests build Commander states by hand and score hand-built legal actions, so they need nothing from M11-1. The whole computer game that casts
 * its commander needs M11-1's legal actions (casts from the command zone): it is skipped until M11-1 merges.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMANDER_VARIANTS, commanderOptions, commandersOf, createGame, viewFor,
  type Action, type CommanderVariant, type GameConfig, type GameState, type LegalAction, type ObjectId, type PlayerId,
} from '@openmtg/engine';
import { compiledDefs } from '../../../engine/test/fixtures';
import { act, put } from '../../../engine/test/m3/scenario';
import { clone } from '../../../engine/src/util/clone';
import { castTax, commanderDamageLeft, makeCtx } from '../../src/context';
import { chooseAction } from '../../src/index';
import { scoreAction } from '../../src/plays';
import { windowOf } from '../../src/windows';
import { AI_STOPS } from '../../src/index';
import { expand, WB_REMOVAL } from '../decks';
import { aiAgent, playGame } from '../harness';

const CARDS = ['Plains', 'Forest', 'Blor the Impervious', 'Isamaru, Hound of Konda', 'Thalia, Guardian of Thraben', 'Craw Wurm'];

/**
 * A game at p1's first main phase, both players with full control. `variant` null: a normal game (no commanders). p1's commander is `p1Commander`, p2's
 * Thalia. Hands and libraries are emptied, then refilled from `zones` (and 20 Plains in each library so nobody decks).
 */
function game(variant: CommanderVariant | null, p1Commander: string, zones: { p1?: { battlefield?: string[]; hand?: string[] }; p2?: { battlefield?: string[] } } = {}): GameState {
  const deck = Array<string>(40).fill('Plains');
  const config: GameConfig = {
    seed: 'm11-ai',
    players: [
      { name: 'Alice', deck, stops: { fullControl: true }, ...(variant ? { commanders: [p1Commander] } : {}) },
      { name: 'Bob', deck, stops: { fullControl: true }, ...(variant ? { commanders: ['Thalia, Guardian of Thraben'] } : {}) },
    ],
    defs: compiledDefs(CARDS),
    options: { startingPlayer: 'p1', skipMulligans: true, ...(variant ? { commander: commanderOptions(variant) } : {}) },
  };
  let s = clone(createGame(config));
  for (const p of ['p1', 'p2'] as const) {
    for (const z of ['hand', 'library'] as const) {
      for (const id of s.zones[z][p]!) delete s.objects[id];
      s.zones[z][p] = [];
    }
    for (let i = 0; i < 20; i++) put(s, p, 'library', 'Plains');
    for (const name of zones[p]?.battlefield ?? []) put(s, p, 'battlefield', name);
  }
  for (const name of zones.p1?.hand ?? []) put(s, 'p1', 'hand', name);
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

const commanderObject = (s: GameState, player: PlayerId): ObjectId => s.zones.command.find((id) => s.objects[id]!.owner === player)!;

/** Put a player's commander from the command zone onto the battlefield (test setup: as if it had been cast earlier; not summoning sick). */
function commanderToBattlefield(s: GameState, player: PlayerId): ObjectId {
  const id = commanderObject(s, player);
  s.zones.command = s.zones.command.filter((x) => x !== id);
  s.zones.battlefield.push(id);
  s.objects[id] = { ...s.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
  return id;
}

const castOf = (id: ObjectId): LegalAction => ({ action: { type: 'cast', player: 'p1', card: id }, kind: 'cast', label: 'Cast', isMana: false, object: id });

function score(s: GameState, id: ObjectId): number {
  const v = viewFor(s, 'p1');
  const ctx = makeCtx(v, v.pending!, 'm11-ai');
  return scoreAction(ctx, castOf(id), windowOf(ctx));
}

describe('M11-3: the bot casts its commander from the command zone (CR 903.8)', () => {
  const FORESTS = Array<string>(7).fill('Forest');

  it('scores the command-zone cast like the same card in its hand when there is no tax yet', () => {
    const s = game('commander', 'Blor the Impervious', { p1: { battlefield: FORESTS, hand: ['Blor the Impervious'] } });
    const fromCommand = commanderObject(s, 'p1');
    const fromHand = s.zones.hand['p1']![0]!;
    const v = viewFor(s, 'p1');
    expect(castTax(makeCtx(v, v.pending!, 'x'), fromCommand)).toBe(0);
    expect(score(s, fromCommand)).toBeGreaterThan(0);
    expect(score(s, fromCommand)).toBe(score(s, fromHand));
  });

  it('CR 903.8: the tax counts in the cost: {2} for each earlier cast from the command zone makes the same cast score that much less', () => {
    const s = game('commander', 'Blor the Impervious', { p1: { battlefield: FORESTS, hand: ['Blor the Impervious'] } });
    const fromCommand = commanderObject(s, 'p1');
    const fromHand = s.zones.hand['p1']![0]!;
    s.players[0]!.commanders![0]!.casts = 1;
    const v = viewFor(s, 'p1');
    expect(castTax(makeCtx(v, v.pending!, 'x'), fromCommand)).toBe(2);
    expect(castTax(makeCtx(v, v.pending!, 'x'), fromHand)).toBe(0); // only a cast from the command zone pays it
    expect(score(s, fromCommand)).toBe(score(s, fromHand) - 2);
    expect(score(s, fromCommand)).toBeGreaterThan(0); // still cast when it is the play there is
  });

  it('the tax is the variant\'s data (COMMANDER_VARIANTS), never a constant', () => {
    const s = game('brawl', 'Blor the Impervious', { p1: { battlefield: FORESTS } });
    s.players[0]!.commanders![0]!.casts = 2;
    const v = viewFor(s, 'p1');
    expect(castTax(makeCtx(v, v.pending!, 'x'), commanderObject(s, 'p1'))).toBe(2 * COMMANDER_VARIANTS.brawl.options.tax);
  });

  it('CR 903.9a-b: answers the commander-zone choice with the command zone (M11-0\'s default answer)', () => {
    const s = game('commander', 'Blor the Impervious');
    const v = viewFor(s, 'p1');
    const id = commanderObject(s, 'p1');
    const a = chooseAction(v, { id: 'd-m11', kind: 'commanderZone', player: 'p1', prompt: '', object: id, card: s.objects[id]!.cardId!, rule: '903.9a', zone: 'graveyard' }, 'x');
    expect(a).toEqual({ type: 'answer', player: 'p1', decisionId: 'd-m11', answer: { kind: 'commanderZone', command: true } });
  });
});

describe('M11-3: the bot attacks with its commander, counting commander damage toward the variant\'s limit (CR 903.10a, 704.6c)', () => {
  /** p1's Isamaru (a 2/2 commander) on the battlefield facing p2's untapped Craw Wurm (6/4); p2 has taken `taken` commander damage from Isamaru. */
  function toAttack(variant: CommanderVariant | null, taken: number): { s: GameState; isamaru: ObjectId } {
    let s = game(variant, 'Isamaru, Hound of Konda', { p2: { battlefield: ['Craw Wurm'] } });
    let isamaru: ObjectId;
    if (variant) {
      isamaru = commanderToBattlefield(s, 'p1');
      const card = s.objects[isamaru]!.cardId!;
      if (taken > 0) s.players[1]!.commanderDamage = { [card]: taken };
    } else {
      isamaru = put(s, 'p1', 'battlefield', 'Isamaru, Hound of Konda');
    }
    while (s.pending?.kind !== 'declareAttackers') s = act(s, { type: 'pass', player: s.pending!.player });
    return { s, isamaru };
  }
  const attackers = (s: GameState): string[] => {
    const v = viewFor(s, 'p1');
    const a = chooseAction(v, v.pending!, 'm11-ai') as Extract<Action, { type: 'answer' }>;
    return (a.answer as { attacks: { attacker: string }[] }).attacks.map((x) => x.attacker);
  };

  it('like any creature: a 2/2 does not attack into an untapped 6/4 (CR 508.1), in a normal game and in Commander far from the limit', () => {
    expect(attackers(toAttack(null, 0).s)).toEqual([]);
    expect(attackers(toAttack('commander', 0).s)).toEqual([]);
    expect(attackers(toAttack('commander', 18).s)).toEqual([]); // 18 + 2 < 21
  });

  it('CR 903.10a, 704.6c: attacks when its hit would bring the commander damage to the limit (21 in Commander)', () => {
    const { s, isamaru } = toAttack('commander', 19);
    const v = viewFor(s, 'p1');
    const ctx = makeCtx(v, v.pending!, 'x');
    expect(commanderDamageLeft(ctx, isamaru, 'p2')).toBe(2);
    expect(attackers(s)).toEqual([isamaru]);
  });

  it('CR 903.12h: no commander-damage rule in Brawl or Standard Brawl, so no bonus there', () => {
    for (const variant of ['brawl', 'standardbrawl'] as const) {
      const { s, isamaru } = toAttack(variant, 19);
      const v = viewFor(s, 'p1');
      expect(commanderDamageLeft(makeCtx(v, v.pending!, 'x'), isamaru, 'p2'), variant).toBeNull();
      expect(attackers(s), variant).toEqual([]);
    }
  });

  it('Duel Commander follows its variant data, never an assumed 21', () => {
    const { s, isamaru } = toAttack('duel', 19);
    const limit = COMMANDER_VARIANTS.duel.options.damageLimit;
    const v = viewFor(s, 'p1');
    expect(commanderDamageLeft(makeCtx(v, v.pending!, 'x'), isamaru, 'p2')).toBe(limit === null ? null : Math.max(0, limit - 19));
    expect(attackers(s)).toEqual(limit !== null && limit - 19 <= 2 ? [isamaru] : []);
  });

  it('the limit is read from the game\'s options: a game with another limit uses that one', () => {
    const { s, isamaru } = toAttack('commander', 8);
    s.options = { ...s.options, commander: { ...s.options.commander!, damageLimit: 10 } };
    expect(attackers(s)).toEqual([isamaru]);
  });
});

describe('M11-3: a computer game that casts its commander (needs M11-1)', () => {
  it('AI against AI in a Commander game: each bot casts its commander from the command zone, every AI action is accepted, the game ends', { timeout: 120_000 }, () => {
    const deck = expand(WB_REMOVAL);
    const names = [...new Set([...deck, 'Isamaru, Hound of Konda', 'Thalia, Guardian of Thraben'])];
    const config: GameConfig = {
      seed: 'm11-ai-game',
      players: [
        { name: 'One', deck, commanders: ['Isamaru, Hound of Konda'], stops: AI_STOPS },
        { name: 'Two', deck, commanders: ['Thalia, Guardian of Thraben'], stops: AI_STOPS },
      ],
      defs: compiledDefs(names),
      // 20 life (an explicit startingLife wins over the variant's 40, m11 design 4.1) only keeps this default-suite game short; the rest is Commander.
      options: { commander: commanderOptions('commander'), startingLife: 20 },
    };
    const g = playGame(config, { p1: aiAgent('m11-one'), p2: aiAgent('m11-two') });
    expect(g.rejected).toEqual([]);
    expect(g.finished).toBe(true);
    for (const p of ['p1', 'p2']) expect(commandersOf(g.state, p)[0]!.casts, p).toBeGreaterThan(0); // CR 903.8: counted as it was cast (CR 601.2i)
  });
});
