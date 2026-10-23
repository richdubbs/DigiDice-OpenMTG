/**
 * std-rx30 (wave 2, Standard lane rx30: other players' choices and per-player effects): the round's readings played through the engine with synthetic cards compiled
 * by the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, life, pass, reject, scenario, zoneNames } from '../../m3/scenario';
import { card, counters, full, tokens } from '../cmd3/helpers';
import { cantHappen } from '../../../src/statics/hooks';
import { getChars } from '../../../src/rules/characteristics';
import { castMethods } from '../../../src/actions/cast';
import { castFaceDown, faceDownOf, resolveTop, synthetic, turnUp } from '../../m6/face-down/support';

/** Answer every decision with `pick` (else its first or least answer) until the stack is empty and a player has priority. */
type Pick = (d: NonNullable<GameState['pending']>) => unknown;
function run(s0: GameState, pick: Pick = () => undefined): GameState {
  let s = s0;
  for (let guard = 0; s.pending && guard < 80; guard++) {
    const d = s.pending;
    const mine = pick(d);
    if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
    if (mine !== undefined) { s = answer(s, mine as never); continue; }
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as { options: ObjectId[] }).options.slice(0, (d as { min: number }).min) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d as { options: { id: string }[] }).options[0]!.id] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[][] = [], pick: Pick = () => undefined, player = 'p1'): GameState => {
  const queue = [...targets];
  return run(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), (d) => (d.kind === 'chooseTargets' && queue.length > 0 ? { kind: 'chooseTargets', targets: queue.shift() } : pick(d)));
};
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

describe('CR 700.3, 701.20a, 608.2c: "Reveal the top four cards of your library and separate them into two piles. An opponent chooses one of those piles."', () => {
  const AUGUR = card('Test Augur', 'Sorcery', 'Reveal the top four cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard. Create a 0/0 colorless Thopter artifact creature token with flying, then put a +1/+1 counter on it for each card put into your graveyard this way.');
  const DEFS = [AUGUR];
  const LIB = ['Island', 'Island', 'Island', 'Island', 'Island'];
  it('is understood', () => expect(full(AUGUR)).toBe(true));
  it('you separate, the opponent chooses the empty pile: the four cards go to your graveyard and the Thopter gets four counters', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Augur'], library: LIB } });
    const seen: string[] = [];
    s = cast(s, 'Test Augur', [], (d) => { seen.push(`${d.kind}:${d.player}`); return undefined; });
    expect(seen).toContain('chooseObjects:p1'); // the separator is you
    expect(seen).toContain('chooseOption:p2'); // the chooser is the opponent
    expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n === 'Island')).toHaveLength(4);
    const [thopter] = tokens(s);
    expect(counters(s, thopter!, '+1/+1')).toBe(4);
  });
  it('the opponent chooses the pile of four: they go to your hand and the Thopter gets no counter (it dies as a 0/0)', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Augur'], library: LIB } });
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Augur', [], (d) => (d.kind === 'chooseOption' ? { kind: 'chooseOption', ids: ['pile2'] } : undefined));
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 4);
    expect(tokens(s)).toHaveLength(0);
  });
});

describe('CR 118.12, 608.2c-d: "each opponent may sacrifice a creature of their choice or discard a card. Then ~ deals damage equal to its power to each opponent who didn\'t ..."', () => {
  const TWISTER = card('Test Twister', 'Creature — Scarecrow', "When this creature enters, each opponent may sacrifice a creature of their choice or discard a card. Then this creature deals damage equal to its power to each opponent who didn't sacrifice a permanent or discard a card this way.", ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [TWISTER, BEAR];
  it('is understood', () => expect(full(TWISTER)).toBe(true));
  it('the opponent sacrifices a creature: no damage', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Twister'] }, p2: { battlefield: ['Test Bear'], hand: ['Island'] } });
    const l2 = life(s, 'p2');
    s = cast(s, 'Test Twister');
    expect(life(s, 'p2')).toBe(l2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
    expect(s.zones.hand['p2']).toHaveLength(1);
  });
  it('the opponent declines both: they are dealt damage equal to its power (3)', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Twister'] }, p2: { battlefield: ['Test Bear'], hand: ['Island'] } });
    const l2 = life(s, 'p2');
    s = cast(s, 'Test Twister', [], (d) => (d.kind === 'yesNo' && d.player === 'p2' ? { kind: 'yesNo', yes: false } : undefined));
    expect(life(s, 'p2')).toBe(l2 - 3);
    expect(s.zones.hand['p2']).toHaveLength(1);
  });
});

