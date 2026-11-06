/**
 * Coordinator D, round edh-d-29 (lane attach, second pass): the round's readings and engine changes played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-03).
 *
 *   CR 303.4f, 303.4g, 702.5a   "Search your library for a Curse card, put it onto the battlefield attached to target player, then shuffle." (Bitterheart Witch)
 *   CR 712.14a, 303.4f, 400.7   "When ~ dies, return it to the battlefield transformed under your control attached to target creature / opponent." (Vengeful Strangler, Radiant Grace)
 *   CR 701.21a, 119.3, 608.2h   "Enchanted permanent's controller sacrifices a nonland permanent of their choice, then that player loses 1 life." (Strangling Grasp)
 *   CR 611.3a, 613.4c           "Equipped creature gets +1/+1. As long as it's legendary, it gets an additional +2/+2. As long as it's red, it has trample." (Tenza, Godo's Maul)
 *   CR 701.3a, 301.5c, 608.2c   "Create N tokens. For each of those tokens, you may attach an Equipment you control to it." (Goldwardens' Gambit, Reckless Crew)
 *   CR 303.4f, 701.3a, 601.7a   "Return it to the battlefield attached to you at the beginning of the next end step." / "You may attach a Curse attached to you to one of your opponents. If you do, draw two cards." (Lynde, Cheerful Tormentor)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: [...p.items.map((i: { id: string }) => i.id)] });
    else if (p.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (p.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}, who: PlayerId = 'p1'): GameState => settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), opts);
/** Both players pass until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
/** Resolve whatever is on the stack, also triggers that are put on it only when a player would receive priority. */
function drain(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, opts);
  for (let i = 0; i < 20; i++) {
    if (s.pending?.kind !== 'priority') { const t = settle(s, opts); if (t === s) break; s = t; continue; }
    if (s.zones.stack.length === 0) { const t = settle(pass(s), opts); if (t.zones.stack.length === 0 && t.turn.step !== s.turn.step) { s = t; break; } s = t; continue; }
    s = settle(pass(pass(s)), opts);
  }
  return s;
}
const lib = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'library', p);
const yard = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const attachedTo = (s: GameState, name: string): string | undefined => { const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === name); return id === undefined ? undefined : s.objects[id]!.attachedTo; };

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
const CURSE = card('Test Curse', 'Enchantment — Aura Curse', "Enchant player\nAt the beginning of enchanted player's upkeep, that player loses 1 life.");
const OPP_CURSE = card('Test Opp Curse', 'Enchantment — Aura Curse', "Enchant opponent\nAt the beginning of enchanted player's upkeep, that player loses 1 life.");
const AURA = card('Test Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');

