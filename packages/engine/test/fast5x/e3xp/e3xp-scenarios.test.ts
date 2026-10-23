/**
 * E3XP: the cards only the local FAST5X E30-E32 and M12F branches made full, ported onto main's mechanisms, played through the engine with synthetic cards
 * compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 115.7d  "you may choose new targets for it / that spell": any number stay; a changed one must be legal for the spell's controller (FAST5X E31)
 *   CR 115.3, 115.7e  "another target" never collides; only the final set is judged (two targets can be swapped)
 *   CR 115.5   a spell or ability is never its own target
 *   CR 115.7f  a divided effect keeps its division: a kept target keeps its share, a new one takes the share of the target it replaces
 *   CR 115.1   the new set keeps the restrictions of its text ("controlled by different players")
 *   CR 115.7d  a new target is judged with the other new targets, and the change may not make a kept target illegal
 *   CR 701.12a-b, 108.4  "exchange control of this creature and that spell": the spell changes controller on the stack (Perplexing Chimera)
 *   CR 118.9, 601.2a, 202.3  "You may cast spells with mana value less than or equal to the number of creatures you control from your hand without paying
 *              their mana costs" (Omnipresence, on r3-cost's permit): the number is read as the spell is cast
 *   CR 614.1a, 614.5, 616.1  "If you would create one or more tokens, instead create those tokens plus an additional Food token." (Tippy-Toe, on r3-repl's
 *              replacement): any token comes with one Food, and that Food brings no other
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { isGrantedAltMethod } from '../../../src/statics/play-permits';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { lifeOf } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; divisions?: number[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], divisions: [...(script.divisions ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseDivision') s = answer(s, { kind: 'chooseDivision', amounts: q.divisions.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
const resolveTop = (s: GameState, script?: Script): GameState => drive(passBoth(s), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const stackTargets = (s: GameState, id: ObjectId): TargetChoice[] => s.objects[id]!.stack!.targets.flat();
const pendingTargets = (s: GameState) => s.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseTargets' }>;

const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
const SPLIT = card('Test Split Bolt', 'Instant', 'Test Split Bolt deals 1 damage to any target and 1 damage to any other target.');
const SNIPE = card('Test Snipe', 'Instant', 'Test Snipe deals 3 damage to target creature an opponent controls.');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
const SPEEDY = card('Test Speedy', 'Legendary Creature — Human Hero', 'Whenever a player casts a spell that targets Test Speedy, Test Speedy gets +2/+2 until end of turn. You may choose new targets for that spell.', '{0}', ['3', '3']);
const SNATCH = card('Test Snatch', 'Instant', 'Gain control of target spell. You may choose new targets for it.');
const CHIMERA = card('Test Chimera', 'Creature — Chimera', 'Whenever an opponent casts a spell, you may exchange control of Test Chimera and that spell. If you do, you may choose new targets for the spell.', '{0}', ['2', '2']);
const PRESENCE = card('Test Presence', 'Enchantment', 'You may cast spells with mana value less than or equal to the number of creatures you control from your hand without paying their mana costs.', '{5}{W}');
const GIANT = card('Test Hill Giant', 'Creature — Giant', '', '{3}', ['3', '3']);
const PANTRY = card('Test Pantry', 'Creature — Squirrel', 'If you would create one or more tokens, instead create those tokens plus an additional Food token.', '{0}', ['1', '1']);
const BARRACKS = card('Test Barracks', 'Artifact', '{T}: Create a 1/1 white Soldier creature token.');
const LARDER = card('Test Larder', 'Artifact', '{T}: Create a Food token.');
const FORKED = card('Test Forked Shot', 'Instant', 'Test Forked Shot deals 3 damage divided as you choose among one or two targets.');
const SWAP = card('Test Swap', 'Instant', 'Exchange control of two target creatures controlled by different players.');
const RAZE = card('Test Raze', 'Instant', "Destroy target creature and target land that creature's controller controls.");
const FIELD = card('Test Field', 'Land', '');
const DEFS = [SHOCK, SPLIT, SNIPE, BEAR, OGRE, SPEEDY, SNATCH, CHIMERA, PRESENCE, GIANT, PANTRY, BARRACKS, LARDER, FORKED, SWAP, RAZE, FIELD];

describe('the synthetic cards are automated (E3XP)', () => {
  it('every card is full', () => {
    for (const d of DEFS) expect(automated(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 115.7d: "you may choose new targets for that spell" (Speedball, New Warrior)', () => {
  it('the controller of the trigger moves an opponent\'s spell to another legal target (legal for the spell\'s controller)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Speedy'] }, p2: { hand: ['Test Shock'] } });
    const speedy = find(s, 'Test Speedy', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(speedy)]] }, 'p2');
    const shock = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = resolveTop(s, { yes: [true], targets: [[player('p2')]] });
    expect(stackTargets(s, shock)).toEqual([player('p2')]);
    const l2 = lifeOf(s, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(l2 - 2);
  });

  it('declining keeps the targets', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Speedy'] }, p2: { hand: ['Test Shock'] } });
    const speedy = find(s, 'Test Speedy', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(speedy)]] }, 'p2');
    const shock = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = resolveTop(s, { yes: [false] });
    expect(stackTargets(s, shock)).toEqual([obj(speedy)]);
  });

  /** p2 casts "1 damage to any target and 1 damage to any other target" at Speedy and the Bear; Speedy's trigger is on the stack. */
  function splitBoltAtSpeedy(): { s: GameState; speedy: ObjectId; bear: ObjectId; bolt: ObjectId } {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Speedy', 'Test Bear'] }, p2: { hand: ['Test Split Bolt'] } });
    const speedy = find(s, 'Test Speedy', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Split Bolt', { targets: [[obj(speedy)], [obj(bear)]] }, 'p2');
    const bolt = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    return { s, speedy, bear, bolt };
  }

  it('CR 115.3, 115.7d: "any other target" can\'t end up on the target of "any target": the kept target that would collide is not offered', () => {
    const { s: s0, bear } = splitBoltAtSpeedy();
    let s = passBoth(s0);
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [obj(bear)] });
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(pendingTargets(s).objects).not.toContain(bear);
  });

  it('CR 115.7e: only the final set is judged, so the two targets can be swapped (the Arc Trail example)', () => {
    const { s: s0, speedy, bear, bolt } = splitBoltAtSpeedy();
    const s = resolveTop(s0, { yes: [true], targets: [[obj(bear)], [obj(speedy)]] });
    expect(stackTargets(s, bolt)).toEqual([obj(bear), obj(speedy)]);
  });
});