describe('CR 401.3, 400.3, 608.2d: "Its owner may put it on top of their library. If they do, ~ deals 3 damage to them. If they didn\'t ..., they put it on the bottom."', () => {
  const CLASH = card('Test Clash', 'Instant', "Choose target creature. Its owner may put it on top of their library. If they do, this spell deals 3 damage to them. If they didn't put the card on top of their library, they put it on the bottom.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [CLASH, BEAR];
  it('is understood', () => expect(full(CLASH)).toBe(true));
  const setup = (): GameState => scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Clash'] }, p2: { battlefield: ['Test Bear'], library: ['Island', 'Island'] } });
  it('the owner (the opponent) decides and puts it on top: it is the top card of their library and they are dealt 3 damage', () => {
    let s = setup();
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const l2 = life(s, 'p2');
    const asked: string[] = [];
    s = cast(s, 'Test Clash', [[obj(bear)]], (d) => { if (d.kind === 'yesNo') asked.push(d.player); return undefined; });
    expect(asked).toEqual(['p2']);
    expect(zoneNames(s, 'library', 'p2')[0]).toBe('Test Bear');
    expect(life(s, 'p2')).toBe(l2 - 3);
  });
  it('the owner declines: it goes to the bottom of their library and no damage is dealt', () => {
    let s = setup();
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const l2 = life(s, 'p2');
    s = cast(s, 'Test Clash', [[obj(bear)]], (d) => (d.kind === 'yesNo' ? { kind: 'yesNo', yes: false } : undefined));
    const lib = zoneNames(s, 'library', 'p2');
    expect(lib[lib.length - 1]).toBe('Test Bear');
    expect(lib[0]).toBe('Island');
    expect(life(s, 'p2')).toBe(l2);
  });
});

describe('CR 115.1, 601.2c, 608.2d: "Choose two target creatures controlled by the same opponent. That player chooses one of those creatures."', () => {
  const TRIAL = card('Test Trial', 'Sorcery', "Choose two target creatures controlled by the same opponent. That player chooses one of those creatures. This spell deals 4 damage to that creature, and the other can't block this turn.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['2', '5']);
  const DEFS = [TRIAL, BEAR, OX];
  it('is understood', () => expect(full(TRIAL)).toBe(true));
  it('their controller chooses which one is dealt the damage; the other can\'t block this turn', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Trial'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    const asked: string[] = [];
    s = cast(s, 'Test Trial', [[obj(bear), obj(ox)]], (d) => { if (d.kind === 'chooseObjects') { asked.push(d.player); return { kind: 'chooseObjects', ids: [ox] }; } return undefined; });
    expect(asked).toEqual(['p2']);
    expect(s.objects[ox]!.damage).toBe(4);
    expect(s.zones.battlefield).toContain(bear);
    // the restriction holds the other target only (CR 611.2c: the affected set is fixed as the effect begins)
    expect(cantHappen(s, { action: 'block', subject: bear })).not.toBeNull();
    expect(cantHappen(s, { action: 'block', subject: ox })).toBeNull();
  });
  it('a creature of yours is never a candidate (controlled by an opponent): with one creature of the opponent the spell has no legal targets', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Trial'], battlefield: ['Test Ox'] }, p2: { battlefield: ['Test Bear'] } });
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Trial', 'hand', 'p1') }).message).toMatch(/no legal/);
  });
});

describe('CR 608.2c-d, 701.20a: "Put one of them into your hand. Then choose an opponent. They put one on the bottom of your library. ... Put the other into your hand."', () => {
  const RECALL = card('Test Recall', 'Sorcery', 'Reveal the top five cards of your library. Put one of them into your hand. Then choose an opponent. They put one on the bottom of your library. Then you put one into your hand. Then they put one on the bottom of your library. Put the other into your hand.');
  const C = ['Test A', 'Test B', 'Test C', 'Test D', 'Test E'].map((n) => card(n, 'Sorcery', 'You gain 1 life.'));
  const DEFS = [RECALL, ...C];
  it('is understood', () => expect(full(RECALL)).toBe(true));
  it('you and the opponent pick in turn among what is left: three cards to your hand, two to the bottom of your library, each pick by the right player', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Recall'], library: ['Test A', 'Test B', 'Test C', 'Test D', 'Test E', 'Island'] } });
    const pickers: string[] = [];
    const offered: number[] = [];
    s = cast(s, 'Test Recall', [], (d) => {
      if (d.kind !== 'chooseObjects') return undefined;
      pickers.push(d.player);
      const options = (d as { options: ObjectId[] }).options;
      offered.push(options.length);
      return { kind: 'chooseObjects', ids: [options[0]!] };
    });
    expect(pickers).toEqual(['p1', 'p2', 'p1', 'p2']);
    expect(offered).toEqual([5, 4, 3, 2]); // each pick among what the earlier picks left
    const hand = zoneNames(s, 'hand', 'p1');
    expect(['Test A', 'Test C', 'Test E'].every((n) => hand.includes(n))).toBe(true);
    const lib = zoneNames(s, 'library', 'p1');
    expect(lib.slice(-2).sort()).toEqual(['Test B', 'Test D']);
    expect(lib[0]).toBe('Island');
  });
});