// ---- Bitterheart Witch ------------------------------------------------------------------------------------------------------------------------------------------------
const WITCH = card('Test Witch', 'Creature — Human Shaman', 'When this creature enters, you may search your library for a Curse card, put it onto the battlefield attached to target opponent, then shuffle.', { pt: ['1', '1'] });
const SEEKER = card('Test Seeker', 'Creature — Human Shaman', 'When this creature enters, you may search your library for an Aura card, put it onto the battlefield attached to target player, then shuffle.', { pt: ['1', '1'] });
describe('CR 303.4f, 303.4g, 702.5a: "you may search your library for a Curse card, put it onto the battlefield attached to target player, then shuffle." (Bitterheart Witch)', () => {
  it('is automated', () => { expect(noManual(WITCH)).toBe(true); expect(noManual(SEEKER)).toBe(true); });
  const setup = (w: CardDef = WITCH, lib0: string[] = ['Test Bear', 'Test Curse', 'Test Aura']) => scenario([], { p1: { hand: [w.name], library: lib0 }, defs: [WITCH, SEEKER, BEAR, CURSE, OPP_CURSE, AURA] });
  it('the found Curse enters under Alice\'s control attached to the targeted opponent, and the library is searched', () => {
    const s0 = setup();
    let s = cast(s0, 'Test Witch');
    s = resolveAll(s, { targets: [[player('p2')]], answers: [yes], picks: [[find(s0, 'Test Curse', 'library', 'p1')]] });
    const curse = find(s, 'Test Curse', 'battlefield');
    expect(s.objects[curse]!.attachedTo).toBe('p2');
    expect(s.objects[curse]!.controller).toBe('p1');
    expect(lib(s)).not.toContain('Test Curse');
  });
  it('negative: answering no to "you may" leaves the library alone', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Witch'), { targets: [[player('p2')]], answers: [no] });
    expect(lib(s)).toContain('Test Curse');
    expect(attachedTo(s, 'Test Curse')).toBeUndefined();
  });
  it('negative (CR 303.4g): an Aura that enchants a creature, found for "target player", can\'t be attached to a player and stays in the library', () => {
    const s0 = setup(SEEKER);
    const s = resolveAll(cast(s0, 'Test Seeker'), { targets: [[player('p2')]], answers: [yes], picks: [[find(s0, 'Test Aura', 'library', 'p1')]] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Aura')).toBe(false);
    expect(lib(s)).toContain('Test Aura');
  });
  it('an "Enchant opponent" Aura attaches to an opponent but not to its controller', () => {
    const SELF = card('Test Self Seeker', 'Creature — Human Shaman', 'When this creature enters, you may search your library for a Curse card, put it onto the battlefield attached to target player, then shuffle.', { pt: ['1', '1'] });
    const mk = (target: PlayerId) => {
      const s0 = scenario([], { p1: { hand: ['Test Self Seeker'], library: ['Test Opp Curse'] }, defs: [SELF, OPP_CURSE] });
      return resolveAll(cast(s0, 'Test Self Seeker'), { targets: [[player(target)]], answers: [yes], picks: [[find(s0, 'Test Opp Curse', 'library', 'p1')]] });
    };
    expect(attachedTo(mk('p2'), 'Test Opp Curse')).toBe('p2');
    const own = mk('p1');
    expect(attachedTo(own, 'Test Opp Curse')).toBeUndefined();
    expect(lib(own)).toContain('Test Opp Curse');
  });
});

// ---- Vengeful Strangler and Radiant Grace --------------------------------------------------------------------------------------------------------------------------
const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.');
const mk2 = (name: string, front: { type: string; text: string; pt?: [string, string] }, back: { name: string; type: string; text: string }): CardDef => compileCard({
  name: `${name} // ${back.name}`, layout: 'transform', mana_cost: '{0}', type_line: `${front.type} // ${back.type}`, colors: [],
  card_faces: [
    { name, mana_cost: '{0}', type_line: front.type, oracle_text: front.text, colors: [], ...(front.pt ? { power: front.pt[0], toughness: front.pt[1] } : {}) },
    { name: back.name, mana_cost: '', type_line: back.type, oracle_text: back.text, colors: [] },
  ],
} as unknown as OracleCard);
const STRANGLER = mk2('Test Strangler', { type: 'Creature — Human Rogue', text: "This creature can't block.\nWhen this creature dies, return it to the battlefield transformed under your control attached to target creature or planeswalker an opponent controls.", pt: ['2', '2'] },
  { name: 'Test Grasp', type: 'Enchantment — Aura', text: 'Enchant creature or planeswalker an opponent controls\nAt the beginning of your upkeep, enchanted permanent\'s controller sacrifices a nonland permanent of their choice, then that player loses 1 life.' });
const GRACE = mk2('Test Grace Cleric', { type: 'Creature — Human Cleric', text: 'When this creature dies, return it to the battlefield transformed under your control attached to target opponent.', pt: ['1', '1'] },
  { name: 'Test Restraint', type: 'Enchantment — Aura', text: "Enchant player\nCreatures enchanted player controls enter tapped." });
const SNAME = 'Test Strangler // Test Grasp';
const GNAME = 'Test Grace Cleric // Test Restraint';
describe('CR 712.14a, 303.4f, 400.7: "When ~ dies, return it to the battlefield transformed under your control attached to target creature or planeswalker an opponent controls." (Vengeful Strangler)', () => {
  it('is automated', () => { expect(noManual(STRANGLER)).toBe(true); expect(noManual(GRACE)).toBe(true); });
  const setup = () => scenario([], { p1: { hand: ['Test Doom'], battlefield: [SNAME] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [STRANGLER, GRACE, DOOM, BEAR] });
  const kill = (s0: GameState, targetBear: ObjectId): GameState => {
    const s1 = cast(s0, 'Test Doom', { targets: [[obj(find(s0, SNAME, 'battlefield', 'p1'))]] });
    return resolveAll(s1, { targets: [[obj(targetBear)]] });
  };
  it('the Aura face returns under Alice\'s control attached to the targeted opponent creature', () => {
    const s0 = setup();
    const [b1] = findAll(s0, 'Test Bear', 'battlefield', 'p2');
    const s = kill(s0, b1!);
    const aura = find(s, SNAME, 'battlefield', 'p1');
    expect(s.objects[aura]!.face).toBe(1);
    expect(s.objects[aura]!.attachedTo).toBe(b1);
    expect(s.objects[aura]!.controller).toBe('p1');
  });
  it('negative (CR 303.4g): with no legal creature of an opponent to enchant the Aura face stays in the graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Doom'], battlefield: [SNAME] }, defs: [STRANGLER, GRACE, DOOM, BEAR] });
    const s = resolveAll(cast(s0, 'Test Doom', { targets: [[obj(find(s0, SNAME, 'battlefield', 'p1'))]] }));
    expect(yard(s)).toContain(SNAME);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === SNAME)).toBe(false);
  });
  it('Strangling Grasp: at Alice\'s upkeep Bob sacrifices a nonland permanent of his choice and loses 1 life, even when it is the enchanted permanent itself (CR 608.2h)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Doom'], battlefield: [SNAME] }, p2: { battlefield: ['Test Bear'] }, defs: [STRANGLER, GRACE, DOOM, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = kill(s0, bear);
    expect(s1.objects[find(s1, SNAME, 'battlefield', 'p1')]!.attachedTo).toBe(bear);
    const before = life(s1, 'p2');
    let s = advanceTo(s1, 3, 'upkeep');
    s = settle(resolveAll(s), { picks: [[bear]] });
    s = resolveAll(s);
    expect(s.zones.battlefield.includes(bear)).toBe(false); // the Bear was sacrificed (its only nonland permanent)
    expect(life(s, 'p2')).toBe(before - 1);
  });
});
describe('CR 712.14a, 303.4f, 702.5a: "When ~ dies, return it to the battlefield transformed under your control attached to target opponent." (Radiant Grace)', () => {
  it('the Aura face returns attached to the targeted opponent', () => {
    const s0 = scenario([], { p1: { hand: ['Test Doom'], battlefield: [GNAME] }, defs: [STRANGLER, GRACE, DOOM, BEAR] });
    const s1 = cast(s0, 'Test Doom', { targets: [[obj(find(s0, GNAME, 'battlefield', 'p1'))]] });
    const s = resolveAll(s1, { targets: [[player('p2')]] });
    const aura = find(s, GNAME, 'battlefield', 'p1');
    expect(s.objects[aura]!.face).toBe(1);
    expect(s.objects[aura]!.attachedTo).toBe('p2');
  });
});

