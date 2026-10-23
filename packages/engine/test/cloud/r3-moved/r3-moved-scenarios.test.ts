/**
 * Standard round 3, r3-moved: what an earlier instruction or a cost moved, beyond Cloud C7 and C8 (CR 608.2c, 608.2h). Played through the engine with synthetic
 * cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each describe is named after the rule it checks.
 *
 *   CR 602.2b, 608.2c, 608.2h   "{1}, Sacrifice another creature: ... If a Goblin was sacrificed this way, ...": the cost is the only thing of that kind (C8's costSacrificed)
 *   CR 603.12, 608.2c, 118.12   "Draw a card, then you may discard a card. When you discard a nonland card this way, ...": a reflexive trigger on what the option moved
 *   CR 603.12, 608.2h, 202.3    "Then you may discard two cards. When you do, ... where X is the greatest mana value among cards discarded this way."
 *   CR 205.2a, 608.2h           "Each player discards a card. Then you draw a card for each card type among cards discarded this way."
 *   CR 608.2c, 608.2d, 400.7    "Target player discards two cards. Put up to one land card discarded this way onto the battlefield tapped under your control."
 *   CR 701.9a, 608.2h           "Draw a card, then discard a card. You gain life equal to the discarded card's mana value."
 *   CR 602.2b, 608.2c           "{T}, Exile any number of cards from your graveyard: ... where X is the number of cards exiled this way." (a cost of several cards)
 *   design 6.4 (fail closed)    an instruction of that kind beside the cost, a cost of two objects, a cost discard beside a resolution discard
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const toughness = (s: GameState, id: ObjectId): number | null => ptNumbers(getChars(s, id)).toughness;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
/** Pick the first option that is a card named `name` (read in the state of the decision). */
const named = (name: string): Pick => (options, _min, _max, st) => options.filter((id) => st.objects[id]!.defId === name).slice(0, 1);

type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
type Pick = (options: ObjectId[], min: number, max: number, st: GameState) => ObjectId[];
/** Answer the decisions until priority: payments automatic, the targets in order, `pick` for object choices (default: the first allowed), `yes` to "may". */
function drive(s0: GameState, targets: Target[][] = [], pick?: Pick, yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options, p.min, p.max, s) : p.options.slice(0, Math.max(p.min, 1)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: Math.min(p.max, 3) }); // "any number" of a cost: three
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = [], pick?: Pick, yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, pick, yes);
  return s;
}
const cast = (s: GameState, name: string, targets: Target[][] = [], pick?: Pick, yes = true): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, pick, yes), targets, pick, yes);
const activate = (s: GameState, name: string, targets: Target[][] = [], pick?: Pick, yes = true): GameState => {
  const src = find(s, name, 'battlefield', 'p1');
  const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), targets, pick, yes), targets, pick, yes);
};

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'], cost: '{3}{R}' });
const IDOL = card('Test Idol', 'Artifact', '', { cost: '{1}' });
const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.', { cost: '{2}{B}' });

