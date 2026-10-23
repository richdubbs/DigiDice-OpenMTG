/**
 * FAST5X E1: optional cast-time costs with a resolution flag, played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 702.174a, 702.174k        gift: "you may choose an opponent" as an additional cost; declaring it promises the gift (the cast record's `gift`)
 *   CR 702.174b, 702.174d-h, j   the gift of an instant or sorcery is its first spell ability; a permanent gives it with an enters trigger
 *   CR 702.174c                  "whenever you give a gift" (the giveGift action event)
 *   CR 702.174m, 601.2c          targets that exist only when the gift was (or was not) promised
 *   CR 702.166a-b, 601.2f        bargain: sacrifice an artifact, enchantment or token; "if this spell was bargained"; "costs {2} less if it's bargained"
 *   CR 702.172a, 700.2h, 601.2f  spree: one or more modes, each mode's "+ {cost}" added to the total cost
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { lifeOf, logHas } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const manualOf = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);

/** The answers to the decisions of a cast, in order of kind; payment is automatic. Stops at the next priority decision. */
interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; options?: string[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], options: [...(script.options ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
/** Both players pass until the stack is empty (triggers included), answering what comes up with the script. */
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const named = (s: GameState, name: string, controller?: string): ObjectId[] =>
  s.zones.battlefield.filter((id) => (s.objects[id]!.defId === name || s.defs[s.objects[id]!.defId]?.name === name) && (controller === undefined || s.objects[id]!.controller === controller));
const tokensOf = (s: GameState, p: string, sub: string): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p && (s.defs[s.objects[id]!.defId]?.faces[0]?.subtypes ?? []).includes(sub));

const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['4', '4']);
const TRINKET = card('Test Trinket', 'Artifact', '', '{1}');

// ---- gift ---------------------------------------------------------------------------------------------------------------------------------------------

const GIFT_BOLT = card('Test Gift Bolt', 'Instant', 'Gift a Treasure\nTest Gift Bolt deals 2 damage to target creature. If the gift was promised, Test Gift Bolt also deals 3 damage to that creature\'s controller.');
const GIFT_WRECK = card('Test Gift Wreck', 'Sorcery', 'Gift a Treasure\nDestroy all artifacts.');
const GIFT_SCOUT = card('Test Gift Scout', 'Creature — Raccoon Scout', 'Gift a card\nWhen this creature enters, if the gift was promised, destroy target artifact an opponent controls.', '{0}', ['1', '1']);
const GIFT_ANGLER = card('Test Gift Angler', 'Creature — Otter', 'Gift a tapped Fish\nFlying', '{0}', ['1', '1']);
const GIFT_PICNIC = card('Test Gift Picnic', 'Instant', 'Gift a Food\nTarget creature you control gets +1/+1 until end of turn. If the gift was promised, that creature also gains indestructible until end of turn.');
const GIFT_CURRENT = card('Test Gift Current', 'Instant', 'Gift a card\nCounter target creature spell. If the gift was promised, instead counter target spell.');
const GIFT_HAMSTER = card('Test Gift Hamster', 'Creature — Hamster', 'Whenever you give a gift, draw a card.', '{0}', ['1', '1']);
const THOUGHT = card('Test Thought', 'Sorcery', 'Draw a card.', '{0}');
const GIFT_DEFS = [GIFT_BOLT, GIFT_WRECK, GIFT_SCOUT, GIFT_ANGLER, GIFT_PICNIC, GIFT_CURRENT, GIFT_HAMSTER, THOUGHT, BEAR, TRINKET];