// ---- Tenza, Godo's Maul ---------------------------------------------------------------------------------------------------------------------------------------------
const MAUL = card('Test Maul', 'Artifact — Equipment', "Equipped creature gets +1/+1. As long as it's legendary, it gets an additional +2/+2. As long as it's red, it has trample.\nEquip {1}");
const LEGEND = compileCard({ name: 'Test Legend', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Creature — Human', oracle_text: '', colors: ['R'], power: '2', toughness: '2' } as OracleCard);
describe('CR 611.3a, 613.4c, 303.4: "As long as it\'s legendary, it gets an additional +2/+2. As long as it\'s red, it has trample." (Tenza, Godo\'s Maul)', () => {
  it('is automated', () => { expect(noManual(MAUL)).toBe(true); });
  const setup = (creature: string) => {
    const s0 = scenario([], { p1: { battlefield: [creature, 'Test Maul'] }, defs: [MAUL, LEGEND, BEAR] });
    return tweak(s0, (g) => { g.objects[find(g, 'Test Maul', 'battlefield')]!.attachedTo = find(g, creature, 'battlefield'); });
  };
  const stats = (s: GameState, name: string) => { const c = getChars(s, find(s, name, 'battlefield')); return { p: Number(c.power), t: Number(c.toughness), trample: hasKeyword(c, 'trample') }; };
  it('a legendary red creature gets +3/+3 and trample', () => { expect(stats(setup('Test Legend'), 'Test Legend')).toEqual({ p: 5, t: 5, trample: true }); });
  it('negative: a plain colorless creature gets only +1/+1 and no trample', () => { expect(stats(setup('Test Bear'), 'Test Bear')).toEqual({ p: 4, t: 4, trample: false }); });
  it('negative: the Equipment unattached changes nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Legend', 'Test Maul'] }, defs: [MAUL, LEGEND, BEAR] });
    expect(stats(s0, 'Test Legend')).toEqual({ p: 2, t: 2, trample: false });
  });
});