describe('CR 107.1a, 608.2e, 101.4: "Each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents ... Round down each time."', () => {
  const PLAGUE = card('Test Plague', 'Sorcery', 'Each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents they control of their choice. Round down each time.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [PLAGUE, BEAR];
  it('is understood', () => expect(full(PLAGUE)).toBe(true));
  it("each player's own half, rounded down: 20 life loses 10, 19 loses 9; 3 cards discard 1, 1 card none; 3 permanents sacrifice 1, 1 permanent none", () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Plague', 'Island', 'Island', 'Island'], battlefield: ['Test Bear'] }, p2: { hand: ['Island'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    s.players.find((p) => p.id === 'p2')!.life = 19;
    const l1 = life(s, 'p1');
    s = cast(s, 'Test Plague');
    expect(life(s, 'p1')).toBe(l1 - Math.floor(l1 / 2));
    expect(life(s, 'p2')).toBe(19 - 9);
    expect(s.zones.hand['p1']).toHaveLength(3 - 1); // three cards left after the cast: one discarded
    expect(s.zones.hand['p2']).toHaveLength(1); // half of one, rounded down: none
    const perms = (p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).length;
    expect(perms('p2')).toBe(2);
    expect(perms('p1')).toBe(1);
  });
});

describe('CR 101.4, 608.2d: "Starting with you, each player chooses up to one creature ... from among permanents your opponents control. Exile those permanents."', () => {
  const LEGEND = card('Test Legend', 'Sorcery', 'Starting with you, each player chooses up to one creature with power 3 or greater from among permanents your opponents control. Exile those permanents.');
  const OX = card('Test Ox', 'Creature — Ox', '', ['3', '5']);
  const ELK = card('Test Elk', 'Creature — Elk', '', ['4', '4']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [LEGEND, OX, ELK, BEAR];
  it('is understood', () => expect(full(LEGEND)).toBe(true));
  it('you choose first, then the opponent, both among the permanents your opponents control (power 3 or greater only); each one chosen is exiled', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Legend'], battlefield: ['Test Ox'] }, p2: { battlefield: ['Test Ox', 'Test Elk', 'Test Bear'] } });
    const ox2 = find(s, 'Test Ox', 'battlefield', 'p2');
    const elk = find(s, 'Test Elk', 'battlefield', 'p2');
    const order: string[] = [];
    s = cast(s, 'Test Legend', [], (d) => {
      if (d.kind !== 'chooseObjects') return undefined;
      order.push(d.player);
      const options = (d as { options: ObjectId[] }).options;
      expect([...options].sort()).toEqual([ox2, elk].sort()); // never your own Ox, never the 2/2 Bear
      return { kind: 'chooseObjects', ids: [d.player === 'p1' ? elk : ox2] };
    });
    expect(order).toEqual(['p1', 'p2']);
    expect(s.zones.battlefield).not.toContain(elk);
    expect(s.zones.battlefield).not.toContain(ox2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(1);
  });
  it('a player may choose nothing ("up to one"): only what was chosen is exiled', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Legend'] }, p2: { battlefield: ['Test Ox', 'Test Elk'] } });
    const elk = find(s, 'Test Elk', 'battlefield', 'p2');
    s = cast(s, 'Test Legend', [], (d) => (d.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: d.player === 'p1' ? [elk] : [] } : undefined));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2')).toHaveLength(1);
    expect(s.zones.battlefield).not.toContain(elk);
  });
});

