/**
 * Coordinator A, round edh-next-76 (lane transform): the round's readings and engine changes played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites: from memory (this session had no rules/cr folder), listed as unverified in the record.
 *
 *   CR 702.161 (living metal)      "Living metal": during your turn, this Vehicle is also a creature.
 *   CR 701.28 (convert)            "Convert ~": a Transformers double-faced card turns over like a transform; a card with no back face does not.
 *   CR 701.27e, 603.2              "Whenever a permanent you control transforms into a Phyrexian."
 *   CR 701.20a, 701.20e, 608.2c    "Look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform ~."
 *   CR 508.1, 603.2c               "Whenever ~ and at least one Human attack, ..."
 *   CR 603.7, 511.1, 712.14a       "When ~ attacks, exile it at end of combat, then return it to the battlefield transformed under your control."
 *   CR 208.1                       "... three or more creatures that each have toughness greater than their power, transform ~."
 *   CR 701.3d, 608.2c              "Unattach ~, then transform it."
 *   CR 113.6m, 712.14a             "{2}: Put ~ from your graveyard onto the battlefield transformed."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
type Face = { name: string; type: string; text: string; pt?: [string, string]; cost?: string };
/** A transforming double-faced card from two invented faces, compiled from text. */
function dfc(front: Face, back: Face): CardDef {
  const face = (f: Face) => ({ name: f.name, mana_cost: f.cost ?? '', type_line: f.type, oracle_text: f.text, colors: [], ...(f.pt ? { power: f.pt[0], toughness: f.pt[1] } : {}) });
  return compileCard({ name: `${front.name} // ${back.name}`, layout: 'transform', mana_cost: front.cost ?? '', type_line: `${front.type} // ${back.type}`, oracle_text: '', colors: [], keywords: [], card_faces: [face(front), face(back)] } as unknown as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

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
/** Both players pass until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, opts);
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
const onField = (s: GameState, name: string, owner: PlayerId = 'p1'): ObjectId => find(s, name, 'battlefield', owner);
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const isCreature = (s: GameState, id: ObjectId): boolean => getChars(s, id).types.includes('Creature');
const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

// ---- Living metal ----------------------------------------------------------------------------------------------------------------------------------------------------
const ROVER = card('Test Rover', 'Artifact — Vehicle', 'Living metal', { pt: ['3', '3'] });
describe('CR 702.161: Living metal (a Vehicle is also a creature during its controller\'s turn)', () => {
  it('is automated', () => { expect(noManual(ROVER)).toBe(true); });
  it('is a creature on its controller\'s turn and not on an opponent\'s turn; a Vehicle without it is never a creature', () => {
    const PLAIN = card('Test Plain Cart', 'Artifact — Vehicle', 'Crew 1', { pt: ['3', '3'] });
    const s = scenario([], { p1: { battlefield: ['Test Rover', 'Test Plain Cart'] }, defs: [ROVER, PLAIN] });
    expect(isCreature(s, onField(s, 'Test Rover'))).toBe(true);
    expect(isCreature(s, onField(s, 'Test Plain Cart'))).toBe(false);
    const t = tweak(s, (x) => { x.turn.activePlayer = 'p2'; });
    expect(isCreature(t, onField(t, 'Test Rover'))).toBe(false);
  });
});

// ---- Convert ---------------------------------------------------------------------------------------------------------------------------------------------------------
const ROBOT = dfc(
  { name: 'Test Robot', type: 'Artifact Creature — Robot', text: '{0}: Convert Test Robot.', pt: ['2', '2'] },
  { name: 'Test Truck', type: 'Legendary Artifact — Vehicle', text: 'Living metal\n{0}: Convert Test Truck.', pt: ['4', '4'] },
);
describe('CR 701.28: "Convert ~" turns a double-faced card over; a card with no other face does not', () => {
  it('is automated', () => { expect(noManual(ROBOT)).toBe(true); });
  it('{0}: Convert turns Test Robot into Test Truck and back again', () => {
    let s = scenario([], { p1: { battlefield: ['Test Robot // Test Truck'] }, defs: [ROBOT] });
    const id = onField(s, 'Test Robot // Test Truck');
    expect(nameOf(s, id)).toBe('Test Robot');
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' })));
    expect(nameOf(s, id)).toBe('Test Truck');
    expect(isCreature(s, id)).toBe(true); // living metal, Alice's turn
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:1:1' })));
    expect(nameOf(s, id)).toBe('Test Robot');
  });
  it('negative: a permanent that is not double-faced does not convert', () => {
    const PLAINBOT = card('Test Plain Bot', 'Artifact Creature — Robot', '{0}: Convert Test Plain Bot.', { pt: ['2', '2'] });
    let s = scenario([], { p1: { battlefield: ['Test Plain Bot'] }, defs: [PLAINBOT] });
    const id = onField(s, 'Test Plain Bot');
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' })));
    expect(nameOf(s, id)).toBe('Test Plain Bot');
    expect(s.objects[id]!.face).toBe(0);
  });
});

// ---- "Whenever a permanent you control transforms into a Phyrexian" -------------------------------------------------------------------------------------------------------
const OBSERVER = card('Test Observer', 'Creature — Human', 'Whenever a permanent you control transforms into a Phyrexian, put a +1/+1 counter on it.', { pt: ['1', '1'] });
const GRUB = dfc({ name: 'Test Grub', type: 'Creature — Insect', text: '{0}: Transform Test Grub.', pt: ['1', '1'] }, { name: 'Test Horror', type: 'Creature — Phyrexian Horror', text: '', pt: ['3', '3'] });
const WORM = dfc({ name: 'Test Worm', type: 'Creature — Insect', text: '{0}: Transform Test Worm.', pt: ['1', '1'] }, { name: 'Test Moth', type: 'Creature — Moth', text: '', pt: ['3', '3'] });
describe('CR 701.27e, 603.2: "Whenever a permanent you control transforms into a Phyrexian, put a +1/+1 counter on it."', () => {
  it('is automated', () => { expect(noManual(OBSERVER)).toBe(true); expect(noManual(GRUB)).toBe(true); });
  const setup = () => scenario([], { p1: { battlefield: ['Test Observer', 'Test Grub // Test Horror', 'Test Worm // Test Moth'] }, defs: [OBSERVER, GRUB, WORM] });
  it('the permanent that transformed into a Phyrexian gets the counter; the observer itself does not', () => {
    const s0 = setup();
    const grub = onField(s0, 'Test Grub // Test Horror');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: grub, ability: 'p:0:0' })));
    expect(nameOf(s, grub)).toBe('Test Horror');
    expect(counters(s, grub)).toBe(1);
    expect(counters(s, onField(s, 'Test Observer'))).toBe(0);
  });
  it('negative: a permanent that transforms into a non-Phyrexian gets no counter', () => {
    const s0 = setup();
    const worm = onField(s0, 'Test Worm // Test Moth');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: worm, ability: 'p:0:0' })));
    expect(nameOf(s, worm)).toBe('Test Moth');
    expect(counters(s, worm)).toBe(0);
  });
});

// ---- look, may reveal, "revealed this way" ----------------------------------------------------------------------------------------------------------------------------------
const SPY = dfc(
  { name: 'Test Peeker', type: 'Creature — Human Wizard', text: '{0}: Look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.', pt: ['1', '1'] },
  { name: 'Test Flier', type: 'Creature — Human Horror', text: 'Flying', pt: ['3', '2'] },
);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.');
describe('CR 701.20a, 701.20e, 608.2c: "You may reveal that card. If an instant or sorcery card is revealed this way, transform ~."', () => {
  it('is automated', () => { expect(noManual(SPY)).toBe(true); });
  const setup = (top: string) => scenario([], { p1: { battlefield: ['Test Peeker // Test Flier'], library: [top, 'Plains', 'Plains'] }, defs: [SPY, BOLT] });
  const run = (top: string, a: DecisionAnswer): { s: GameState; id: ObjectId } => {
    const s0 = setup(top);
    const id = onField(s0, 'Test Peeker // Test Flier');
    return { s: resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }), { answers: [a] }), { answers: [a] }), id };
  };
  it('revealing an instant card transforms it', () => { const { s, id } = run('Test Bolt', yes); expect(nameOf(s, id)).toBe('Test Flier'); });
  it('negative: revealing a land card does not', () => { const { s, id } = run('Plains', yes); expect(nameOf(s, id)).toBe('Test Peeker'); });
  it('negative: declining to reveal an instant card does not (nothing was revealed this way)', () => { const { s, id } = run('Test Bolt', no); expect(nameOf(s, id)).toBe('Test Peeker'); });
});

// ---- "Whenever ~ and at least one Human attack" ---------------------------------------------------------------------------------------------------------------------------
const SCOUT = card('Test Scout', 'Creature — Robot', 'Whenever this creature and at least one Human attack, you gain 2 life.', { pt: ['2', '2'] });
const CLERK = card('Test Clerk', 'Creature — Human', '', { pt: ['1', '1'] });
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
describe('CR 508.1, 603.2c: "Whenever ~ and at least one Human attack, ..." (the same declaration)', () => {
  it('is automated', () => { expect(noManual(SCOUT)).toBe(true); });
  const attackWith = (...others: string[]) => {
    const s0 = scenario([], { p1: { battlefield: ['Test Scout', ...others] }, defs: [SCOUT, CLERK, GOBLIN] });
    let s = declareAttackers(toDeclareAttackers(s0), [onField(s0, 'Test Scout'), ...others.map((n) => onField(s0, n))].map((id) => [id] as [ObjectId]));
    s = resolveAll(settle(s));
    return s.players.find((p) => p.id === 'p1')!.life;
  };
  it('gains 2 life when the scout attacks together with a Human', () => { expect(attackWith('Test Clerk')).toBe(22); });
  it('negative: no life when it attacks with a non-Human, or alone', () => { expect(attackWith('Test Goblin')).toBe(20); expect(attackWith()).toBe(20); });
});

// ---- exile at end of combat, then return it transformed ---------------------------------------------------------------------------------------------------------------------
const GALLEY = dfc(
  { name: 'Test Galley', type: 'Artifact Creature — Vehicle', text: 'When this creature attacks, exile it at end of combat, then return it to the battlefield transformed under your control.', pt: ['3', '3'] },
  { name: 'Test Foothold', type: 'Land', text: '{T}: Add {C}.' },
);
describe('CR 603.7, 511.1, 712.14a: "exile it at end of combat, then return it to the battlefield transformed under your control"', () => {
  it('is automated', () => { expect(noManual(GALLEY)).toBe(true); });
  it('after combat the card is back on the battlefield, back face up, under Alice\'s control', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Galley // Test Foothold'] }, defs: [GALLEY] });
    const g = onField(s0, 'Test Galley // Test Foothold');
    let s = declareAttackers(toDeclareAttackers(s0), [[g]]);
    s = resolveAll(settle(s));
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'the end of combat', 80);
    s = passUntil(s, (x) => x.turn.step === 'main2', 'main 2', 80);
    const back = s.zones.battlefield.find((id) => s.objects[id]!.defId === GALLEY.id);
    expect(back).toBeDefined();
    expect(s.objects[back!]!.face).toBe(1);
    expect(s.objects[back!]!.controller).toBe('p1');
  });
  it('negative: during combat (before the end of combat) it is still the front face on the battlefield', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Galley // Test Foothold'] }, defs: [GALLEY] });
    const g = onField(s0, 'Test Galley // Test Foothold');
    const s = resolveAll(settle(declareAttackers(toDeclareAttackers(s0), [[g]])));
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === GALLEY.id)!;
    expect(s.objects[id]!.face).toBe(0);
  });
});

// ---- "three or more creatures that each have toughness greater than their power" ----------------------------------------------------------------------------------------------
const FODDER = dfc(
  { name: 'Test Fodder', type: 'Creature — Goblin', text: 'At the beginning of combat on your turn, if you control three or more creatures that each have toughness greater than their power, transform this creature.', pt: ['1', '3'] },
  { name: 'Test Captain', type: 'Creature — Goblin Warrior', text: '', pt: ['4', '4'] },
);
const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '4'] });
const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['3', '1'] });
describe('CR 208.1, 603.4: "if you control three or more creatures that each have toughness greater than their power, transform ~"', () => {
  it('is automated', () => { expect(noManual(FODDER)).toBe(true); });
  const toCombat = (...others: string[]) => {
    const s0 = scenario([], { p1: { battlefield: ['Test Fodder // Test Captain', ...others] }, defs: [FODDER, WALL, WOLF] });
    const id = onField(s0, 'Test Fodder // Test Captain');
    const s = resolveAll(passUntil(s0, (x) => x.turn.step === 'beginCombat' && (x.zones.stack.length > 0 || x.pending?.kind === 'priority'), 'beginning of combat', 30));
    return nameOf(s, id);
  };
  it('transforms with three such creatures (itself and two walls)', () => { expect(toCombat('Test Wall', 'Test Wall')).toBe('Test Captain'); });
  it('negative: not with only two such creatures (a creature with power 3 and toughness 1 does not count)', () => { expect(toCombat('Test Wall', 'Test Wolf')).toBe('Test Fodder'); });
});

// ---- unattach, then transform it ----------------------------------------------------------------------------------------------------------------------------------------------
const BLADE = dfc(
  { name: 'Test Blade', type: 'Legendary Artifact — Equipment', text: 'Equipped creature gets +1/+0.\nWhenever equipped creature deals combat damage to a player, unattach this Equipment, then transform it.\nEquip {0}' },
  { name: 'Test Unbound', type: 'Legendary Creature — Spirit', text: 'Flying', pt: ['5', '5'] },
);
describe('CR 701.3d, 608.2c: "unattach ~, then transform it" (it is the Equipment, not the creature)', () => {
  it('is automated', () => { expect(noManual(BLADE)).toBe(true); });
  it('the Equipment unattaches and transforms; the creature that dealt the damage stays what it was', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Blade // Test Unbound', 'Test Clerk'] }, defs: [BLADE, CLERK] });
    const blade = onField(s0, 'Test Blade // Test Unbound');
    const clerk = onField(s0, 'Test Clerk');
    let s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: blade, ability: 'k:0:2:0' }), { targets: [[obj(clerk)]] }));
    expect(s.objects[blade]!.attachedTo).toBe(clerk);
    s = declareAttackers(toDeclareAttackers(s), [[clerk]]);
    s = settle(s);
    s = passUntil(s, (x) => nameOf(x, blade) === 'Test Unbound' || x.turn.step === 'main2', 'the combat damage trigger', 80);
    s = resolveAll(settle(s));
    expect(nameOf(s, blade)).toBe('Test Unbound');
    expect(s.objects[blade]!.attachedTo).toBeUndefined();
    expect(nameOf(s, clerk)).toBe('Test Clerk');
  });
});

// ---- put ~ from your graveyard onto the battlefield transformed ----------------------------------------------------------------------------------------------------------------
const AWAKE = dfc(
  { name: 'Test Dream', type: 'Sorcery', text: '{0}: Put this card from your graveyard onto the battlefield transformed. Activate only as a sorcery.' },
  { name: 'Test Nightmare', type: 'Enchantment Creature — Nightmare', text: 'Skulk', pt: ['3', '3'] },
);
describe('CR 113.6m, 712.14a: "Put ~ from your graveyard onto the battlefield transformed" (an ability that works from the graveyard)', () => {
  it('is automated', () => { expect(noManual(AWAKE)).toBe(true); });
  it('the card goes from the graveyard to the battlefield, back face up', () => {
    const s0 = scenario([], { p1: { graveyard: ['Test Dream // Test Nightmare'] }, defs: [AWAKE] });
    const id = find(s0, 'Test Dream // Test Nightmare', 'graveyard', 'p1');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' })));
    const now = s.zones.battlefield.find((x) => s.objects[x]!.defId === AWAKE.id);
    expect(now).toBeDefined();
    expect(nameOf(s, now!)).toBe('Test Nightmare');
  });
});
void advanceTo;

// ---- "If you do" after a convert sees only a convert that happened (review finding) ------------------------------------------------------------------------------------------
describe('CR 701.28, 608.2c: "Convert ~. If you do, you gain 3 life." gains life only when the permanent converted', () => {
  const AGENT = dfc({ name: 'Test Agent', type: 'Artifact Creature — Robot', text: '{0}: Convert Test Agent. If you do, you gain 3 life.', pt: ['2', '2'] }, { name: 'Test Cruiser', type: 'Artifact — Vehicle', text: 'Living metal', pt: ['3', '3'] });
  const PLAINAGENT = card('Test Plain Agent', 'Artifact Creature — Robot', '{0}: Convert Test Plain Agent. If you do, you gain 3 life.', { pt: ['2', '2'] });
  const lifeOf = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('a double-faced permanent converts and the controller gains 3 life', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Agent // Test Cruiser'] }, defs: [AGENT] });
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: onField(s0, 'Test Agent // Test Cruiser'), ability: 'p:0:0' })));
    expect(lifeOf(s)).toBe(23);
  });
  it('negative: a permanent that is not double-faced does not convert, so no life is gained', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plain Agent'] }, defs: [PLAINAGENT] });
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: onField(s0, 'Test Plain Agent'), ability: 'p:0:0' })));
    expect(lifeOf(s)).toBe(20);
  });
});