// ---- Goldwardens' Gambit, Reckless Crew ----------------------------------------------------------------------------------------------------------------------------
const GAMBIT = card('Test Gambit', 'Sorcery', 'Create three 2/2 red Rebel creature tokens. For each of those tokens, you may attach an Equipment you control to it.');
const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}');
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {1}');
describe('CR 701.3a, 301.5c, 608.2c: "Create three tokens. For each of those tokens, you may attach an Equipment you control to it." (Goldwardens\' Gambit, Reckless Crew)', () => {
  it('is automated', () => { expect(noManual(GAMBIT)).toBe(true); });
  const setup = () => scenario([], { p1: { hand: ['Test Gambit'], battlefield: ['Test Sword', 'Test Blade'] }, defs: [GAMBIT, SWORD, BLADE] });
  it('each token in turn is offered an Equipment; two Equipment end on two different tokens, the third token stays bare', () => {
    const s0 = setup();
    const sword = find(s0, 'Test Sword', 'battlefield');
    const blade = find(s0, 'Test Blade', 'battlefield');
    let s = cast(s0, 'Test Gambit');
    s = resolveAll(s, { answers: [yes, yes, no], picks: [[sword], [blade]] });
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(3);
    expect(s.objects[sword]!.attachedTo).toBeDefined();
    expect(s.objects[blade]!.attachedTo).toBeDefined();
    expect(s.objects[sword]!.attachedTo).not.toBe(s.objects[blade]!.attachedTo);
    expect(tokens).toContain(s.objects[sword]!.attachedTo);
    expect(tokens.filter((t) => [sword, blade].some((e) => s.objects[e]!.attachedTo === t)).length).toBe(2);
  });
  it('negative: answering no each time attaches nothing', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Gambit'), { answers: [no, no, no] });
    expect(s.objects[find(s, 'Test Sword', 'battlefield')]!.attachedTo).toBeUndefined();
    expect(s.objects[find(s, 'Test Blade', 'battlefield')]!.attachedTo).toBeUndefined();
  });
  it('negative (rulings 2021-02-05, 2023-02-04): an Equipment already attached to one of the new tokens is not offered again, so one Equipment never moves from token to token', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gambit'], battlefield: ['Test Sword'] }, defs: [GAMBIT, SWORD] });
    const sword = find(s0, 'Test Sword', 'battlefield');
    let s = cast(s0, 'Test Gambit');
    s = settle(resolveAll(s, { answers: [yes], picks: [[sword]] }), { answers: [yes, yes, yes], picks: [[sword], [sword]] });
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    const first = s.objects[sword]!.attachedTo;
    expect(tokens).toContain(first);
    // the Sword was chosen and attached once only: the other two tokens' choices had no Equipment to offer
    expect(s.log.filter((l) => /^Test Sword becomes attached/.test(l.text)).length).toBe(1);
    expect(s.log.filter((l) => /^Alice chooses Test Sword/.test(l.text)).length).toBe(1);
  });
});