describe('CR 608.2c, 608.2h, 101.4: "for each player, destroy up to one nonbasic land that player controls. For each land destroyed this way, its controller may search ..."', () => {
  const CRUSHER = card('Test Crusher', 'Artifact Creature — Insect', 'When this creature enters, for each player, destroy up to one nonbasic land that player controls. For each land destroyed this way, its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.', ['2', '2']);
  const VAULT = card('Test Vault', 'Land', '{T}: Add {C}.');
  const DEFS = [CRUSHER, VAULT];
  it('is understood', () => expect(full(CRUSHER)).toBe(true));
  it("you choose one nonbasic land of each player; each one destroyed lets its controller fetch a basic land tapped (the opponent's to the opponent)", () => {
    let s = scenario(['Island', 'Forest'], { defs: DEFS, p1: { hand: ['Test Crusher'], battlefield: ['Test Vault'], library: ['Island'] }, p2: { battlefield: ['Test Vault', 'Forest'], library: ['Forest'] } });
    const v1 = find(s, 'Test Vault', 'battlefield', 'p1');
    const v2 = find(s, 'Test Vault', 'battlefield', 'p2');
    const choosers: string[] = [];
    s = cast(s, 'Test Crusher', [], (d) => {
      if (d.kind !== 'chooseObjects') return undefined;
      choosers.push(d.player);
      const options = (d as { options: ObjectId[] }).options;
      if (options.includes(v1) || options.includes(v2)) { expect(options).toHaveLength(1); return { kind: 'chooseObjects', ids: options }; } // one player's nonbasic lands at a time; the Forest is basic
      return { kind: 'chooseObjects', ids: options.slice(0, 1) }; // the search: take the basic land
    });
    expect(choosers.slice(0, 2)).toEqual(['p1', 'p1']); // you choose for each player
    expect(s.zones.battlefield).not.toContain(v1);
    expect(s.zones.battlefield).not.toContain(v2);
    const lands = (p: string, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === name);
    expect(lands('p1', 'Island')).toHaveLength(1);
    expect(s.objects[lands('p1', 'Island')[0]!]!.tapped).toBe(true);
    expect(lands('p2', 'Forest')).toHaveLength(2);
  });
  it('a player whose land you did not destroy searches for nothing', () => {
    let s = scenario(['Island', 'Forest'], { defs: DEFS, p1: { hand: ['Test Crusher'], library: ['Island'] }, p2: { battlefield: ['Test Vault'], library: ['Forest'] } });
    s = cast(s, 'Test Crusher', [], (d) => (d.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: [] } : undefined));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Forest')).toHaveLength(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Vault')).toHaveLength(1);
  });
});

describe('CR 115.1, 601.2c, 611.2b, 205.1a: "for each player, choose up to one other target ... that player controls. For as long as ~ remains ..., the chosen permanents become Treasure artifacts"', () => {
  const THIEF = card('Test Thief', 'Creature — Human Pirate', 'Flying\nWhen this creature enters, for each player, choose up to one other target artifact or creature that player controls. For as long as this creature remains on the battlefield, the chosen permanents become Treasure artifacts with "{T}, Sacrifice this artifact: Add one mana of any color" and lose all other abilities.', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', 'Trample', ['2', '2']);
  const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to target creature.');
  const DEFS = [THIEF, BEAR, SHOCK];
  it('is understood', () => expect(full(THIEF)).toBe(true));
  it('one target of each player (never the thief itself); while it remains they are Treasure artifacts with only the mana ability; when it leaves they are creatures again', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Thief', 'Test Shock'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    let offered: ObjectId[] = [];
    s = cast(s, 'Test Thief', [], (d) => {
      if (d.kind !== 'chooseTargets') return undefined;
      offered = (d as { objects: ObjectId[] }).objects;
      return { kind: 'chooseTargets', targets: [obj(mine), obj(theirs)] };
    });
    const thief = find(s, 'Test Thief', 'battlefield', 'p1');
    expect(offered).not.toContain(thief);
    for (const id of [mine, theirs]) {
      const c = getChars(s, id)!;
      expect(c.types).toEqual(['Artifact']);
      expect(c.subtypes).toEqual(['Treasure']);
      expect(c.abilities.map((a) => a.def.kind)).toEqual(['activated']); // trample lost; only the granted mana ability
      expect(c.abilities[0]!.def.kind === 'activated' && c.abilities[0]!.def.isMana).toBe(true);
    }
    s = cast(s, 'Test Shock', [[obj(thief)]]);
    expect(s.zones.battlefield).not.toContain(thief);
    expect(getChars(s, theirs)!.types).toEqual(['Creature']);
  });
  it('two creatures of the same player: at most one of them may be chosen ("up to one ... that player controls")', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Thief'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    let max = -1;
    s = cast(s, 'Test Thief', [], (d) => { if (d.kind === 'chooseTargets') { max = (d as { max: number }).max; return { kind: 'chooseTargets', targets: [obj((d as { objects: ObjectId[] }).objects[0]!)] }; } return undefined; });
    expect(max).toBe(1);
    expect(s.zones.battlefield.filter((id) => getChars(s, id)!.subtypes.includes('Treasure'))).toHaveLength(1);
  });
});

