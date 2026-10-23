/**
 * FAST5X E11: behold, teamwork and tiered, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 702.194a-b, 601.2b, 601.2f-h  teamwork: an optional additional cost, tap creatures you control with total power N or more (summoning-sick ones too: it is
 *                                    not a {T} cost, CR 302.6); "if this spell was cast using teamwork"
 *   CR 700.2, 601.2b                 "Choose one. If this spell was cast using teamwork, choose both instead."
 *   CR 614.15, 118.12                "counter that spell unless its controller pays {4} instead if ..."; "it deals 4 damage to that creature instead"
 *   CR 702.183a, 700.2h              tiered: choose one mode, pay its cost as an additional cost
 *   CR 701.4a-b                      behold: reveal a card from hand (it stays there) or choose a permanent you control; "or pay {2}"; "if a Dragon was beheld"
 *   CR 607.2q                        "behold a Kithkin and exile it" ... "return the exiled card to its owner's hand"
 *   CR 614.1c, 614.12a               "As ~ enters, you may behold a Jace. If you don't, ~ enters tapped."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { lifeOf, logHas } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const manualOf = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);

/** The answers to the decisions of a cast, in order of kind; mana payment is automatic. Stops at the next priority decision. */
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
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const castable = (s: GameState, name: string, player = 'p1'): boolean => {
  const id = find(s, name, 'hand', player);
  return legalActions(s, player).some((a) => a.action.type === 'cast' && a.action.card === id);
};
const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;
const zoneOf = (s: GameState, name: string): string | undefined => Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name)?.zone;
const damage = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;

const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['4', '4']);
const GIANT = card('Test Giant', 'Creature — Giant', '', '{1}', ['6', '6']);
const THOUGHT = card('Test Thought', 'Sorcery', 'Draw a card.', '{0}');

// ---- teamwork -------------------------------------------------------------------------------------------------------------------------------------------

const TW_MODES = card('Test Team Choice', 'Sorcery', 'Teamwork 3\nChoose one. If this spell was cast using teamwork, choose both instead.\n• Put a +1/+1 counter on target creature.\n• You gain 4 life.');
const TW_STRIKE = card('Test Team Strike', 'Instant', 'Teamwork 2\nTest Team Strike deals 2 damage to target creature. If this spell was cast using teamwork, it deals 5 damage to that creature instead.');
const TW_NAY = card('Test Team Nay', 'Instant', 'Teamwork 2\nCounter target spell unless its controller pays {1}. Counter that spell unless its controller pays {3} instead if this spell was cast using teamwork.');
const TW_BLAST = card('Test Team Blast', 'Sorcery', 'Teamwork 2\nTest Team Blast deals 3 damage to target creature. If this spell was cast using teamwork, it also deals 2 damage to that creature\'s controller.');
const TW_EXILE = card('Test Team Exile', 'Sorcery', 'Teamwork 2\nExile target creature with mana value 3 or less. If this spell was cast using teamwork, instead exile target creature and you gain 3 life.');
const TITAN = card('Test Titan', 'Creature — Giant', '', '{6}', ['6', '6']);
const TW_DEFS = [TW_MODES, TW_STRIKE, TW_NAY, TW_BLAST, TW_EXILE, TITAN, BEAR, OGRE, GIANT, THOUGHT];