describe('FAST5X E1 gift (CR 702.174)', () => {
  it('CR 702.174a-b, 702.174k: every gift shape is understood (keyword line, gift conditions, "also", "instead", "whenever you give a gift")', () => {
    for (const d of [GIFT_BOLT, GIFT_WRECK, GIFT_SCOUT, GIFT_ANGLER, GIFT_PICNIC, GIFT_CURRENT, GIFT_HAMSTER]) expect(manualOf(d), d.name).toEqual([]);
    const kw = GIFT_BOLT.faces[0]!.abilities[0]!;
    expect(kw).toMatchObject({ kind: 'keyword', keyword: 'gift', quality: 'a Treasure' });
  });

  it('CR 702.174h, 702.174k: a promised gift gives the chosen opponent a Treasure, and "if the gift was promised" holds', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Bolt'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Gift Bolt', { yes: [true], targets: [[obj(bear)]] });
    expect(s.zones.stack.length).toBe(1);
    expect(logHas(s, /promises Bob a gift/, 'CR 702.174a')).toBe(true);
    s = resolveAll(s);
    expect(tokensOf(s, 'p2', 'Treasure')).toHaveLength(1);
    expect(tokensOf(s, 'p1', 'Treasure')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(s.zones.graveyard['p2']!.map((id) => s.objects[id]!.defId)).toContain('Test Bear');
  });

  it('CR 702.174b: a gift that was not promised gives nothing, and the "if the gift was promised" part does nothing', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Bolt'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Gift Bolt', { yes: [false], targets: [[obj(bear)]] }));
    expect(tokensOf(s, 'p2', 'Treasure')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 702.174j: the gift of a sorcery happens before its other spell abilities (the gifted Treasure is destroyed by "Destroy all artifacts")', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Wreck'] }, p2: { battlefield: ['Test Trinket'] } });
    s = resolveAll(cast(s, 'Test Gift Wreck', { yes: [true] }));
    expect(tokensOf(s, 'p2', 'Treasure')).toHaveLength(0);
    expect(named(s, 'Test Trinket')).toHaveLength(0);
    expect(logHas(s, /Treasure/)).toBe(true);
  });

  it('CR 702.174b, 702.174e, 603.4: a permanent gives its gift with an enters trigger (the chosen player draws), and its own "if the gift was promised" trigger fires', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Scout'] }, p2: { battlefield: ['Test Trinket'] } });
    const before = handSize(s, 'p2');
    const trinket = find(s, 'Test Trinket', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Gift Scout', { yes: [true] }), { targets: [[obj(trinket)]] });
    expect(handSize(s, 'p2')).toBe(before + 1);
    expect(named(s, 'Test Trinket')).toHaveLength(0);
  });

  it('CR 702.174b, 603.4: a permanent whose gift was not promised gives nothing and its "if the gift was promised" trigger does not fire', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Scout'] }, p2: { battlefield: ['Test Trinket'] } });
    const before = handSize(s, 'p2');
    s = resolveAll(cast(s, 'Test Gift Scout', { yes: [false] }));
    expect(handSize(s, 'p2')).toBe(before);
    expect(named(s, 'Test Trinket')).toHaveLength(1);
  });

  it('CR 702.174f, 702.174c: a tapped 1/1 blue Fish for the opponent, and "whenever you give a gift" triggers for its controller only', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Angler'], battlefield: ['Test Gift Hamster'] } });
    const mine = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Gift Angler', { yes: [true] }));
    const fish = tokensOf(s, 'p2', 'Fish');
    expect(fish).toHaveLength(1);
    expect(s.objects[fish[0]!]!.tapped).toBe(true);
    const fishDef = s.defs[s.objects[fish[0]!]!.defId]!.faces[0]!;
    expect([fishDef.power, fishDef.toughness, fishDef.colors]).toEqual(['1', '1', ['U']]);
    expect(handSize(s, 'p1')).toBe(mine - 1 + 1); // the Angler left the hand, the Hamster drew one
  });

  it('CR 702.174c: no gift was given when it was not promised, so "whenever you give a gift" does not trigger', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Angler'], battlefield: ['Test Gift Hamster'] } });
    const mine = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Gift Angler', { yes: [false] }));
    expect(tokensOf(s, 'p2', 'Fish')).toHaveLength(0);
    expect(handSize(s, 'p1')).toBe(mine - 1);
  });

  it('CR 702.174d, 608.2c: Gift a Food, then "that creature also gains indestructible" only when promised', () => {
    let s = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Gift Picnic'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Gift Picnic', { yes: [true], targets: [[obj(bear)]] }));
    expect(tokensOf(s, 'p2', 'Food')).toHaveLength(1);
    const kws = s.continuousEffects.flatMap((e) => JSON.stringify(e.effect));
    expect(kws.some((k) => k.includes('indestructible'))).toBe(true);
  });

  it('CR 702.174m, 601.2c: "Counter target creature spell. If the gift was promised, instead counter target spell." targets only what each choice needs', () => {
    const s0 = scenario([], { defs: GIFT_DEFS, p1: { hand: ['Test Thought', 'Test Gift Current'], library: ['Test Bear', 'Test Bear'] } });
    let s = cast(s0, 'Test Thought');
    const thought = s.zones.stack[0]!;
    // a noncreature spell: castable only by promising the gift (the cast is offered, CR 601.2c)
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label.includes('Test Gift Current'))).toBe(true);
    // declining the gift leaves no legal creature spell to target: the whole cast is reversed (CR 601.2c, 733.1)
    expect(() => cast(s, 'Test Gift Current', { yes: [false] })).toThrow();
    s = cast(s, 'Test Gift Current', { yes: [true], targets: [[obj(thought)]] });
    const current = s.zones.stack[s.zones.stack.length - 1]!;
    expect(s.objects[current]!.stack!.targets.flat()).toEqual([obj(thought)]);
    s = resolveAll(s);
    expect(logHas(s, /counter/i)).toBe(true);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Thought');
  });
});