describe('CR 608.2c, 701.20a, 202.3: "Two target players each reveal the top card of their library. They each lose life equal to the mana value of the card revealed by the other player."', () => {
  const LUCK = card('Test Luck', 'Sorcery', 'Two target players each reveal the top card of their library. They each lose life equal to the mana value of the card revealed by the other player. Then they each put the card they revealed into their hand.');
  const BIG = card('Test Big', 'Sorcery', 'You gain 1 life.', undefined, '{3}{G}');
  const SMALL = card('Test Small', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
  const DEFS = [LUCK, BIG, SMALL];
  it('is understood', () => expect(full(LUCK)).toBe(true));
  it("each loses the other's mana value (you reveal a 4, the opponent a 1: you lose 1, they lose 4); each card goes to its owner's hand", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Luck'], library: ['Test Big'] }, p2: { library: ['Test Small'] } });
    const [l1, l2] = [life(s, 'p1'), life(s, 'p2')];
    s = cast(s, 'Test Luck', [[{ kind: 'player', id: 'p1' }, { kind: 'player', id: 'p2' }]]);
    expect(life(s, 'p1')).toBe(l1 - 1);
    expect(life(s, 'p2')).toBe(l2 - 4);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Big');
    expect(zoneNames(s, 'hand', 'p2')).toContain('Test Small');
  });
  it('a player with an empty library reveals nothing: the other loses no life', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Luck'], library: ['Test Big'] }, p2: { library: [] } });
    const [l1, l2] = [life(s, 'p1'), life(s, 'p2')];
    s = cast(s, 'Test Luck', [[{ kind: 'player', id: 'p1' }, { kind: 'player', id: 'p2' }]]);
    expect(life(s, 'p1')).toBe(l1);
    expect(life(s, 'p2')).toBe(l2 - 4);
  });
});

describe('CR 614.10, 500.7: "You skip your next two turns", "Target opponent skips their next X turns, where X is the number of coins that came up heads"', () => {
  const NAP = card('Test Nap', 'Sorcery', 'Draw two cards. You skip your next two turns.');
  const SNARE = card('Test Snare', 'Sorcery', 'Draw a card. You skip your next turn.'); // (std-ry5's eff.stdry5.skip.nextTurn.you; the same one-use shield)
  const FLIP = card('Test Flip', 'Sorcery', 'Flip five coins. Target opponent skips their next X turns, where X is the number of coins that came up heads.');
  const DEFS = [NAP, SNARE, FLIP];
  it('is understood', () => { expect(full(NAP)).toBe(true); expect(full(SNARE)).toBe(true); expect(full(FLIP)).toBe(true); });
  const LIB = Array.from({ length: 12 }, () => 'Island');
  const actives = (s0: GameState, turns: number): string[] => {
    let s = s0;
    const out: string[] = [];
    for (let t = s.turn.number + 1; t <= s0.turn.number + turns; t++) { s = advanceTo(s, t, 'upkeep'); out.push(s.turn.activePlayer); }
    return out;
  };
  it('your next turn is skipped once: the opponent takes two turns in a row, then the turns alternate again', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Snare'], library: LIB }, p2: { library: LIB } });
    s = cast(s, 'Test Snare');
    expect(actives(s, 3)).toEqual(['p2', 'p2', 'p1']);
  });
  it('you skip your next two turns: the opponent takes three turns in a row', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Nap'], library: LIB }, p2: { library: LIB } });
    s = cast(s, 'Test Nap');
    expect(actives(s, 4)).toEqual(['p2', 'p2', 'p2', 'p1']);
  });
  it('as many turns are skipped as the coins came up heads', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Flip'], library: LIB }, p2: { library: LIB } });
    const before = s.log.length;
    s = cast(s, 'Test Flip', [[{ kind: 'player', id: 'p2' }]]);
    const heads = s.log.slice(before).filter((e) => /flips a coin: heads/.test(JSON.stringify(e))).length;
    const skips = s.continuousEffects.filter((e) => e.effect.s === 'replace' && e.effect.body.b === 'skip').length;
    expect(skips).toBe(heads);
    const order = actives(s, heads + 1); // each of the opponent's next `heads` turns is skipped: you take that many turns in a row, then the opponent one
    expect(order).toEqual([...Array.from({ length: heads }, () => 'p1'), 'p2']);
  });
});