describe('CR 115.7d after a change of control (Aethersnatch: "Gain control of target spell. You may choose new targets for it.")', () => {
  it('the new controller moves the stolen spell; it deals its damage under the new controller', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'], hand: ['Test Snatch'] }, p2: { hand: ['Test Shock'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(bear)]] }, 'p2');
    const shock = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = act(s, { type: 'pass', player: 'p2' });
    s = cast(s, 'Test Snatch', { targets: [[obj(shock)]] });
    s = resolveTop(s, { yes: [true], targets: [[player('p2')]] });
    expect(s.objects[shock]!.controller).toBe('p1');
    expect(stackTargets(s, shock)).toEqual([player('p2')]);
    const l2 = lifeOf(s, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(l2 - 2);
    expect(s.zones.battlefield).toContain(bear);
  });

  it('a new target must be legal for the spell\'s NEW controller ("an opponent" is now p2); the kept target is still offered (CR 115.7d)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear', 'Test Speedy'], hand: ['Test Snatch'] }, p2: { battlefield: ['Test Ogre'], hand: ['Test Snipe'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const speedy = find(s, 'Test Speedy', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Snipe', { targets: [[obj(bear)]] }, 'p2');
    const snipe = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = act(s, { type: 'pass', player: 'p2' });
    s = cast(s, 'Test Snatch', { targets: [[obj(snipe)]] });
    s = passBoth(s);
    s = answer(s, { kind: 'yesNo', yes: true });
    const offered = pendingTargets(s).objects;
    expect(offered).toContain(ogre);
    expect(offered).toContain(bear); // CR 115.7d: an unchanged target may stay, even an illegal one
    expect(offered).not.toContain(speedy);
    s = drive(answer(s, { kind: 'chooseTargets', targets: [obj(ogre)] }));
    s = resolveAll(s);
    expect(s.zones.battlefield).not.toContain(ogre);
    expect(s.zones.battlefield).toContain(bear);
  });
});