describe('FAST5X E11 teamwork (CR 702.194)', () => {
  it('CR 702.194a-b: every teamwork shape is understood (the keyword, "choose both instead", "instead", "also")', () => {
    for (const d of [TW_MODES, TW_STRIKE, TW_NAY, TW_BLAST]) expect(manualOf(d), d.name).toEqual([]);
    expect(TW_MODES.faces[0]!.abilities.find((a) => a.kind === 'spell')).toMatchObject({ effect: { modes: { min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: 'teamwork' }, min: 2, max: 2 } } } });
  });

  it('CR 702.194a, 302.6, 700.2: paying teamwork taps creatures with total power 3 or more, summoning-sick ones included, and both modes are chosen', () => {
    let s = scenario([], { defs: TW_DEFS, p1: { hand: ['Test Team Choice'], battlefield: [{ name: 'Test Bear', since: 1 }, { name: 'Test Bear', since: 1 }] } });
    const [b1, b2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
    s = cast(s, 'Test Team Choice', { yes: [true], objects: [[b1!, b2!]], options: [['0', '1']], targets: [[obj(b1!)]] });
    expect(tapped(s, b1!) && tapped(s, b2!)).toBe(true);
    s = resolveAll(s);
    expect(s.objects[b1!]!.counters['+1/+1']).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(24);
  });

  it('CR 702.194a, 700.2: without teamwork only one mode is chosen and nothing is tapped', () => {
    let s = scenario([], { defs: TW_DEFS, p1: { hand: ['Test Team Choice'], battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = cast(s, 'Test Team Choice', { yes: [false], options: [['1']] });
    expect(tapped(s, ogre)).toBe(false);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(24);
    expect(s.objects[ogre]!.counters['+1/+1']).toBeUndefined();
  });

  it('CR 702.194a, 118.3: teamwork is not offered when the creatures you control have total power less than N', () => {
    let s = scenario([], { defs: TW_DEFS, p1: { hand: ['Test Team Choice'], battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Team Choice', { options: [['1']] });
    expect(logHas(s, /can't pay the teamwork cost/)).toBe(true);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(24);
  });

  it('CR 614.15, 702.194b: "it deals 5 damage to that creature instead" with teamwork, 2 damage without', () => {
    let s = scenario([], { defs: TW_DEFS, p1: { hand: ['Test Team Strike'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const s1 = resolveAll(cast(s, 'Test Team Strike', { yes: [true], objects: [[ogre]], targets: [[obj(giant)]] }));
    expect(damage(s1, giant)).toBe(5);
    const s2 = resolveAll(cast(s, 'Test Team Strike', { yes: [false], targets: [[obj(giant)]] }));
    expect(damage(s2, giant)).toBe(2);
  });

  it('CR 608.2c, 702.194b: "it also deals 2 damage to that creature\'s controller" only with teamwork', () => {
    let s = scenario([], { defs: TW_DEFS, p1: { hand: ['Test Team Blast'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const s1 = resolveAll(cast(s, 'Test Team Blast', { yes: [true], objects: [[ogre]], targets: [[obj(giant)]] }));
    expect([damage(s1, giant), lifeOf(s1, 'p2')]).toEqual([3, 18]);
    const s2 = resolveAll(cast(s, 'Test Team Blast', { yes: [false], targets: [[obj(giant)]] }));
    expect([damage(s2, giant), lifeOf(s2, 'p2')]).toEqual([3, 20]);
  });

  it('CR 702.194c, 601.2c, 614.15: "If this spell was cast using teamwork, instead exile target creature and you gain 3 life": the targets of each branch', () => {
    const s = scenario([], { defs: TW_DEFS, p1: { hand: ['Test Team Exile'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Titan'] } });
    const titan = find(s, 'Test Titan', 'battlefield', 'p2');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const s1 = resolveAll(cast(s, 'Test Team Exile', { yes: [true], objects: [[ogre]], targets: [[obj(titan)]] }));
    expect([zoneOf(s1, 'Test Titan'), lifeOf(s1, 'p1')]).toEqual(['exile', 23]);
    // without teamwork only a creature with mana value 3 or less can be the target: the Titan can't, so the spell has no legal target and can't be cast
    const s2 = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Team Exile', 'hand', 'p1') });
    expect(s2.pending?.kind).toBe('yesNo');
    expect(() => drive(s2, { yes: [false], targets: [[obj(titan)]] })).toThrow();
  });

  it('CR 614.15, 118.12: "counter that spell unless its controller pays {3} instead": with teamwork the controller pays {3}, not {1}', () => {
    let s = scenario([], { defs: TW_DEFS, p1: { hand: ['Test Thought'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Team Nay'], battlefield: ['Test Ogre'] } });
    s = cast(s, 'Test Thought');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Team Nay', { yes: [true], objects: [[ogre]], targets: [[obj(spell)]] }, 'p2');
    s = act(s, { type: 'pass', player: 'p2' });
    s = act(s, { type: 'pass', player: 'p1' });
    // the controller of Test Thought is asked to pay {3}
    expect(s.pending?.kind).toBe('yesNo');
    expect(JSON.stringify(s.pending)).toContain('{3}');
    s = drive(s, { yes: [true] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(3);
    expect(s.zones.stack).toContain(spell);
  });
});

// ---- tiered ---------------------------------------------------------------------------------------------------------------------------------------------

const TIERED = card('Test Tiered Bolt', 'Instant', 'Tiered\n• Spark — {0} — Test Tiered Bolt deals 1 damage to target creature.\n• Blaze — {2} — Test Tiered Bolt deals 3 damage to target creature.\n• Inferno — {4} — Test Tiered Bolt deals 6 damage to target creature.');

describe('FAST5X E11 tiered (CR 702.183)', () => {
  it('CR 702.183a, 700.2h: the modes, each with its name and its additional cost, are understood', () => {
    expect(manualOf(TIERED)).toEqual([]);
    const spell = TIERED.faces[0]!.abilities.find((a) => a.kind === 'spell')!;
    expect(spell).toMatchObject({ effect: { modes: { min: 1, max: 1, options: [{ label: 'Spark', cost: { mana: [{ kind: 'generic', amount: 0 }] } }, { label: 'Blaze', cost: { mana: [{ kind: 'generic', amount: 2 }] } }, { label: 'Inferno' }] } } });
  });

  it('CR 702.183a, 700.2h: choosing a mode adds its cost to the total cost (Blaze: {2} more)', () => {
    let s = scenario([], { defs: [TIERED, GIANT], p1: { hand: ['Test Tiered Bolt'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Tiered Bolt', { options: [['1']], targets: [[obj(giant)]] }));
    expect(damage(s, giant)).toBe(3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(2);
  });

  it('CR 702.183a, 601.2h: a mode whose cost can\'t be paid can\'t be chosen (Inferno with two lands)', () => {
    let s = scenario([], { defs: [TIERED, GIANT], p1: { hand: ['Test Tiered Bolt'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Giant'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tiered Bolt', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseOption');
    const opts = (s.pending as { options: { id: string; disabled?: string }[] }).options;
    expect(opts.find((o) => o.id === '2')?.disabled).toBeDefined();
    expect(opts.find((o) => o.id === '0')?.disabled).toBeUndefined();
  });
});

// ---- behold -----------------------------------------------------------------------------------------------------------------------------------------------

const SPRITE = card('Test Sprite', 'Creature — Faerie', '', '{1}', ['1', '1']);
const DRAKE = card('Test Drake', 'Creature — Dragon', '', '{5}', ['5', '5']);
const ASPIRANT = card('Test Faerie Aspirant', 'Creature — Faerie', 'As an additional cost to cast this spell, behold a Faerie or pay {2}.', '{0}', ['2', '2']);
const EXHALE = card('Test Draconic Breath', 'Instant', 'As an additional cost to cast this spell, you may behold a Dragon.\nTest Draconic Breath deals 2 damage to target creature. If a Dragon was beheld, you gain 3 life.');
const DENY = card('Test Draconic Denial', 'Instant', 'As an additional cost to cast this spell, you may behold a Dragon.\nCounter target spell unless its controller pays {1}. If a Dragon was beheld, counter that spell unless its controller pays {3} instead.');
const CHAMPION = card('Test Faerie Champion', 'Creature — Faerie Knight', 'As an additional cost to cast this spell, behold a Faerie and exile it.\nWhen this creature leaves the battlefield, return the exiled card to its owner\'s hand.', '{0}', ['3', '3']);
const SANCTUM = card('Test Faerie Glade', 'Land', 'As this land enters, you may behold a Faerie. If you don\'t, this land enters tapped.\n{T}: Add {G}.');
const SEEKER = card('Test Faerie Seeker', 'Sorcery', 'You may behold a Faerie. If you do, you gain 3 life.');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 4 damage to target creature.');
const BEHOLD_DEFS = [SPRITE, DRAKE, ASPIRANT, EXHALE, DENY, CHAMPION, SANCTUM, SEEKER, SHOCK, GIANT, THOUGHT];

describe('FAST5X E11 behold (CR 701.4)', () => {
  it('CR 701.4a: every behold shape is understood (behold or pay, you may behold, behold and exile it, as ~ enters, the step)', () => {
    for (const d of [ASPIRANT, EXHALE, DENY, CHAMPION, SANCTUM, SEEKER]) expect(manualOf(d), d.name).toEqual([]);
    expect(ASPIRANT.faces[0]!.abilities[0]).toMatchObject({ kind: 'static', effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'behold', filter: { subtypes: ['Faerie'] }, count: 1 }] }, choiceGroup: 'cost' }, { s: 'additionalCost', cost: { mana: [{ kind: 'generic', amount: 2 }] }, choiceGroup: 'cost' }] });
    expect(CHAMPION.faces[0]!.abilities[0]).toMatchObject({ kind: 'static', effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'behold', exile: true, link: 'exiled' }] } }] });
  });

  it('CR 701.4a: beholding a card revealed from the hand leaves it in the hand', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Aspirant', 'Test Sprite'] } });
    const sprite = find(s, 'Test Sprite', 'hand', 'p1');
    s = cast(s, 'Test Faerie Aspirant', { options: [['0']], objects: [[sprite]] });
    expect(logHas(s, /reveals Test Sprite from their hand to behold it/, 'CR 701.4a')).toBe(true);
    expect(s.objects[sprite]!.zone).toBe('hand');
    s = resolveAll(s);
    expect(zoneOf(s, 'Test Faerie Aspirant')).toBe('battlefield');
  });

  it('CR 701.4a, 601.2b: a Faerie you control on the battlefield can be beheld (it is not tapped or moved)', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Aspirant'], battlefield: ['Test Sprite'] } });
    const sprite = find(s, 'Test Sprite', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Faerie Aspirant', { options: [['0']], objects: [[sprite]] }));
    expect([s.objects[sprite]!.zone, tapped(s, sprite)]).toEqual(['battlefield', false]);
    expect(zoneOf(s, 'Test Faerie Aspirant')).toBe('battlefield');
  });

  it('CR 601.2b, 118.3: with nothing to behold, "or pay {2}" is the cost; with neither the spell can\'t be cast', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Aspirant'], battlefield: ['Plains', 'Plains'] } });
    s = resolveAll(cast(s, 'Test Faerie Aspirant'));
    expect(logHas(s, /pays the only additional cost .* \{2\}/)).toBe(true);
    expect(zoneOf(s, 'Test Faerie Aspirant')).toBe('battlefield');
    const t = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Aspirant'] } });
    expect(castable(t, 'Test Faerie Aspirant')).toBe(false);
  });

  it('CR 601.2a, 701.4a: a spell can\'t behold itself (it is on the stack as its costs are paid)', () => {
    const s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Champion'] } });
    expect(castable(s, 'Test Faerie Champion')).toBe(false);
  });

  it('CR 701.4b: "if a Dragon was beheld" holds only when a Dragon was beheld', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Draconic Breath', 'Test Drake'] }, p2: { battlefield: ['Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    const drake = find(s, 'Test Drake', 'hand', 'p1');
    const s1 = resolveAll(cast(s, 'Test Draconic Breath', { yes: [true], objects: [[drake]], targets: [[obj(giant)]] }));
    expect([damage(s1, giant), lifeOf(s1, 'p1')]).toEqual([2, 23]);
    const s2 = resolveAll(cast(s, 'Test Draconic Breath', { yes: [false], targets: [[obj(giant)]] }));
    expect([damage(s2, giant), lifeOf(s2, 'p1')]).toEqual([2, 20]);
  });

  it('CR 701.4b, 614.15: "counter that spell unless its controller pays {3} instead" after a Dragon was beheld', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Thought'], battlefield: ['Plains'] }, p2: { hand: ['Test Draconic Denial'], battlefield: ['Test Drake'] } });
    s = cast(s, 'Test Thought');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    const drake = find(s, 'Test Drake', 'battlefield', 'p2');
    s = cast(s, 'Test Draconic Denial', { yes: [true], objects: [[drake]], targets: [[obj(spell)]] }, 'p2');
    s = resolveAll(s, { yes: [true] });
    // p1 has one land: {3} can't be paid, so the spell is countered
    expect(zoneOf(s, 'Test Thought')).toBe('graveyard');
  });

  it('CR 701.4a, 607.2q: "behold a Faerie and exile it": the Faerie is exiled, and returns to its owner\'s hand when the creature leaves the battlefield', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Champion'], battlefield: ['Test Sprite'] }, p2: { hand: ['Test Shock'], battlefield: ['Plains'] } });
    const sprite = find(s, 'Test Sprite', 'battlefield', 'p1');
    s = cast(s, 'Test Faerie Champion', { objects: [[sprite]] });
    expect(zoneOf(s, 'Test Sprite')).toBe('exile');
    s = resolveAll(s);
    const champ = find(s, 'Test Faerie Champion', 'battlefield', 'p1');
    expect(s.objects[champ]!.links?.['exiled']?.objects).toHaveLength(1);
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(champ)]] }, 'p2');
    s = resolveAll(s);
    expect(zoneOf(s, 'Test Faerie Champion')).toBe('graveyard');
    expect(zoneOf(s, 'Test Sprite')).toBe('hand');
  });

  it('CR 701.4a, 607.2q: a Faerie card revealed from the hand can be the one beheld and exiled', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Champion', 'Test Sprite'] } });
    const sprite = find(s, 'Test Sprite', 'hand', 'p1');
    s = cast(s, 'Test Faerie Champion', { objects: [[sprite]] });
    expect(zoneOf(s, 'Test Sprite')).toBe('exile');
    s = resolveAll(s);
    expect(zoneOf(s, 'Test Faerie Champion')).toBe('battlefield');
  });

  it('CR 607.2q, 707.10: a copy of a "behold a Faerie and exile it" spell paid no cost, so the token it becomes is linked to no exiled card', () => {
    const mirror = card('Test Mirror Spell', 'Instant', 'Copy target creature spell you control.');
    let s = scenario([], { defs: [...BEHOLD_DEFS, mirror], p1: { hand: ['Test Faerie Champion', 'Test Mirror Spell'], battlefield: ['Test Sprite'] }, p2: { hand: ['Test Shock'], battlefield: ['Plains'] } });
    const sprite = find(s, 'Test Sprite', 'battlefield', 'p1');
    s = cast(s, 'Test Faerie Champion', { objects: [[sprite]] });
    const spell = s.zones.stack[0]!;
    s = cast(s, 'Test Mirror Spell', { targets: [[obj(spell)]] });
    s = resolveAll(s);
    const champs = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Faerie Champion');
    expect(champs).toHaveLength(2);
    const card_ = champs.find((id) => s.objects[id]!.kind === 'card')!;
    const token = champs.find((id) => s.objects[id]!.kind !== 'card')!;
    expect(token).toBeDefined();
    expect(s.objects[token]!.links?.['exiled']?.objects ?? []).toHaveLength(0);
    expect(s.objects[card_]!.links?.['exiled']?.objects).toHaveLength(1);
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(token)]] }, 'p2');
    s = resolveAll(s);
    expect(s.objects[card_]!.zone).toBe('battlefield');
    expect(zoneOf(s, 'Test Sprite')).toBe('exile');
  });

  it('CR 614.1c, 614.12a, 701.4a: "As this land enters, you may behold a Faerie. If you don\'t, this land enters tapped."', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Glade', 'Test Sprite'] } });
    const glade = find(s, 'Test Faerie Glade', 'hand', 'p1');
    const s1 = drive(act(s, { type: 'playLand', player: 'p1', card: glade }), { yes: [true] });
    expect(tapped(s1, find(s1, 'Test Faerie Glade', 'battlefield', 'p1'))).toBe(false);
    const s2 = drive(act(s, { type: 'playLand', player: 'p1', card: glade }), { yes: [false] });
    expect(tapped(s2, find(s2, 'Test Faerie Glade', 'battlefield', 'p1'))).toBe(true);
    s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Glade'] } });
    const s3 = drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Faerie Glade', 'hand', 'p1') }));
    expect(tapped(s3, find(s3, 'Test Faerie Glade', 'battlefield', 'p1'))).toBe(true);
  });

  it('CR 701.4a, 608.2d: "You may behold a Faerie. If you do, ..." (the behold step); with no Faerie it can\'t be done', () => {
    let s = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Seeker', 'Test Sprite'] } });
    s = resolveAll(cast(s, 'Test Faerie Seeker'), { yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(logHas(s, /reveals Test Sprite from their hand to behold it/)).toBe(true);
    let t = scenario([], { defs: BEHOLD_DEFS, p1: { hand: ['Test Faerie Seeker'] } });
    t = resolveAll(cast(t, 'Test Faerie Seeker'), { yes: [true] });
    expect(lifeOf(t, 'p1')).toBe(20);
  });
});