describe('CR 400.11b, 201.2, 608.2d: "You may reveal exactly two cards you own with different names from outside the game. An opponent chooses one of them."', () => {
  const WISH = card('Test Extrapolate', 'Sorcery', 'You may reveal exactly two cards you own with different names from outside the game. An opponent chooses one of them. You put that card into your hand.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['2', '5']);
  const DEFS = [WISH, BEAR, OX];
  it('is understood', () => expect(full(WISH)).toBe(true));
  it('you reveal two of different names, the opponent picks which one goes to your hand; the other stays outside the game', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Extrapolate'] } });
    s = { ...s, outside: { p1: [BEAR.id, BEAR.id, OX.id], p2: [] } };
    const asked: string[] = [];
    s = cast(s, 'Test Extrapolate', [], (d) => {
      if (d.kind !== 'chooseOption') return undefined;
      asked.push(d.player);
      const options = (d as { options: { id: string }[] }).options.map((o) => o.id);
      if (d.player === 'p1') return { kind: 'chooseOption', ids: [`card:${BEAR.id}`, `card:${OX.id}`] };
      expect(options.sort()).toEqual([`card:${BEAR.id}`, `card:${OX.id}`].sort());
      return { kind: 'chooseOption', ids: [`card:${OX.id}`] };
    });
    expect(asked).toEqual(['p1', 'p2']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Ox']);
  });
  it('only one name outside the game: nothing can be revealed ("exactly two ... with different names")', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Extrapolate'] } });
    s = { ...s, outside: { p1: [BEAR.id, BEAR.id], p2: [] } };
    s = cast(s, 'Test Extrapolate');
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 400.11b, 701.23a, 201.2, 608.2d: "Search your library and/or outside the game for exactly three ... cards you own with different names ... An opponent chooses one of them."', () => {
  const TURTLES = card('Test Turtles', 'Instant', 'Search your library and/or outside the game for exactly three creature cards you own with different names, then reveal those cards. An opponent chooses one of them. Put the chosen cards into your hand and shuffle the rest into your library.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['2', '5']);
  const ELK = card('Test Elk', 'Creature — Elk', '', ['4', '4']);
  const DEFS = [TURTLES, BEAR, OX, ELK];
  it('is understood', () => expect(full(TURTLES)).toBe(true));
  it('cards found in the library and outside the game together; the opponent chooses which goes to your hand, the others are shuffled into your library', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Turtles'], library: ['Test Bear', 'Test Ox', 'Island'] } });
    s = { ...s, outside: { p1: [ELK.id], p2: [] } };
    const libBefore = s.zones.library['p1']!.length;
    let opp = '';
    s = cast(s, 'Test Turtles', [], (d) => {
      if (d.kind === 'chooseOption' && d.player === 'p1') {
        const options = (d as { options: { id: string; label: string }[] }).options;
        expect(options.map((o) => o.label).sort()).toEqual(['Test Bear', 'Test Elk (outside the game)', 'Test Ox']);
        return { kind: 'chooseOption', ids: options.map((o) => o.id) };
      }
      if (d.kind === 'chooseObjects') {
        opp = d.player;
        const options = (d as { options: ObjectId[] }).options;
        expect(options).toHaveLength(3);
        return { kind: 'chooseObjects', ids: [options.find((id) => s.objects[id]?.defId === ELK.id) ?? options[0]!] };
      }
      return undefined;
    });
    expect(opp).toBe('p2');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Elk']);
    expect(s.zones.library['p1']!.length).toBe(libBefore); // the Bear and the Ox stay (shuffled), the Elk came from outside and went to the hand
    expect(s.outside?.['p1']).toEqual([]);
  });
  it('two cards of the same name are never taken together', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Turtles'], library: ['Test Bear'] } });
    s = { ...s, outside: { p1: [BEAR.id], p2: [] } };
    let max = -1;
    s = cast(s, 'Test Turtles', [], (d) => { if (d.kind === 'chooseOption' && d.player === 'p1') { max = (d as { max: number }).max; } return undefined; });
    expect(max).toBe(1);
  });
});

describe('CR 115.1, 400.1: "Return target instant or sorcery card from your graveyard or exiled card with flashback you own to your hand"', () => {
  const SCHEME = card('Test Scheme', 'Sorcery', 'Return target instant or sorcery card from your graveyard or exiled card with flashback you own to your hand. Add {R}.');
  const BACK = card('Test Back', 'Sorcery', 'You gain 1 life.\nFlashback {2}');
  const PLAIN = card('Test Plain', 'Sorcery', 'You gain 1 life.');
  const DEFS = [SCHEME, BACK, PLAIN];
  it('is understood', () => expect(full(SCHEME)).toBe(true));
  it('candidates: your instant or sorcery cards in your graveyard and your exiled cards with flashback, nothing else', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Scheme'], graveyard: ['Test Plain'], exile: ['Test Back', 'Test Plain'] }, p2: { exile: ['Test Back'] } });
    const inYard = find(s, 'Test Plain', 'graveyard', 'p1');
    const mineExiled = s.zones.exile.find((id) => s.objects[id]!.owner === 'p1' && s.objects[id]!.defId === 'Test Back')!;
    let offered: ObjectId[] = [];
    s = cast(s, 'Test Scheme', [], (d) => {
      if (d.kind !== 'chooseTargets') return undefined;
      offered = (d as { objects: ObjectId[] }).objects;
      return { kind: 'chooseTargets', targets: [obj(mineExiled)] };
    });
    expect([...offered].sort()).toEqual([inYard, mineExiled].sort());
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Back');
  });
});

