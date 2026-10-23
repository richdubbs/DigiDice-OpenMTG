/**
 * CMP1: companion in the game (CR 702.139a-d, 116.2g, 400.11, 103.2b), with real fixture cards on the game path.
 *   - The companion a player reveals (PlayerConfig.companion) starts outside the game (CR 400.11), revealed to every player (CR 702.139a, 103.2b).
 *   - "Once during the game, any time you have priority and the stack is empty, but only during a main phase of your turn, you may pay {3} and put that card
 *     into your hand. This is a special action that doesn't use the stack" (CR 702.139a, 116.2g); the card stays in the game (CR 702.139c).
 *   - A game without a companion is unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction, commanderOptions, compileCard, createGame, legalActions, replay, viewFor, type Action, type GameConfig, type GameState, type PlayerConfig, type PlayerId,
} from '../../src/index';
import { clone } from '../../src/util/clone';
import { compiledDefs, getCard } from '../fixtures';
import { act, put } from '../m3/scenario';
import { drive, resolveTop } from '../m5/cr-examples/helpers';
import { logHas } from '../m4/helpers';

const LURRUS = 'Lurrus of the Dream-Den';
const YORION = 'Yorion, Sky Nomad';
const COMPANIONS = [
  'Gyruda, Doom of Depths', 'Jegantha, the Wellspring', 'Kaheera, the Orphanguard', 'Keruga, the Macrosage', LURRUS, 'Lutri, the Spellchaser',
  'Obosh, the Preypiercer', 'Umori, the Collector', YORION, 'Zirda, the Dawnwaker',
];
const FULL = { fullControl: true } as const;

function config(p1: Partial<PlayerConfig> = {}, p2: Partial<PlayerConfig> = {}, extra: Partial<GameConfig> = {}): GameConfig {
  const deck = Array(40).fill('Plains') as string[];
  return {
    seed: 'cmp1',
    players: [
      { name: 'Alice', deck, stops: FULL, ...p1 },
      { name: 'Bob', deck, stops: FULL, ...p2 },
    ],
    defs: compiledDefs(['Plains', 'Mountain', 'Lightning Bolt', LURRUS, YORION]),
    options: { startingPlayer: 'p1', skipMulligans: true },
    ...extra,
  };
}

/** The game at p1's first main phase, with `lands` untapped Mountains for each player. */
function atMain(c: GameConfig, lands = 3): GameState {
  let s = clone(createGame(c));
  for (const p of ['p1', 'p2'] as const) for (let i = 0; i < lands; i++) put(s, p, 'battlefield', 'Mountain');
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

const companionAction = (s: GameState, player: PlayerId = 'p1'): Action | undefined => legalActions(s, player).find((a) => a.kind === 'special' && a.action.type === 'special' && a.action.kind === 'companion')?.action;
const take = (s: GameState, player: PlayerId = 'p1'): GameState => drive(act(s, companionAction(s, player)!));
const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
const inZones = (s: GameState, name: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name).map((o) => o.zone);
const passUntil = (s: GameState, done: (t: GameState) => boolean): GameState => {
  let t = s;
  for (let i = 0; i < 200 && !done(t); i++) {
    const p = t.pending!;
    if (p.kind === 'declareAttackers') t = act(t, { type: 'answer', player: p.player, decisionId: p.id, answer: { kind: 'declareAttackers', attacks: [] } });
    else if (p.kind === 'declareBlockers') t = act(t, { type: 'answer', player: p.player, decisionId: p.id, answer: { kind: 'declareBlockers', blocks: [] } });
    else if (p.kind === 'chooseObjects') {
      // cleanup discard (CR 514.1): Plains, never the companion
      const ids = p.options.filter((id) => t.defs[t.objects[id]!.defId]!.name !== LURRUS).slice(0, p.min);
      t = act(t, { type: 'answer', player: p.player, decisionId: p.id, answer: { kind: 'chooseObjects', ids } });
    }
    else t = act(t, { type: 'pass', player: p.player });
  }
  if (!done(t)) throw new Error('passUntil: not reached');
  return t;
};

describe('CMP1: the companion keyword compiles as the engine-handled keyword (CR 702.139a)', () => {
  it('each of the ten companions has a full "companion" keyword ability; the condition text is deck construction (claimed, not parsed)', () => {
    for (const name of COMPANIONS) {
      const def = compileCard(getCard(name));
      const kw = def.faces[0]!.abilities.filter((a) => a.kind === 'keyword' && a.keyword === 'companion');
      expect(kw, name).toHaveLength(1);
      expect(def.faces[0]!.abilities.some((a) => a.kind === 'manual' && /starting deck/i.test(a.text)), name).toBe(false);
    }
  });
});

describe('CR 702.139a, 400.11, 103.2b: the revealed companion starts outside the game, public', () => {
  it('is outside the game (in no zone), recorded as revealed, and logged at the start', () => {
    const s = createGame(config({ companion: LURRUS }));
    expect(s.outside?.['p1']).toEqual([LURRUS]);
    expect(s.outside?.['p2']).toEqual([]);
    expect(s.players.find((p) => p.id === 'p1')!.companion).toEqual({ defId: LURRUS });
    expect(s.players.find((p) => p.id === 'p2')!.companion).toBeUndefined();
    expect(inZones(s, LURRUS)).toEqual([]); // CR 400.11: outside the game is not a zone
    expect(logHas(s, /Alice reveals Lurrus of the Dream-Den from outside the game as their companion/, 'CR 103.2b')).toBe(true);
  });

  it('CR 702.139a: every player sees it (revealed), though the rest of a sideboard stays hidden (CR 400.11a)', () => {
    const s = createGame(config({ companion: LURRUS, sideboard: ['Lightning Bolt'] }));
    expect(s.outside?.['p1']).toEqual(['Lightning Bolt', LURRUS]);
    const bob = viewFor(s, 'p2');
    expect(bob.players.find((p) => p.id === 'p1')!.companion).toEqual({ defId: LURRUS });
    expect(bob.defs[LURRUS]?.name).toBe(LURRUS);
    expect(bob.outside?.['p1']).toBeUndefined();
    expect(viewFor(s, null).defs[LURRUS]).toBeDefined(); // a spectator too
  });

  it('a game without a companion is unchanged: no `outside`, no companion record, no companion action', () => {
    const s = atMain(config());
    expect(s.outside).toBeUndefined();
    expect(s.players.every((p) => p.companion === undefined)).toBe(true);
    expect(companionAction(s)).toBeUndefined();
  });

  it('an unknown companion definition is a configuration error', () => {
    expect(() => createGame(config({ companion: 'No Such Card' }))).toThrow(/Unknown cards/);
  });
});

describe('CR 116.2g, 702.139a: pay {3}: put the companion into your hand, a special action', () => {
  it('is listed in your main phase with an empty stack when {3} can be paid, as an action about no object', () => {
    const s = atMain(config({ companion: LURRUS }));
    const la = legalActions(s, 'p1').find((a) => a.kind === 'special');
    expect(la).toMatchObject({ kind: 'special', label: `Companion: pay {3} and put ${LURRUS} into your hand`, isMana: false });
    expect(la!.object).toBeUndefined();
    expect(la!.action).toEqual({ type: 'special', player: 'p1', kind: 'companion' });
  });

  it('pays {3} (auto-payable), puts the card into the hand as a new object, uses no stack, and the player keeps priority', () => {
    let s = atMain(config({ companion: LURRUS }));
    const handBefore = s.zones.hand['p1']!.length;
    s = act(s, companionAction(s)!);
    expect(s.pending?.kind).toBe('payCost'); // the usual payment decision: auto-payment answers it
    s = drive(s);
    expect(tapped(s)).toBe(3);
    expect(s.zones.hand['p1']).toHaveLength(handBefore + 1);
    expect(inZones(s, LURRUS)).toEqual(['hand']);
    expect(s.outside?.['p1']).toEqual([]);
    expect(s.players.find((p) => p.id === 'p1')!.companion).toEqual({ defId: LURRUS, inHand: s.turn.number });
    expect(s.zones.stack).toEqual([]); // CR 116.2g: no stack
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // CR 116.3
    expect(logHas(s, /Alice pays \{3\} and puts their companion Lurrus of the Dream-Den into their hand/, 'CR 116.2g')).toBe(true);
  });

  it('CR 733.1: cancelling the payment reverses the whole action', () => {
    const s = atMain(config({ companion: LURRUS }));
    const paying = act(s, companionAction(s)!);
    const back = act(paying, { type: 'cancel', player: 'p1' });
    expect(back.players.find((p) => p.id === 'p1')!.companion).toEqual({ defId: LURRUS });
    expect(back.outside?.['p1']).toEqual([LURRUS]);
    expect(tapped(back)).toBe(0);
    expect(companionAction(back)).toBeDefined();
  });

  it('CR 116.2g: only once per game: not again, even on a later turn (the card stays in the game, CR 702.139c)', () => {
    let s = take(atMain(config({ companion: LURRUS }), 6));
    expect(companionAction(s)).toBeUndefined();
    expect(applyAction(s, { type: 'special', player: 'p1', kind: 'companion' }).error?.rules).toContain('CR 116.2g');
    s = passUntil(s, (t) => t.turn.number === 3 && t.turn.step === 'main1' && t.pending?.kind === 'priority');
    expect(companionAction(s)).toBeUndefined();
    expect(inZones(s, LURRUS)).toEqual(['hand']);
  });

  it('CR 702.139a: not with {2}, not outside a main phase, not with a nonempty stack, not on an opponent\'s turn; not for a player without one', () => {
    expect(companionAction(atMain(config({ companion: LURRUS }), 2))).toBeUndefined(); // {3} can't be paid
    let s = atMain(config({ companion: LURRUS }, { companion: YORION }), 4);
    expect(companionAction(s, 'p2')).toBeUndefined(); // p1's turn
    // a nonempty stack: p1 casts Lightning Bolt (with one Mountain), then may not take the action in response, though {3} is left
    put(s, 'p1', 'hand', 'Lightning Bolt');
    const bolt = s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Lightning Bolt')!;
    s = act(s, { type: 'cast', player: 'p1', card: bolt });
    s = drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(s.zones.stack).toHaveLength(1);
    expect(companionAction(s)).toBeUndefined();
    expect(applyAction(s, { type: 'special', player: 'p1', kind: 'companion' }).error?.rules).toContain('CR 702.139a');
    s = resolveTop(s);
    expect(companionAction(s)).toBeDefined();
    // combat (beginning of combat): not a main phase
    s = passUntil(s, (t) => t.turn.step === 'beginCombat' && t.pending?.kind === 'priority');
    expect(companionAction(s)).toBeUndefined();
    // p2's own main phase: p2 may, p1 may not
    s = passUntil(s, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.kind === 'priority');
    expect(companionAction(s, 'p2')).toBeDefined();
    expect(applyAction(s, { type: 'special', player: 'p1', kind: 'companion' }).error).toBeDefined();
  });

  it('CR 116.1: an action naming an object is not the companion action', () => {
    const s = atMain(config({ companion: LURRUS }));
    const land = s.zones.battlefield[0]!;
    expect(applyAction(s, { type: 'special', player: 'p1', kind: 'companion', object: land }).error?.rules).toContain('CR 116.2g');
  });

  it('the companion then plays like any card in hand (cast it for its mana cost, CR 601)', () => {
    let s = take(atMain(config({ companion: LURRUS }), 6));
    const card = s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === LURRUS)!;
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === card)).toBe(false); // {1}{W/B}{W/B}: Mountains can't pay
    put(s = clone(s), 'p1', 'battlefield', 'Plains');
    put(s, 'p1', 'battlefield', 'Plains');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === card)).toBe(true);
  });

  it('the action log replays to the same state (determinism)', () => {
    const c = config({ companion: LURRUS });
    const s = createGame(c);
    const actions: Action[] = [];
    let t = s;
    const push = (a: Action) => {
      actions.push(a);
      t = act(t, a);
    };
    while (t.turn.step !== 'main1') push({ type: 'pass', player: t.pending!.player });
    // no lands in this game: the action is not listed; the replay still matches
    expect(companionAction(t)).toBeUndefined();
    const r = replay(c, actions);
    expect(r.errors).toEqual([]);
    expect(r.state.players).toEqual(t.players);
  });
});

describe('CR 702.139d: a companion enters a Commander game from outside the game', () => {
  it('works in a Commander game too (the command zone is unrelated, m11 design D7)', () => {
    const c = config({ companion: LURRUS, commanders: [YORION] }, { commanders: [YORION] }, { options: { startingPlayer: 'p1', skipMulligans: true, commander: commanderOptions('commander') } });
    let s = atMain(c);
    expect(s.outside?.['p1']).toEqual([LURRUS]);
    s = take(s);
    expect(inZones(s, LURRUS)).toEqual(['hand']);
  });
});