// ---- Lynde, Cheerful Tormentor ----------------------------------------------------------------------------------------------------------------------------------------
const TORMENTOR = card('Test Tormentor', 'Creature — Human Warlock', 'Whenever a Curse is put into your graveyard from the battlefield, return it to the battlefield attached to you at the beginning of the next end step.\nAt the beginning of your upkeep, you may attach a Curse attached to you to one of your opponents. If you do, draw two cards.', { pt: ['2', '2'] });
const DISPEL = card('Test Dispel', 'Sorcery', 'Destroy target enchantment.');
describe('CR 303.4f, 701.3a, 603.7, 601.7a: "return it to the battlefield attached to you at the beginning of the next end step" / "you may attach a Curse attached to you to one of your opponents. If you do, draw two cards." (Lynde, Cheerful Tormentor)', () => {
  it('is automated', () => { expect(noManual(TORMENTOR)).toBe(true); });
  // the Curse is cast on Alice herself (an Aura on a player must be attached when it enters, or the state-based actions put it away)
  const setup = () => {
    const s0 = scenario([], { p1: { hand: ['Test Dispel', 'Test Curse'], battlefield: ['Test Tormentor'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: [TORMENTOR, DISPEL, CURSE, BEAR] });
    return resolveAll(cast(s0, 'Test Curse', { targets: [[player('p1')]] }));
  };
  it('at Alice\'s upkeep she may move the Curse attached to her to her opponent and draws two cards', () => {
    const s0 = setup();
    const handBefore = zoneNames(s0, 'hand', 'p1').length;
    const s1 = advanceTo(s0, 3, 'upkeep');
    const s = drain(s1, { answers: [yes], picks: [[find(s1, 'Test Curse', 'battlefield')]] });
    expect(s.objects[find(s, 'Test Curse', 'battlefield')]!.attachedTo).toBe('p2');
    expect(zoneNames(s, 'hand', 'p1').length).toBe(handBefore + 3); // two cards from the ability and the draw of Alice's turn 3
  });
  it('negative: answering no leaves the Curse on Alice and draws nothing', () => {
    const s0 = setup();
    const handBefore = zoneNames(s0, 'hand', 'p1').length;
    const s = drain(advanceTo(s0, 3, 'upkeep'), { answers: [no] });
    expect(s.objects[find(s, 'Test Curse', 'battlefield')]!.attachedTo).toBe('p1');
    expect(zoneNames(s, 'hand', 'p1').length).toBe(handBefore + 1);
  });
  it('a Curse put into Alice\'s graveyard from the battlefield returns attached to her at the beginning of the next end step (not at once)', () => {
    const s0 = setup();
    let s = resolveAll(cast(s0, 'Test Dispel', { targets: [[obj(find(s0, 'Test Curse', 'battlefield'))]] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Curse')).toBe(false);
    expect(yard(s)).toContain('Test Curse');
    s = advanceTo(s, 1, 'end');
    s = settle(resolveAll(s), {});
    const curse = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Curse');
    expect(curse).toBeDefined();
    expect(s.objects[curse!]!.attachedTo).toBe('p1');
  });
});