describe('CR 702.168e, 702.37f, 115.1, 607.2a: "When this creature is turned face up, exile up to X other target creatures from the battlefield and/or creature cards from graveyards"', () => {
  const ANGEL = synthetic('Test Vindicator', 'Creature — Angel', '{3}{W}{W}', "Flying\nDisguise {X}{3}{W}\nWhen this creature is turned face up, exile up to X other target creatures from the battlefield and/or creature cards from graveyards.\nWhen this creature leaves the battlefield, return the exiled cards to their owners' hands.", { power: '3', toughness: '4' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  const DEFS = [ANGEL, BEAR, SWAT];
  it('is understood', () => expect(full(ANGEL)).toBe(true));
  it('turned face up for X = 2: up to two targets among creatures on the battlefield and creature cards in graveyards; when it leaves they return to their owners\' hands', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Vindicator', 'Test Swat'], battlefield: Array.from({ length: 12 }, () => 'Plains') }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Bear'] } });
    s = resolveTop(castFaceDown(s, 'Test Vindicator', 'disguise'));
    const [id] = faceDownOf(s, 'p1');
    const onField = find(s, 'Test Bear', 'battlefield', 'p2');
    const inYard = find(s, 'Test Bear', 'graveyard', 'p2');
    let offered: ObjectId[] = [];
    let max = -1;
    s = run(turnUp(s, id!, 'disguise', [], 'p1', 2), (d) => {
      if (d.kind !== 'chooseTargets') return undefined;
      offered = (d as { objects: ObjectId[] }).objects;
      max = (d as { max: number }).max;
      return { kind: 'chooseTargets', targets: [obj(onField), obj(inYard)] };
    });
    expect(max).toBe(2);
    expect(offered).not.toContain(id); // "other"
    expect([...offered].sort()).toEqual([onField, inYard].sort());
    expect(s.zones.exile.filter((x) => s.objects[x]!.defId === 'Test Bear')).toHaveLength(2);
    s = cast(s, 'Test Swat', [[obj(id!)]]);
    expect(zoneNames(s, 'hand', 'p2').filter((n) => n === 'Test Bear')).toHaveLength(2);
  });
});

