/**
 * Coordinator D, round edh-d-39 (lane pile-open-phase, second pass): the round's readings and engine changes played through the engine with synthetic cards (invented
 * names and wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-03).
 *
 *   CR 702.26b, 610.3, 608.2c            "Untap all creatures, then those creatures phase out until ~ leaves the battlefield. Put a time counter on ~ for each creature that phased out this way." (Out of Time)
 *   CR 702.26c, 603.2, 603.2c            "Whenever ~ or another Spirit you control phases in, ..." / "Whenever one or more other permanents phase out and whenever one or more other cards are put into exile from anywhere, ..." (King of the Oathbreakers, The War Doctor)
 *   CR 702.26b, 115.1, 603.3a            "Whenever ~ or another Spirit you control becomes the target of a spell, it phases out." (King of the Oathbreakers)
 *   CR 702.26b, 702.26c, 611.2b, 502.1   "Another target nonland permanent phases out. It can't phase in for as long as you control this Saga." (The Phasing of Zhalfir)
 *   CR 702.16b, 119.7, 702.26b, 502.1    "Choose target opponent. Until that player's next turn, they gain protection from everything and their life total can't change. All nonland permanents they control phase out." (Teferi's Reproach)
 *   CR 406.3, 701.40a, 701.40e, 701.24a  "Exile all creature cards from target player's graveyard in a face-down pile, shuffle that pile, then manifest those cards." / "Exile it and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards." (Ghastly Conscription, Jeskai Infiltrator)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });

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
const out = (s: GameState, id: ObjectId): boolean => s.objects[id]!.phasedOut;
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
const faceDown = (s: GameState, owner?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.faceDown && (owner === undefined || s.objects[id]!.controller === owner));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
const SPIRIT = card('Test Spirit', 'Creature — Spirit', '', { pt: ['1', '1'] });
const FOREST = card('Test Forest', 'Land — Forest', '');
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target enchantment.');
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target creature.');

// ---- Out of Time -------------------------------------------------------------------------------------------------------------------------------------------------
const HOURGLASS = card('Test Hourglass', 'Enchantment', 'When this enchantment enters, untap all creatures, then those creatures phase out until this enchantment leaves the battlefield. Put a time counter on this enchantment for each creature that phased out this way.');
describe('CR 702.26b, 610.3, 608.2c: "untap all creatures, then those creatures phase out until ~ leaves the battlefield. Put a time counter on ~ for each creature that phased out this way." (Out of Time)', () => {
  it('is automated', () => { expect(noManual(HOURGLASS)).toBe(true); });
  const setup = () => scenario([], { p1: { hand: ['Test Hourglass', 'Test Shatter'], battlefield: [{ name: 'Test Bear', tapped: true }, 'Test Forest'] }, p2: { battlefield: ['Test Bear', 'Test Spirit'] }, defs: [HOURGLASS, BEAR, SPIRIT, FOREST, SHATTER] });
  it('every creature is untapped and phased out, and ~ gets one time counter for each of them (a land is not counted)', () => {
    const s = resolveAll(cast(setup(), 'Test Hourglass'));
    const creatures = [...findAll(s, 'Test Bear', 'battlefield'), ...findAll(s, 'Test Spirit', 'battlefield')];
    expect(creatures.length).toBe(3);
    for (const id of creatures) { expect(out(s, id), id).toBe(true); expect(s.objects[id]!.tapped, id).toBe(false); }
    expect(out(s, find(s, 'Test Forest', 'battlefield'))).toBe(false);
    expect(counters(s, find(s, 'Test Hourglass', 'battlefield'), 'time')).toBe(3);
  });
  it('they stay phased out through an untap step, and all phase in when ~ leaves the battlefield (CR 610.3d)', () => {
    let s = resolveAll(cast(setup(), 'Test Hourglass'));
    const creatures = [...findAll(s, 'Test Bear', 'battlefield'), ...findAll(s, 'Test Spirit', 'battlefield')];
    const held = advanceTo(s, 3, 'main1'); // Bob's untap step (turn 2) and Alice's (turn 3)
    for (const id of creatures) expect(out(held, id), id).toBe(true);
    s = resolveAll(cast(s, 'Test Shatter', { targets: [[obj(find(s, 'Test Hourglass', 'battlefield'))]] }));
    for (const id of creatures) expect(out(s, id), id).toBe(false);
  });
  it('a creature that was already phased out is not counted again', () => {
    const s0 = tweak(setup(), (x) => { x.objects[findAll(x, 'Test Spirit', 'battlefield')[0]!]!.phasedOut = true; });
    const s = resolveAll(cast(s0, 'Test Hourglass'));
    expect(counters(s, find(s, 'Test Hourglass', 'battlefield'), 'time')).toBe(2);
  });
});

// ---- King of the Oathbreakers ---------------------------------------------------------------------------------------------------------------------------------
const KING = card('Test Oathbreaker', 'Creature — Spirit', 'Whenever this creature or another Spirit you control becomes the target of a spell, it phases out.\nWhenever this creature or another Spirit you control phases in, create a tapped 1/1 white Spirit creature token with flying.', { pt: ['2', '2'] });
describe('CR 702.26b-c, 115.1, 603.2: "Whenever ~ or another Spirit you control becomes the target of a spell, it phases out." / "... phases in, create a tapped 1/1 ..." (King of the Oathbreakers)', () => {
  it('is automated', () => { expect(noManual(KING)).toBe(true); });
  const setup = () => scenario([], { p1: { hand: ['Test Zap', 'Test Zap'], battlefield: ['Test Oathbreaker', 'Test Spirit', 'Test Bear'] }, defs: [KING, SPIRIT, BEAR, ZAP] });
  it('another Spirit you control that a spell targets phases out; the spell then has no legal target', () => {
    const s0 = setup();
    const spirit = find(s0, 'Test Spirit', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Zap', { targets: [[obj(spirit)]] }));
    expect(out(s, spirit)).toBe(true);
    expect(s.objects[spirit]!.damage).toBe(0); // the spell found no legal target (CR 608.2b): a phased-out permanent is treated as though it does not exist
    expect(out(s, find(s, 'Test Oathbreaker', 'battlefield'))).toBe(false);
  });
  it('it phases in during its controller\'s next untap step and every Spirit that phases in makes a tapped 1/1 flying Spirit token', () => {
    const s0 = setup();
    const spirit = find(s0, 'Test Spirit', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Zap', { targets: [[obj(spirit)]] }));
    const before = s.zones.battlefield.length;
    s = settle(advanceTo(s, 3, 'upkeep'));
    s = resolveAll(s);
    expect(out(s, spirit)).toBe(false);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    expect(s.objects[tokens[0]!]!.tapped).toBe(true);
    expect(s.zones.battlefield.length).toBe(before + 1);
  });
  it('a creature that is no Spirit is not phased out by the same trigger', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Zap', { targets: [[obj(bear)]] }));
    expect(out(s, bear)).toBe(false);
    expect(s.objects[bear]!.damage).toBe(1);
  });
  it('~ itself that a spell targets phases out too', () => {
    const s0 = setup();
    const king = find(s0, 'Test Oathbreaker', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Zap', { targets: [[obj(king)]] }));
    expect(out(s, king)).toBe(true);
  });
});

// ---- The War Doctor -------------------------------------------------------------------------------------------------------------------------------------------
const DOCTOR = card('Test Chronicler', 'Creature — Time Lord', 'Whenever one or more other permanents phase out and whenever one or more other cards are put into exile from anywhere, put a time counter on this creature.', { pt: ['1', '1'] });
const VEIL = card('Test Veil', 'Sorcery', 'Creatures your opponents control phase out.');
const VEIL_MINE = card('Test Veil Mine', 'Sorcery', 'Creatures you control phase out.');
const VEIL_ONE = card('Test Veil One', 'Sorcery', 'Target creature phases out.');
const EXILER = card('Test Exiler', 'Sorcery', 'Exile target card from a graveyard.');
describe('CR 702.26b, 603.2c, 603.2: "Whenever one or more other permanents phase out and whenever one or more other cards are put into exile from anywhere, put a time counter on ~." (The War Doctor)', () => {
  it('is automated', () => { expect(noManual(DOCTOR)).toBe(true); });
  const setup = () => scenario([], { p1: { hand: ['Test Veil', 'Test Veil One', 'Test Veil Mine', 'Test Exiler'], battlefield: ['Test Chronicler', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Spirit'], graveyard: ['Test Bear'] }, defs: [DOCTOR, BEAR, SPIRIT, VEIL, VEIL_MINE, VEIL_ONE, EXILER] });
  it('permanents that phase out together put ONE counter (one or more); each trigger counts once', () => {
    const s0 = setup();
    const doc = find(s0, 'Test Chronicler', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Veil'));
    expect(counters(s, doc, 'time')).toBe(1);
  });
  it('~ itself phasing out is not "another permanent", and the other permanent that phases out in a later effect counts', () => {
    const s0 = setup();
    const doc = find(s0, 'Test Chronicler', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Veil One', { targets: [[obj(doc)]] }));
    expect(out(s, doc)).toBe(true);
    expect(counters(s, doc, 'time')).toBe(0);
    s = resolveAll(cast(setup(), 'Test Veil One', { targets: [[obj(findAll(s0, 'Test Bear', 'battlefield', 'p1')[0]!)]] }));
    expect(counters(s, doc, 'time')).toBe(1);
  });
  it('~ phasing out at the same time as other permanents does not trigger (ruling 2023-10-13: a phased-out permanent\'s triggered abilities can\'t trigger)', () => {
    const s0 = setup();
    const doc = find(s0, 'Test Chronicler', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Veil Mine'));
    expect(out(s, doc)).toBe(true);
    expect(counters(s, doc, 'time')).toBe(0);
  });
  it('a card put into exile from a graveyard adds a counter too', () => {
    const s0 = setup();
    const doc = find(s0, 'Test Chronicler', 'battlefield');
    const s = resolveAll(cast(s0, 'Test Exiler', { targets: [[obj(find(s0, 'Test Bear', 'graveyard', 'p2'))]] }));
    expect(counters(s, doc, 'time')).toBe(1);
  });
});

// ---- The Phasing of Zhalfir ----------------------------------------------------------------------------------------------------------------------------------
const ZHALFIR = card('Test Phaser', 'Enchantment', 'When this enchantment enters, another target nonland permanent phases out. It can\'t phase in for as long as you control this enchantment.');
const PLAIN_PHASER = card('Test Plain Phaser', 'Enchantment', 'When this enchantment enters, another target nonland permanent phases out.');
describe('CR 702.26b-c, 611.2b, 502.1: "Another target nonland permanent phases out. It can\'t phase in for as long as you control this Saga." (The Phasing of Zhalfir)', () => {
  it('is automated', () => { expect(noManual(ZHALFIR)).toBe(true); expect(noManual(PLAIN_PHASER)).toBe(true); });
  const setup = (name: string) => scenario([], { p1: { hand: [name, 'Test Shatter'] }, p2: { battlefield: ['Test Bear'] }, defs: [ZHALFIR, PLAIN_PHASER, BEAR, SHATTER] });
  it('the permanent does not phase in during its controller\'s untap step while you control the enchantment, and phases in at the next one after you stop controlling it', () => {
    let s = setup('Test Phaser');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Phaser'), { targets: [[obj(bear)]] });
    expect(out(s, bear)).toBe(true);
    s = advanceTo(s, 2, 'main1'); // Bob's untap step
    expect(out(s, bear)).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(out(s, bear)).toBe(true);
    s = resolveAll(cast(s, 'Test Shatter', { targets: [[obj(find(s, 'Test Phaser', 'battlefield'))]] }));
    expect(out(s, bear)).toBe(true); // it does not phase in at once: only its controller's untap step phases it in (CR 502.1)
    s = advanceTo(s, 4, 'main1');
    expect(out(s, bear)).toBe(false);
  });
  it('without the second sentence it phases in at Bob\'s next untap step', () => {
    let s = setup('Test Plain Phaser');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Plain Phaser'), { targets: [[obj(bear)]] });
    expect(out(s, bear)).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(out(s, bear)).toBe(false);
  });
});

// ---- Teferi's Reproach -----------------------------------------------------------------------------------------------------------------------------------------
const REPROACH = card('Test Reproach', 'Sorcery', 'Choose target opponent. Until that player\'s next turn, they gain protection from everything and their life total can\'t change. All nonland permanents they control phase out. Exile this spell.');
const DRAIN = card('Test Drain', 'Sorcery', 'Each opponent loses 2 life.');
describe('CR 702.16b, 119.7, 702.26b, 502.1: "Until that player\'s next turn, they gain protection from everything and their life total can\'t change. All nonland permanents they control phase out." (Teferi\'s Reproach)', () => {
  it('is automated', () => { expect(noManual(REPROACH)).toBe(true); });
  const setup = () => scenario([], { p1: { hand: ['Test Reproach', 'Test Drain'] }, p2: { battlefield: ['Test Bear', 'Test Forest'] }, defs: [REPROACH, DRAIN, BEAR, FOREST] });
  it('their nonland permanents phase out (a land does not), their life total can\'t change, and the spell is exiled', () => {
    let s = resolveAll(cast(setup(), 'Test Reproach', { targets: [[player('p2')]] }));
    expect(out(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe(true);
    expect(out(s, find(s, 'Test Forest', 'battlefield', 'p2'))).toBe(false);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Reproach')).toBe(true);
    s = resolveAll(cast(s, 'Test Drain'));
    expect(life(s, 'p2')).toBe(20);
  });
  it('without it their life total changes (the negative case) and their permanents phase in during their untap step', () => {
    const s0 = setup();
    expect(life(resolveAll(cast(s0, 'Test Drain')), 'p2')).toBe(18);
    let s = resolveAll(cast(s0, 'Test Reproach', { targets: [[player('p2')]] }));
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = advanceTo(s, 2, 'main1');
    expect(out(s, bear)).toBe(false);
  });
});

// ---- Ghastly Conscription and Jeskai Infiltrator -----------------------------------------------------------------------------------------------------------------
const GRAVE_PILE = card('Test Grave Pile', 'Sorcery', 'Exile all creature cards from target player\'s graveyard in a face-down pile, shuffle that pile, then manifest those cards.');
const MERGE = card('Test Merge', 'Instant', 'Exile target creature you control and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards.');
const INFILTRATOR = card('Test Infiltrator', 'Creature — Human Rogue', 'When this creature deals combat damage to a player, exile it and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards.', { pt: ['2', '2'] });
describe('CR 406.3, 701.40a, 701.40e, 701.24a: "Exile all creature cards from target player\'s graveyard in a face-down pile, shuffle that pile, then manifest those cards." (Ghastly Conscription)', () => {
  it('is automated', () => { expect(noManual(GRAVE_PILE)).toBe(true); expect(noManual(MERGE)).toBe(true); expect(noManual(INFILTRATOR)).toBe(true); });
  it('every creature card of the targeted graveyard comes back face down under Alice\'s control, a non-creature card stays', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grave Pile'] }, p2: { graveyard: ['Test Bear', 'Test Spirit', 'Test Forest'] }, defs: [GRAVE_PILE, BEAR, SPIRIT, FOREST] });
    const s = resolveAll(cast(s0, 'Test Grave Pile', { targets: [[player('p2')]] }));
    const down = faceDown(s, 'p1');
    expect(down.length).toBe(2);
    expect(faceDown(s, 'p2').length).toBe(0);
    for (const id of down) { expect(s.objects[id]!.owner).toBe('p2'); }
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Test Forest']);
  });
  it('an empty graveyard manifests nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grave Pile'] }, p2: { graveyard: ['Test Forest'] }, defs: [GRAVE_PILE, FOREST] });
    const s = resolveAll(cast(s0, 'Test Grave Pile', { targets: [[player('p2')]] }));
    expect(faceDown(s).length).toBe(0);
  });
});
describe('CR 406.3, 701.40a, 701.24a: "exile it and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards." (Jeskai Infiltrator)', () => {
  it('the creature and your top card both come back face down under your control, in a random order', () => {
    const s0 = scenario([], { p1: { hand: ['Test Merge'], battlefield: ['Test Bear'], library: ['Test Spirit', 'Test Forest'] }, defs: [MERGE, BEAR, SPIRIT, FOREST] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const bearCard = s0.objects[bear]!.cardId;
    const s = resolveAll(cast(s0, 'Test Merge', { targets: [[obj(bear)]] }));
    const down = faceDown(s, 'p1');
    expect(down.length).toBe(2);
    expect(down.map((id) => s.objects[id]!.cardId).includes(bearCard)).toBe(true);
    expect(s.objects[s.zones.library.p1![0]!]!.defId).toBe('Test Forest'); // the top card (Test Spirit) left the library, the next one is on top now
  });
});

// ---- the permanent's own phasing (Teferi's Imp, Warping Wurm, Shimmering Efreet: read full by the same events) -------------------------------------------------------
const IMP = card('Test Imp', 'Creature — Imp', 'Flying\nPhasing\nWhenever this creature phases out, you gain 1 life.\nWhenever this creature phases in, you draw a card.', { pt: ['1', '1'] });
describe('CR 603.10b, 702.26a-c, 702.26d: "Whenever this creature phases out / in" (Teferi\'s Imp)', () => {
  it('is automated', () => { expect(noManual(IMP)).toBe(true); });
  it('its own phasing out looks back and triggers (CR 603.10b), its own phasing in triggers; no zone change is involved', () => {
    let s = scenario([], { p1: { battlefield: ['Test Imp'] }, defs: [IMP] });
    const imp = find(s, 'Test Imp', 'battlefield');
    const hand0 = s.zones.hand.p1!.length;
    s = advanceTo(s, 3, 'main1'); // Alice's untap step of turn 3: it phases out
    expect(out(s, imp)).toBe(true);
    expect(life(s, 'p1')).toBe(21);
    expect(s.zones.hand.p1!.length - hand0).toBe(1); // (the draw step only)
    s = advanceTo(s, 5, 'main1'); // and phases in again two turns later
    expect(out(s, imp)).toBe(false);
    expect(life(s, 'p1')).toBe(21);
    expect(s.zones.hand.p1!.length - hand0).toBe(3); // two draw steps and the phases-in trigger
  });
});

// ---- a described permanent phases out (the event's object is judged as it was, CR 603.10b) ---------------------------------------------------------------------------
const WATCHER = card('Test Watcher', 'Creature — Wizard', 'Whenever another Spirit you control phases out, you gain 1 life.', { pt: ['1', '1'] });
describe('CR 603.2, 702.26b: "Whenever another Spirit you control phases out, ..." judges the permanent that phased out by its description', () => {
  it('is automated', () => { expect(noManual(WATCHER)).toBe(true); });
  it('a Spirit you control that phases out triggers it; a creature of another kind does not', () => {
    const mk = () => scenario([], { p1: { hand: ['Test Veil One'], battlefield: ['Test Watcher', 'Test Spirit', 'Test Bear'] }, defs: [WATCHER, SPIRIT, BEAR, VEIL_ONE] });
    const s0 = mk();
    const spirit = resolveAll(cast(s0, 'Test Veil One', { targets: [[obj(find(s0, 'Test Spirit', 'battlefield'))]] }));
    expect(life(spirit, 'p1')).toBe(21);
    const bear = resolveAll(cast(s0, 'Test Veil One', { targets: [[obj(find(s0, 'Test Bear', 'battlefield'))]] }));
    expect(life(bear, 'p1')).toBe(20);
  });
});