describe('CR 115.7d after an exchange of control (Perplexing Chimera)', () => {
  it('"If you do, you may choose new targets for the spell": the spell is now yours and goes where you choose', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Chimera', 'Test Bear'] }, p2: { hand: ['Test Shock'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const chimera = find(s, 'Test Chimera', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(bear)]] }, 'p2');
    const shock = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = resolveTop(s, { yes: [true, true], targets: [[player('p2')]] });
    expect(s.objects[shock]!.controller).toBe('p1');
    expect(s.objects[chimera]!.controller).toBe('p2');
    expect(stackTargets(s, shock)).toEqual([player('p2')]);
  });

  it('declining the exchange leaves the spell\'s targets alone (no second question)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Chimera', 'Test Bear'] }, p2: { hand: ['Test Shock'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(bear)]] }, 'p2');
    const shock = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = passBoth(s);
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending?.kind).toBe('priority');
    expect(s.objects[shock]!.controller).toBe('p2');
    expect(stackTargets(s, shock)).toEqual([obj(bear)]);
  });
});

describe('CR 118.9, 601.2a, 202.3: "You may cast spells with mana value less than or equal to the number of creatures you control from your hand without paying their mana costs" (Omnipresence)', () => {
  const methods = (s: GameState, id: ObjectId, who: PlayerId = 'p1'): (string | undefined)[] =>
    legalActions(s, who).filter((a) => a.kind === 'cast' && a.object === id).map((a) => (a.action as { method?: string }).method);
  const granted = (s: GameState, id: ObjectId, who: PlayerId = 'p1'): string | undefined => methods(s, id, who).find((m) => isGrantedAltMethod(m));

  it('with three creatures a mana value 3 spell is cast with no land; with two it is not offered', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Presence', 'Test Bear', 'Test Ogre'], hand: ['Test Hill Giant'] } });
    const giant = find(s, 'Test Hill Giant', 'hand', 'p1');
    expect(granted(s, giant)).toBeUndefined();
    s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Presence', 'Test Bear', 'Test Ogre', 'Test Speedy'], hand: ['Test Hill Giant'] } });
    const g2 = find(s, 'Test Hill Giant', 'hand', 'p1');
    const m = granted(s, g2);
    expect(m).toBeDefined();
    s = drive(act(s, { type: 'cast', player: 'p1', card: g2, method: m }));
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === GIANT.id)).toBe(true);
  });

  it("CR 109.5, 113.6: the creatures counted are its controller's: an opponent's creatures don't count, and the opponent is offered nothing", () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Presence'], hand: ['Test Hill Giant'] }, p2: { battlefield: ['Test Bear', 'Test Ogre', 'Test Speedy'], hand: ['Test Hill Giant'] } });
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p2'), 'p2')).toBeUndefined();
  });
});

describe('CR 614.1a, 614.5: "If you would create one or more tokens, instead create those tokens plus an additional Food token." (Tippy-Toe)', () => {
  const tokensOf = (s: GameState, who: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === who);
  const foods = (s: GameState, who = 'p1'): number => tokensOf(s, who).filter((id) => s.objects[id]!.defId.includes('Food')).length;
  const tap = (s: GameState, source: ObjectId, who = 'p1'): GameState => drive(act(s, { type: 'activate', player: who, source, ability: 'p:0:0' }));

  it('a creature token comes with one Food', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pantry', 'Test Barracks'] } });
    s = resolveAll(tap(s, find(s, 'Test Barracks', 'battlefield')));
    expect(tokensOf(s, 'p1')).toHaveLength(2);
    expect(foods(s)).toBe(1);
  });
  it('CR 614.5: a Food comes with one more Food, which brings no other', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pantry', 'Test Larder'] } });
    s = resolveAll(tap(s, find(s, 'Test Larder', 'battlefield')));
    expect(foods(s)).toBe(2);
  });
  it("CR 614.1a: an opponent's tokens come alone", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pantry'] }, p2: { battlefield: ['Test Barracks'] } });
    s = act(s, { type: 'pass', player: 'p1' });
    s = resolveAll(tap(s, find(s, 'Test Barracks', 'battlefield', 'p2'), 'p2'));
    expect(tokensOf(s, 'p2')).toHaveLength(1);
    expect(foods(s, 'p1') + foods(s, 'p2')).toBe(0);
  });
});