describe('CR 115.1, 701.20a, 610.3: "Choose target opponent and up to one target creature they control. They reveal their hand. You may exile a nonland card from their hand or the chosen creature until ~ leaves the battlefield."', () => {
  const SPY = card('Test Spies', 'Creature — Human Rogue', 'When this creature enters, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a nonland card from their hand or the chosen creature until this creature leaves the battlefield.', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  const DEFS = [SPY, BEAR, SWAT];
  const setup = (): GameState => scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Spies', 'Test Swat'] }, p2: { hand: ['Test Bear', 'Test Swat', 'Island'], battlefield: ['Test Bear'] } });
  it('is understood', () => expect(full(SPY)).toBe(true));
  it('the candidates are the nonland cards of their hand and the chosen creature; the exiled creature returns when this creature leaves', () => {
    let s = setup();
    const onField = find(s, 'Test Bear', 'battlefield', 'p2');
    const inHand = find(s, 'Test Bear', 'hand', 'p2');
    let offered: ObjectId[] = [];
    s = cast(s, 'Test Spies', [[{ kind: 'player', id: 'p2' }], [obj(onField)]], (d) => {
      if (d.kind !== 'chooseObjects') return undefined;
      offered = (d as { options: ObjectId[] }).options;
      return { kind: 'chooseObjects', ids: [onField] };
    });
    expect([...offered].sort()).toEqual([onField, inHand, find(setup(), 'Test Swat', 'hand', 'p2')].sort()); // not the Island, not your own cards
    expect(s.zones.exile.map((x) => s.objects[x]!.defId)).toEqual(['Test Bear']);
    expect(battlefieldNames(s, 'p2')).not.toContain('Test Bear');
    s = cast(s, 'Test Swat', [[obj(find(s, 'Test Spies', 'battlefield', 'p1'))]]);
    expect(battlefieldNames(s, 'p2')).toContain('Test Bear');
  });
  it('no creature chosen: only the nonland cards of their hand are candidates', () => {
    let s = setup();
    const inHand = find(s, 'Test Bear', 'hand', 'p2');
    let offered: ObjectId[] = [];
    s = cast(s, 'Test Spies', [[{ kind: 'player', id: 'p2' }], []], (d) => {
      if (d.kind !== 'chooseObjects') return undefined;
      offered = (d as { options: ObjectId[] }).options;
      return { kind: 'chooseObjects', ids: [inHand] };
    });
    expect([...offered].sort()).toEqual([inHand, find(setup(), 'Test Swat', 'hand', 'p2')].sort());
    expect(s.zones.exile.map((x) => s.objects[x]!.defId)).toEqual(['Test Bear']);
    s = cast(s, 'Test Swat', [[obj(find(s, 'Test Spies', 'battlefield', 'p1'))]]);
    expect(zoneNames(s, 'hand', 'p2')).toContain('Test Bear');
  });
});

describe('CR 701.6a, 113.7, 611.2a: "Counter up to one target activated or triggered ability. If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield."', () => {
  const BINDER = card('Test Binder', 'Creature — Merfolk Wizard', 'Flash\nWhen this creature enters, counter up to one target activated or triggered ability. If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield.', ['3', '2']);
  const BIRD = card('Test Lifebird', 'Creature — Bird', '{T}: You gain 3 life.', ['1', '1']);
  const SPRING = card('Test Spring', 'Land', '{T}: You gain 1 life.');
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  const DEFS = [BINDER, BIRD, SPRING, SWAT];
  const activate = (s: GameState, name: string): GameState => act(s, { type: 'activate', player: 'p1', source: find(s, name, 'battlefield', 'p1'), ability: 'p:0:0' } as never);
  it('is understood', () => expect(full(BINDER)).toBe(true));
  it("a creature's ability is countered and the creature loses all abilities until the countering creature leaves the battlefield", () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Binder', 'Test Swat'], battlefield: ['Test Lifebird'] } });
    const life0 = life(s, 'p1');
    s = activate(s, 'Test Lifebird');
    const ability = s.zones.stack[0]!;
    s = cast(s, 'Test Binder', [[obj(ability)]]);
    expect(life(s, 'p1')).toBe(life0); // countered: no life gained
    const bird = find(s, 'Test Lifebird', 'battlefield', 'p1');
    expect(getChars(s, bird)!.abilities).toHaveLength(0);
    s = cast(s, 'Test Swat', [[obj(find(s, 'Test Binder', 'battlefield', 'p1'))]]);
    expect(getChars(s, bird)!.abilities).toHaveLength(1);
  });
  it("a land's ability is countered, but the land keeps its abilities (not an artifact, creature or planeswalker)", () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Binder'], battlefield: ['Test Spring'] } });
    const life0 = life(s, 'p1');
    s = activate(s, 'Test Spring');
    const ability = s.zones.stack[0]!;
    s = cast(s, 'Test Binder', [[obj(ability)]]);
    expect(life(s, 'p1')).toBe(life0);
    expect(getChars(s, find(s, 'Test Spring', 'battlefield', 'p1'))!.abilities).toHaveLength(1);
  });
});

describe('CR 701.6a, 614.15, 400.7, 611.2b: "Counter target spell. If a permanent spell is countered this way, exile it instead ... You may cast that card without paying its mana cost for as long as it remains exiled."', () => {
  const DECREE = card('Test Decree', 'Instant', "Counter target spell. If a permanent spell is countered this way, exile it instead of putting it into its owner's graveyard. You may cast that card without paying its mana cost for as long as it remains exiled.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
  const GAIN = card('Test Gain', 'Instant', 'You gain 2 life.', undefined, '{1}');
  const DEFS = [DECREE, BEAR, GAIN];
  it('is understood', () => expect(full(DECREE)).toBe(true));
  const castHeld = (s0: GameState, name: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let g = 0; s.pending?.kind === 'payCost' && g < 5; g++) s = answer(s, { kind: 'payCost', auto: true });
    return s;
  };
  it('a countered creature spell is exiled, and you may cast it from exile without paying its mana cost', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Bear', 'Test Decree'], battlefield: ['Island'] } });
    s = castHeld(s, 'Test Bear');
    const spell = s.zones.stack[0]!;
    s = cast(s, 'Test Decree', [[obj(spell)]]);
    const exiled = s.zones.exile.find((x) => s.objects[x]!.defId === 'Test Bear');
    expect(exiled).toBeDefined();
    const method = castMethods(s, exiled!, 0, 'p1').find((m) => m.includes(':named:'));
    expect(method).toBeDefined();
    s = run(act(s, { type: 'cast', player: 'p1', card: exiled!, method }));
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear'); // the only Island was tapped for the first cast: this one was free
  });
  it('a countered instant spell goes to its owner\'s graveyard and cannot be cast from there', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Gain', 'Test Decree'], battlefield: ['Island', 'Island'] } });
    const life0 = life(s, 'p1');
    s = castHeld(s, 'Test Gain');
    s = cast(s, 'Test Decree', [[obj(s.zones.stack[0]!)]]);
    expect(life(s, 'p1')).toBe(life0);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Gain');
    expect(s.zones.exile).toHaveLength(0);
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain', 'graveyard', 'p1') })).toThrow();
  });
});