describe('FAST5X E1 gift: "You and permanents you control gain hexproof until end of turn" (CR 702.11b-c)', () => {
  const TRUCE = card('Test Gift Truce', 'Instant', 'Gift a card\nYou and permanents you control gain hexproof until end of turn. If the gift was promised, permanents you control also gain indestructible until end of turn.');
  const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
  it('CR 702.11c, 611.2a: the player can\'t be the target of the opponent\'s spells this turn; the permanents have hexproof (and indestructible only with the gift)', () => {
    expect(manualOf(TRUCE)).toEqual([]);
    let s = scenario([], { defs: [TRUCE, SHOCK, BEAR], p1: { hand: ['Test Gift Truce'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Shock'] } });
    s = resolveAll(cast(s, 'Test Gift Truce', { yes: [false] }));
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    const t = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Shock', 'hand', 'p2') });
    expect(t.pending?.kind).toBe('chooseTargets');
    expect(() => answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] })).toThrow();
    expect(() => answer(t, { kind: 'chooseTargets', targets: [obj(find(s, 'Test Bear', 'battlefield', 'p1'))] })).toThrow();
    expect(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }).zones.stack).toHaveLength(1);
    expect(s.continuousEffects.some((e) => JSON.stringify(e.effect).includes('indestructible'))).toBe(false);
  });
});

// ---- bargain ------------------------------------------------------------------------------------------------------------------------------------------

const BARGAIN_GRIP = card('Test Bargain Grip', 'Instant', 'Bargain\nTarget creature gets -3/-3 until end of turn. If this spell was bargained, that creature gets -5/-5 until end of turn instead.');
const BARGAIN_GLUTTON = card('Test Bargain Glutton', 'Creature — Giant', 'Bargain\nThis spell costs {2} less to cast if it\'s bargained.\nTrample', '{4}', ['4', '4']);
const BARGAIN_NEGOTIATOR = card('Test Bargain Negotiator', 'Creature — Faerie', 'Bargain\nWhen this creature enters, if it was bargained, each opponent loses 2 life and you gain 2 life.', '{0}', ['1', '1']);
const BARGAIN_DEFS = [BARGAIN_GRIP, BARGAIN_GLUTTON, BARGAIN_NEGOTIATOR, OGRE, TRINKET, BEAR];

