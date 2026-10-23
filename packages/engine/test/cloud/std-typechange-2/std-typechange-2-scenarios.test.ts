/**
 * std-typechange-2 (lane std-typechange): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 205.1b, 306.8,   "During your turn, as long as ~ has one or more loyalty counters on it, ~ is a 3/4 Ninja creature and has hexproof": during its controller's
 *   120.3c, 611.3a      turn the planeswalker is also a creature (it keeps its planeswalker type, DECIDED BY DEFAULT, owner instruction 2026-10-21); on another turn it
 *                       is not; damage dealt to it removes loyalty counters
 *   CR 608.2c, 508.4    "... you may put a creature card from your hand onto the battlefield. If that card is an enchantment card, it enters tapped and attacking":
 *                       only the card that matches enters tapped and attacking
 *   CR 708.7, 701.58g,  "Turn this creature face up. If you can't, exile it, then you may cast the exiled card without paying its mana cost": a cloaked creature card
 *   608.2c, 400.7       is turned face up; a cloaked instant card can't be, so it is exiled and may be cast
 *   CR 603.2d, 603.10a, "If a creature dying causes a triggered ability of this creature or an emblem you own to trigger, that ability triggers an additional time":
 *   114.4               the creature's own dies-triggers (also when it dies itself: looking back) and the emblem's, not another creature's
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, put, runCombat, scenario, tweak } from '../../m5/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const activate = (s: GameState, source: ObjectId, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState => {
  const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === source);
  if (!a) throw new Error('no activation');
  return settle(act(s, a.action), answers, targets);
};

describe('CR 205.1b, 306.8, 611.3a: "During your turn, as long as ~ has one or more loyalty counters on it, ~ is a 3/4 Ninja creature and has hexproof"', () => {
  const SHADE = card('Test Night Shade', 'Legendary Planeswalker — Testwalker', 'During your turn, as long as this planeswalker has one or more loyalty counters on it, this planeswalker is a 3/4 Ninja creature and has hexproof.\n+1: You gain 1 life.', { loyalty: '3' });
  const DOLL = card('Test Dueling Doll', 'Instant', 'Test Dueling Doll deals 2 damage to each creature.');
  it('is automated', () => expect(full(SHADE)).toBe(true));
  it('on its controller\'s turn it is a 3/4 Ninja creature with hexproof AND still a planeswalker with its loyalty ability; on the opponent\'s turn it is not a creature', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Night Shade', counters: { loyalty: 3 } }] }, defs: [SHADE, DOLL] });
    const id = find(s, 'Test Night Shade', 'battlefield', 'p1');
    let c = getChars(s, id)!;
    expect([...c.types].sort()).toEqual(['Creature', 'Planeswalker']);
    expect([...c.subtypes].sort()).toEqual(['Ninja', 'Testwalker']);
    expect(`${c.power}/${c.toughness}`).toBe('3/4');
    expect(hasKeyword(c, 'hexproof')).toBe(true);
    s = activate(s, id);
    expect(s.objects[id]!.counters['loyalty']).toBe(4);
    s = advanceTo(s, 2, 'main1');
    c = getChars(s, id)!;
    expect(c.types).toEqual(['Planeswalker']);
    expect(hasKeyword(c, 'hexproof')).toBe(false);
  });
  it('CR 120.3c: damage dealt to it while it is a creature removes loyalty counters ("each creature": no target, so hexproof does not matter)', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Night Shade', counters: { loyalty: 3 } }], hand: ['Test Dueling Doll'] }, defs: [SHADE, DOLL] });
    const id = find(s, 'Test Night Shade', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dueling Doll', 'hand', 'p1') }));
    expect(s.objects[id]!.zone).toBe('battlefield');
    expect(s.objects[id]!.counters['loyalty']).toBe(1);
  });
  it('with no loyalty counters on it, it is not a creature', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Night Shade', counters: { loyalty: 3 } }] }, defs: [SHADE, DOLL] });
    const id = find(s0, 'Test Night Shade', 'battlefield', 'p1');
    const s = tweak(s0, (x) => { x.objects[id]!.counters['loyalty'] = 0; });
    expect(getChars(s, id)!.types).not.toContain('Creature');
  });
});

describe('CR 608.2c, 508.4: "If that card is an enchantment card, it enters tapped and attacking"', () => {
  const HORN = card('Test Calling Horn', 'Creature — Human', 'Whenever this creature attacks, you may put a creature card from your hand onto the battlefield. If that card is an enchantment card, it enters tapped and attacking.', { pt: ['2', '2'] });
  const SPIRIT = card('Test Glade Spirit', 'Enchantment Creature — Spirit', '', { pt: ['3', '3'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const attackWith = (hand: string): { s: GameState; put: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Calling Horn'], hand: [hand] }, defs: [HORN, SPIRIT, BEAR] });
    const horn = find(s0, 'Test Calling Horn', 'battlefield', 'p1');
    const inHand = find(s0, hand, 'hand', 'p1');
    let s = runCombat(s0, { attack: [[horn]], until: 'declareAttackers' } as never);
    s = settle(s, [{ kind: 'chooseObjects', ids: [inHand] } as DecisionAnswer]);
    return { s, put: find(s, hand, 'battlefield', 'p1') };
  };
  it('is automated', () => expect(full(HORN)).toBe(true));
  it('an enchantment creature card put this way enters tapped and attacking', () => {
    const { s, put: id } = attackWith('Test Glade Spirit');
    expect(s.objects[id]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === id)).toBe(true);
  });
  it('a creature card that is not an enchantment card enters untapped and is not attacking', () => {
    const { s, put: id } = attackWith('Test Bear');
    expect(s.objects[id]!.tapped).toBe(false);
    expect(s.combat?.attackers.some((a) => a.id === id)).toBe(false);
  });
});

describe('CR 708.7, 701.58g, 608.2c: "Turn this creature face up. If you can\'t, exile it, then you may cast the exiled card without paying its mana cost."', () => {
  const ROGUE = card('Test Veiled Rogue', 'Creature — Human Rogue', 'Face-down creatures you control have "{0}: Turn this creature face up. If you can\'t, exile it, then you may cast the exiled card without paying its mana cost."', { pt: ['1', '1'] });
  const GIFT = card('Test Little Gift', 'Instant', 'You gain 4 life.', { cost: '{5}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const faceDown = (s0: GameState, name: string): [GameState, ObjectId] => {
    let id = '';
    const s = tweak(s0, (x) => { id = put(x, 'p1', 'battlefield', name); Object.assign(x.objects[id]!, { faceDown: true, faceDownInfo: { by: 'cloak', profile: 'ward2' } }); });
    return [s, id];
  };
  it('is automated', () => expect(full(ROGUE)).toBe(true));
  it('a cloaked creature card is turned face up and stays on the battlefield', () => {
    const [s0, id] = faceDown(scenario([], { p1: { battlefield: ['Test Veiled Rogue'] }, defs: [ROGUE, GIFT, BEAR] }), 'Test Bear');
    const s = activate(s0, id);
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.objects[id]!.zone).toBe('battlefield');
  });
  it('a cloaked instant card can\'t be turned face up: it is exiled and cast without paying its mana cost', () => {
    const [s0, id] = faceDown(scenario([], { p1: { battlefield: ['Test Veiled Rogue'] }, defs: [ROGUE, GIFT, BEAR] }), 'Test Little Gift');
    const before = life(s0, 'p1');
    const s = activate(s0, id);
    expect(s.zones.battlefield).not.toContain(id);
    expect(life(s, 'p1')).toBe(before + 4);
    expect(find(s, 'Test Little Gift', 'graveyard', 'p1')).toBeDefined();
  });
});

describe('CR 603.2d, 603.10a, 114.4: "If a creature dying causes a triggered ability of this creature or an emblem you own to trigger, that ability triggers an additional time"', () => {
  const BLADE = card('Test Mourning Blade', 'Artifact — Equipment', 'Equipped creature has "If a creature dying causes a triggered ability of this creature or an emblem you own to trigger, that ability triggers an additional time."\nEquip {0}');
  const WATCHER = card('Test Grave Watcher', 'Creature — Spirit', 'Whenever another creature dies, you gain 1 life.', { pt: ['1', '1'] });
  const MARTYR = card('Test Willing Martyr', 'Creature — Human', 'When this creature dies, you gain 3 life.', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SIGIL = card('Test Sigil Stone', 'Artifact', '{0}: You get an emblem with "Whenever a creature dies, you gain 5 life."');
  const DOOM = card('Test Quiet End', 'Instant', 'Destroy target creature.');
  const DEFS = [BLADE, WATCHER, MARTYR, BEAR, SIGIL, DOOM];
  const equip = (s0: GameState, creature: ObjectId): GameState => tweak(s0, (x) => { x.objects[find(x, 'Test Mourning Blade', 'battlefield', 'p1')]!.attachedTo = creature; });
  const kill = (s0: GameState, id: ObjectId): GameState => {
    const s1 = tweak(s0, (x) => { put(x, 'p1', 'hand', 'Test Quiet End'); });
    return settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Quiet End', 'hand', 'p1') }), [], [id]);
  };
  it('is automated', () => expect(full(BLADE)).toBe(true));
  it('the equipped creature\'s "whenever another creature dies" triggers twice; the same ability of an unequipped creature once', () => {
    let s = scenario([], { p1: { battlefield: ['Test Mourning Blade', 'Test Grave Watcher', 'Test Grave Watcher', 'Test Bear'] }, defs: DEFS });
    const [w1] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Grave Watcher');
    s = equip(s, w1!);
    const before = life(s, 'p1');
    s = kill(s, find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(life(s, 'p1')).toBe(before + 3); // 2 (equipped) + 1 (unequipped)
  });
  it('CR 603.10a: the equipped creature dying itself: its own "when this creature dies" triggers twice', () => {
    let s = scenario([], { p1: { battlefield: ['Test Mourning Blade', 'Test Willing Martyr'] }, defs: DEFS });
    const martyr = find(s, 'Test Willing Martyr', 'battlefield', 'p1');
    s = equip(s, martyr);
    const before = life(s, 'p1');
    s = kill(s, martyr);
    expect(life(s, 'p1')).toBe(before + 6);
  });
  it('CR 114.4: an emblem you own triggers twice while a creature has the ability, once without', () => {
    let s = scenario([], { p1: { battlefield: ['Test Mourning Blade', 'Test Sigil Stone', 'Test Bear', 'Test Bear'] }, defs: DEFS });
    s = activate(s, find(s, 'Test Sigil Stone', 'battlefield', 'p1'));
    const [b1, b2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
    let before = life(s, 'p1');
    s = kill(s, b1!);
    expect(life(s, 'p1')).toBe(before + 5); // no creature has the ability
    s = settle(tweak(s, () => undefined));
    const watcher = put(s, 'p1', 'battlefield', 'Test Grave Watcher');
    s = equip(s, watcher);
    before = life(s, 'p1');
    s = kill(s, b2!);
    expect(life(s, 'p1')).toBe(before + 12); // the emblem twice (10) and the equipped creature's own ability twice (2)
  });
});