describe('CR 602.2b, 608.2c, 608.2h: "{1}, Sacrifice another creature: ... If a Goblin was sacrificed this way, ..." reads what the cost sacrificed', () => {
  const ALTAR = card('Test Grim Altar', 'Artifact', '{0}, Sacrifice another creature: Put a +1/+1 counter on target creature you control. If a Goblin was sacrificed this way, you gain 2 life.');
  const YOURS = card('Test Own Altar', 'Artifact', '{0}, Sacrifice a creature: You gain 1 life. If you sacrificed a Goblin this way, draw a card.');
  it('is understood, as a condition on the object the cost sacrificed (Cloud C8\'s costSacrificed)', () => {
    expect(noManual(ALTAR)).toBe(true);
    expect(noManual(YOURS)).toBe(true);
    expect(JSON.stringify(ALTAR.faces)).toContain('{"cond":"matches","object":{"ref":"costSacrificed"},"filter":{"subtypes":["Goblin"]}}');
  });
  it('a Goblin sacrificed: 2 life; a Bear sacrificed: none', () => {
    let s = scenario([], { defs: [ALTAR, BEAR, GOBLIN], p1: { battlefield: ['Test Grim Altar', 'Test Goblin', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    let before = life(s, 'p1');
    s = activate(s, 'Test Grim Altar', [[{ kind: 'object', id: bear }]], named('Test Goblin'));
    expect(onField(s, 'Test Goblin')).toEqual([]);
    expect(life(s, 'p1')).toBe(before + 2);
    let t = scenario([], { defs: [ALTAR, BEAR, GOBLIN], p1: { battlefield: ['Test Grim Altar', 'Test Goblin', 'Test Bear'] } });
    const goblin = find(t, 'Test Goblin', 'battlefield', 'p1');
    before = life(t, 'p1');
    t = activate(t, 'Test Grim Altar', [[{ kind: 'object', id: goblin }]], named('Test Bear'));
    expect(onField(t, 'Test Bear')).toEqual([]);
    expect(life(t, 'p1')).toBe(before);
  });
  it('"If you sacrificed a Goblin this way": you paid the cost, so it is the same object', () => {
    let s = scenario([], { defs: [YOURS, GOBLIN], p1: { battlefield: ['Test Own Altar', 'Test Goblin'] } });
    const cards = hand(s, 'p1');
    s = activate(s, 'Test Own Altar', [], named('Test Goblin'));
    expect(hand(s, 'p1')).toBe(cards + 1);
  });
  it('design 6.4: an instruction of that kind in the ability is what the words read, not the cost', () => {
    const BOTH = card('Test Twin Altar', 'Artifact', '{0}, Sacrifice a creature: Each opponent sacrifices a creature. If a Goblin was sacrificed this way, you gain 2 life.');
    expect(noManual(BOTH)).toBe(true);
    expect(JSON.stringify(BOTH.faces)).not.toContain('"object":{"ref":"costSacrificed"}');
  });
  it('design 6.4: a cost of two creatures names no one creature, so the sentence stays manual', () => {
    const TWO = card('Test Pair Altar', 'Artifact', '{0}, Sacrifice two creatures: Draw a card. If a Goblin was sacrificed this way, you gain 2 life.');
    expect(noManual(TWO)).toBe(false);
  });
});

describe('CR 603.12, 608.2c, 118.12: "Draw a card, then you may discard a card. When you discard a nonland card this way, ..." (a reflexive trigger on what was discarded)', () => {
  const HUNT = card('Test Frost Hunt', 'Sorcery', 'Draw a card, then you may discard a card. When you discard a nonland card this way, this spell deals 3 damage to target creature.');
  it('is understood: the trigger waits for the option and for what its discard moved', () => {
    expect(noManual(HUNT)).toBe(true);
    const json = JSON.stringify(HUNT.faces);
    expect(json).toContain('"op":"reflexive"');
    expect(json).toContain('"if":{"cond":"did"');
  });
  it('a nonland card discarded: the trigger targets a creature and deals 3 damage', () => {
    let s = scenario([], { defs: [HUNT, BEAR, IDOL], p1: { hand: ['Test Frost Hunt', 'Test Idol'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Frost Hunt', [[{ kind: 'object', id: bear }]], named('Test Idol'));
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Idol')).toBe(true);
    expect(onField(s, 'Test Bear')).toEqual([]);
  });
  it('a land card discarded: no trigger', () => {
    let s = scenario([], { defs: [HUNT, BEAR], p1: { hand: ['Test Frost Hunt', 'Plains'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Frost Hunt', [[{ kind: 'object', id: bear }]], named('Plains'));
    expect(onField(s, 'Test Bear')).toHaveLength(1);
  });
  it('CR 118.12: the option declined: nothing discarded, no trigger', () => {
    let s = scenario([], { defs: [HUNT, BEAR, IDOL], p1: { hand: ['Test Frost Hunt', 'Test Idol'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Frost Hunt', [[{ kind: 'object', id: bear }]], undefined, false);
    expect(hand(s, 'p1')).toBe(2); // the Idol and the card drawn
    expect(onField(s, 'Test Bear')).toHaveLength(1);
  });
});

describe('CR 603.12, 608.2h, 202.3: "Then you may discard two cards. When you do, ... where X is the greatest mana value among cards discarded this way."', () => {
  const BLAST = card('Test Late Blast', 'Sorcery', 'Draw a card. Then you may discard two cards. When you do, this spell deals X damage to each creature, where X is the greatest mana value among cards discarded this way.');
  it('is understood: X is read from the cards the discard bound', () => {
    expect(noManual(BLAST)).toBe(true);
    expect(JSON.stringify(BLAST.faces)).toContain('"q":"stat","stat":"manaValue","of":{"ref":"bound"');
  });
  it('a mana value 4 card and a mana value 1 card discarded: 4 damage to each creature', () => {
    let s = scenario([], { defs: [BLAST, OGRE, IDOL, BEAR], p1: { hand: ['Test Late Blast', 'Test Ogre', 'Test Idol'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    s = cast(s, 'Test Late Blast', [], (options, _min, _max, st) => options.filter((id) => st.objects[id]!.defId !== 'Plains').slice(0, 2));
    expect(onField(s, 'Test Bear')).toEqual([]);
    const ogre = onField(s, 'Test Ogre')[0]!;
    expect(s.objects[ogre]!.damage).toBe(4);
  });
});

describe('CR 205.2a, 608.2h: "Each player discards a card. Then you draw a card for each card type among cards discarded this way."', () => {
  const COURT = card('Test Mad Court', 'Sorcery', 'Each player discards a card. Then you draw a card for each card type among cards discarded this way.');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'], cost: '{3}' });
  it('is understood', () => expect(noManual(COURT)).toBe(true));
  it('an artifact creature card and a land card discarded: three card types, three cards', () => {
    let s = scenario([], { defs: [COURT, GOLEM], p1: { hand: ['Test Mad Court', 'Test Golem'] }, p2: { hand: ['Plains'] } });
    s = cast(s, 'Test Mad Court');
    expect(hand(s, 'p2')).toBe(0);
    expect(hand(s, 'p1')).toBe(3);
  });
  it('two land cards discarded: one card type, one card', () => {
    let s = scenario([], { defs: [COURT], p1: { hand: ['Test Mad Court', 'Plains'] }, p2: { hand: ['Plains'] } });
    s = cast(s, 'Test Mad Court');
    expect(hand(s, 'p1')).toBe(1);
  });
});

describe('CR 608.2c, 608.2d, 400.7: "Target player discards two cards. Put up to one land card discarded this way onto the battlefield tapped under your control."', () => {
  const ROOTS = card('Test Deep Roots', 'Sorcery', 'Target player discards two cards. Put up to one land card discarded this way onto the battlefield tapped under your control.');
  it('is understood: a choice among the cards the discard bound, still in the graveyard', () => {
    expect(noManual(ROOTS)).toBe(true);
    expect(JSON.stringify(ROOTS.faces)).toContain('"types":["Land"],"isCard":true,"is":{"ref":"bound"');
  });
  it('the land card the opponent discarded enters tapped under your control; the other card stays in their graveyard', () => {
    let s = scenario([], { defs: [ROOTS, BEAR], p1: { hand: ['Test Deep Roots'] }, p2: { hand: ['Plains', 'Test Bear'] } });
    s = cast(s, 'Test Deep Roots', [[{ kind: 'player', id: 'p2' }]], (options, min, max) => options.slice(0, Math.max(min, Math.min(max, 2))));
    const land = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p1' && s.objects[id]!.owner === 'p2');
    expect(land).toHaveLength(1);
    expect(s.objects[land[0]!]!.tapped).toBe(true);
    expect(s.zones.graveyard['p2']!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
  });
  it('up to one: you may choose none', () => {
    let s = scenario([], { defs: [ROOTS, BEAR], p1: { hand: ['Test Deep Roots'] }, p2: { hand: ['Plains', 'Test Bear'] } });
    let first = true;
    s = cast(s, 'Test Deep Roots', [[{ kind: 'player', id: 'p2' }]], (options, min) => {
      if (first && min === 2) { first = false; return options.slice(0, 2); } // the discard
      return [];
    });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.owner === 'p2' && s.objects[id]!.defId === 'Plains')).toBe(false);
  });
});

describe('CR 701.9a, 608.2h: "Draw a card, then discard a card. You gain life equal to the discarded card\'s mana value." (the card one player discarded)', () => {
  const LOOT = card('Test Loot Price', 'Sorcery', "Draw a card, then discard a card. You gain life equal to the discarded card's mana value.");
  it('is understood: the discard binds the card it discarded', () => expect(noManual(LOOT)).toBe(true));
  it('a mana value 3 card discarded: 3 life', () => {
    let s = scenario([], { defs: [LOOT, RITE], p1: { hand: ['Test Loot Price', 'Test Rite'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Loot Price', [], named('Test Rite'));
    expect(life(s, 'p1')).toBe(before + 3);
  });
  it('design 6.4: with a discard cost too, "the discarded card" has two antecedents and stays manual', () => {
    const BOTH = card('Test Two Discards', 'Artifact', "{0}, Discard a card: Draw a card, then discard a card. You gain life equal to the discarded card's mana value.");
    expect(noManual(BOTH)).toBe(false);
  });
});

describe('CR 602.2b, 608.2c: "{T}, Exile any number of cards from your graveyard: ... where X is the number of cards exiled this way." (a cost of several cards)', () => {
  const BRINGER = card('Test Grave Bringer', 'Creature — Spirit', '{T}, Exile any number of cards from your graveyard: Target creature gets -X/-X until end of turn, where X is the number of cards exiled this way.', { pt: ['1', '1'] });
  it('is understood: X counts what the cost exiled', () => {
    expect(noManual(BRINGER)).toBe(true);
    expect(JSON.stringify(BRINGER.faces)).toContain('{"q":"count","of":{"ref":"costExiled"}}');
  });
  it('three cards exiled for the cost: -3/-3', () => {
    let s = scenario([], { defs: [BRINGER, OGRE], p1: { battlefield: ['Test Grave Bringer'], graveyard: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = activate(s, 'Test Grave Bringer', [[{ kind: 'object', id: ogre }]], (options) => options.slice(0, 3));
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Plains')).toHaveLength(3);
    expect(toughness(s, ogre)).toBe(2);
  });
});

describe('CR 608.2h, 603.12 (wave 6 line moved review): a set a reflexive trigger reads is read as it last existed, even when a card of it left the graveyard', () => {
  const BLAST = card('Test Late Blast', 'Sorcery', 'Draw a card. Then you may discard two cards. When you do, this spell deals X damage to each creature, where X is the greatest mana value among cards discarded this way.');
  const GRAB = card('Test Grave Grab', 'Instant', 'Exile target card from a graveyard.');
  it('the mana value 4 card exiled from the graveyard in response to the trigger: X is still 4', () => {
    let s = scenario([], { defs: [BLAST, OGRE, IDOL, BEAR, GRAB], p1: { hand: ['Test Late Blast', 'Test Ogre', 'Test Idol'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Grave Grab'], battlefield: ['Test Ogre'] } });
    const discardTwo: Pick = (options, _min, _max, st) => options.filter((id) => st.objects[id]!.defId !== 'Plains').slice(0, 2);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Late Blast', 'hand', 'p1') }), [], discardTwo);
    s = drive(pass(pass(s)), [], discardTwo); // the sorcery resolves: the reflexive trigger is on the stack
    expect(s.zones.stack.length).toBe(1);
    s = pass(s); // p2 gets priority with the trigger on the stack
    const exiled = s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Ogre')!;
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Grave Grab', 'hand', 'p2') }), [[{ kind: 'object', id: exiled }]]);
    s = resolveAll(s);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Ogre']);
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(s.objects[onField(s, 'Test Ogre')[0]!]!.damage).toBe(4);
  });
});