describe('FAST5X E1 bargain (CR 702.166)', () => {
  it('CR 702.166a-b: the bargain shapes are understood', () => {
    for (const d of [BARGAIN_GRIP, BARGAIN_GLUTTON, BARGAIN_NEGOTIATOR]) expect(manualOf(d), d.name).toEqual([]);
  });

  it('CR 702.166a-b, 614.15: bargained (an artifact sacrificed as the cost), the creature gets -5/-5 instead of -3/-3', () => {
    let s = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Bargain Grip'], battlefield: ['Test Trinket'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const trinket = find(s, 'Test Trinket', 'battlefield', 'p1');
    s = cast(s, 'Test Bargain Grip', { yes: [true], targets: [[obj(ogre)]], objects: [[trinket]] });
    expect(named(s, 'Test Trinket')).toHaveLength(0);
    s = resolveAll(s);
    expect(named(s, 'Test Ogre')).toHaveLength(0);
  });

  it('CR 702.166b: not bargained, the creature gets -3/-3 only', () => {
    let s = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Bargain Grip'], battlefield: ['Test Trinket'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Bargain Grip', { yes: [false], targets: [[obj(ogre)]] }));
    expect(named(s, 'Test Ogre')).toHaveLength(1);
    expect(named(s, 'Test Trinket')).toHaveLength(1);
  });

  it('CR 702.166a: with no artifact, enchantment or token to sacrifice, bargain is not offered (a creature card is no token)', () => {
    let s = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Bargain Grip'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bargain Grip', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = resolveAll(drive(s, { targets: [[obj(ogre)]] }));
    expect(logHas(s, /can't pay the bargain cost/)).toBe(true);
    expect(named(s, 'Test Bear')).toHaveLength(1);
  });

  it('CR 601.2f, 702.166b: "costs {2} less to cast if it\'s bargained": castable with two lands only by bargaining, and then it costs {2}', () => {
    const lands = ['Plains', 'Plains'];
    const poor = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Bargain Glutton'], battlefield: lands } });
    expect(legalActions(poor, 'p1').some((a) => a.kind === 'cast' && a.label.includes('Test Bargain Glutton'))).toBe(false);
    let s = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Bargain Glutton'], battlefield: [...lands, 'Test Trinket'] } });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label.includes('Test Bargain Glutton'))).toBe(true);
    s = cast(s, 'Test Bargain Glutton', { yes: [true], objects: [[find(s, 'Test Trinket', 'battlefield', 'p1')]] });
    expect(s.zones.stack).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(2);
    s = resolveAll(s);
    expect(named(s, 'Test Bargain Glutton', 'p1')).toHaveLength(1);
  });

  it('CR 607.2i, 603.4: a bargained creature remembers it: "when this creature enters, if it was bargained" fires; unbargained it does not', () => {
    let s = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Bargain Negotiator'], battlefield: ['Test Trinket'] } });
    s = resolveAll(cast(s, 'Test Bargain Negotiator', { yes: [true], objects: [[find(s, 'Test Trinket', 'battlefield', 'p1')]] }));
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([22, 18]);
    let t = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Bargain Negotiator'], battlefield: ['Test Trinket'] } });
    t = resolveAll(cast(t, 'Test Bargain Negotiator', { yes: [false] }));
    expect([lifeOf(t, 'p1'), lifeOf(t, 'p2')]).toEqual([20, 20]);
  });
});

// ---- spree --------------------------------------------------------------------------------------------------------------------------------------------

const SPREE_BLAST = card('Test Spree Blast', 'Instant', 'Spree\n+ {1} — Test Spree Blast deals 3 damage to target creature.\n+ {2} — Destroy target artifact.', '{0}');

describe('FAST5X E1 spree (CR 702.172)', () => {
  it('CR 702.172a: the Spree lines are the modes of the spell, each with its cost', () => {
    expect(manualOf(SPREE_BLAST)).toEqual([]);
    const spell = SPREE_BLAST.faces[0]!.abilities.find((a) => a.kind === 'spell') as { effect: { modes: { min: number; max: number; options: { cost?: unknown }[] } } };
    expect(spell.effect.modes.min).toBe(1);
    expect(spell.effect.modes.max).toBe(2);
    expect(spell.effect.modes.options.map((o) => o.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 1 }] }, { mana: [{ kind: 'generic', amount: 2 }] }]);
  });

  it('CR 702.172a, 700.2h, 601.2f: both modes chosen: both costs are paid and both happen', () => {
    let s = scenario([], { defs: [SPREE_BLAST, BEAR, TRINKET], p1: { hand: ['Test Spree Blast'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear', 'Test Trinket'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const trinket = find(s, 'Test Trinket', 'battlefield', 'p2');
    s = cast(s, 'Test Spree Blast', { options: [['0', '1']], targets: [[obj(bear)], [obj(trinket)]] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(3);
    s = resolveAll(s);
    expect(named(s, 'Test Bear')).toHaveLength(0);
    expect(named(s, 'Test Trinket')).toHaveLength(0);
  });

  it('CR 702.172a, 700.2h: one mode chosen: only its cost is paid; a mode whose cost can\'t be paid can\'t be chosen', () => {
    let s = scenario([], { defs: [SPREE_BLAST, BEAR, TRINKET], p1: { hand: ['Test Spree Blast'], battlefield: ['Plains'] }, p2: { battlefield: ['Test Bear', 'Test Trinket'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spree Blast', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseOption');
    const opts = (s.pending as { options: { id: string; disabled?: string }[] }).options;
    expect(opts.find((o) => o.id === '1')?.disabled).toBeDefined();
    expect(opts.find((o) => o.id === '0')?.disabled).toBeUndefined();
    s = resolveAll(drive(s, { options: [['0']], targets: [[obj(bear)]] }));
    expect(named(s, 'Test Bear')).toHaveLength(0);
    expect(named(s, 'Test Trinket')).toHaveLength(1);
  });
});