describe('CR 115.7f, 115.1, 115.7d: what a new set of targets keeps (review fixes)', () => {
  it('CR 115.7f: the same targets picked in another order change nothing, and the division stays as announced', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Speedy'] }, p2: { hand: ['Test Forked Shot'] } });
    const speedy = find(s, 'Test Speedy', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Forked Shot', { targets: [[obj(speedy), player('p1')]], divisions: [[2, 1]] }, 'p2');
    const shot = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = resolveTop(s, { yes: [true], targets: [[player('p1'), obj(speedy)]] });
    expect(stackTargets(s, shot)).toEqual([obj(speedy), player('p1')]);
    const l1 = lifeOf(s, 'p1');
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(l1 - 1);
  });

  it('CR 115.7f: a new target takes the share of the target it replaces (2 damage moves from Speedy to p2; p1 keeps its 1)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Speedy'] }, p2: { hand: ['Test Forked Shot'] } });
    const speedy = find(s, 'Test Speedy', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Forked Shot', { targets: [[obj(speedy), player('p1')]], divisions: [[2, 1]] }, 'p2');
    const shot = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = resolveTop(s, { yes: [true], targets: [[player('p1'), player('p2')]] }); // picked in the other order: p2 still takes Speedy's place
    expect(stackTargets(s, shot)).toEqual([player('p2'), player('p1')]);
    const l1 = lifeOf(s, 'p1');
    const l2 = lifeOf(s, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(l2 - 2);
    expect(lifeOf(s, 'p1')).toBe(l1 - 1);
  });

  it('CR 115.1: "two target creatures controlled by different players" can\'t be moved onto two creatures of one player: the targets stay', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Speedy', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'], hand: ['Test Swap'] } });
    const speedy = find(s, 'Test Speedy', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Swap', { targets: [[obj(speedy), obj(ogre)]] }, 'p2');
    const swap = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = resolveTop(s, { yes: [true], targets: [[obj(speedy), obj(bear)]] });
    expect(stackTargets(s, swap)).toEqual([obj(speedy), obj(ogre)]);
  });

  describe('CR 115.7d: a target word that reads another ("target land that creature\'s controller controls")', () => {
    function razeStolen(): { s: GameState; bear: ObjectId; ogre: ObjectId; field1: ObjectId; field2: ObjectId; raze: ObjectId } {
      let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear', 'Test Field'], hand: ['Test Snatch'] }, p2: { battlefield: ['Test Ogre', 'Test Field'], hand: ['Test Raze'] } });
      const bear = find(s, 'Test Bear', 'battlefield');
      const ogre = find(s, 'Test Ogre', 'battlefield');
      const field1 = find(s, 'Test Field', 'battlefield', 'p1');
      const field2 = find(s, 'Test Field', 'battlefield', 'p2');
      s = act(s, { type: 'pass', player: 'p1' });
      s = cast(s, 'Test Raze', { targets: [[obj(bear)], [obj(field1)]] }, 'p2');
      const raze = s.zones.stack.find((id) => s.objects[id]!.defId === RAZE.id)!;
      s = act(s, { type: 'pass', player: 'p2' });
      s = cast(s, 'Test Snatch', { targets: [[obj(raze)]] });
      return { s, bear, ogre, field1, field2, raze };
    }

    it('after the creature changes, the lands of its controller are offered (judged with the new creature)', () => {
      const { s: s0, ogre, field1, field2, raze } = razeStolen();
      let s = passBoth(s0);
      s = answer(s, { kind: 'yesNo', yes: true });
      s = answer(s, { kind: 'chooseTargets', targets: [obj(ogre)] });
      const offered = pendingTargets(s).objects;
      expect(offered).toContain(field2);
      expect(offered).toContain(field1); // the kept target is always listed (CR 115.7d)
      s = drive(answer(s, { kind: 'chooseTargets', targets: [obj(field2)] }));
      expect(stackTargets(s, raze)).toEqual([obj(ogre), obj(field2)]);
      s = resolveAll(s);
      expect(s.zones.battlefield).not.toContain(ogre);
      expect(s.zones.battlefield).not.toContain(field2);
    });

    it('a change that would make the kept land illegal is refused: the targets stay', () => {
      const { s: s0, bear, ogre, field1, raze } = razeStolen();
      const s = resolveTop(s0, { yes: [true], targets: [[obj(ogre)], [obj(field1)]] });
      expect(stackTargets(s, raze)).toEqual([obj(bear), obj(field1)]);
    });
  });
});
