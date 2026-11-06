/**
 * Commander lane time-counters (concept round), edh-d-68: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler, each with its negative case, in two and four-player games where the owner of a card matters. CR cites are from memory (unverified) unless marked.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, life, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const timeOn = (s: GameState, id: ObjectId): number => Number((s.objects[id] as unknown as { counters?: Record<string, number> }).counters?.['time'] ?? 0);
const exileId = (s: GameState, name: string, owner?: 'p1' | 'p2' | 'p3' | 'p4'): ObjectId =>
  s.zones.exile.find((x) => chars(s, x).name === name && (owner === undefined || s.objects[x]!.owner === owner))!;

interface Picks { yes?: boolean; ids?: ObjectId[][] }
/** Answer every decision until a player has priority (yes/no by `yes`, objects in order, mana automatically); attackers are declared by `attack`. */
function drive(s0: GameState, o: Picks = {}, attack?: { attacker: ObjectId; defender: string }): GameState {
  let s = s0;
  const cq = [...(o.ids ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: cq.shift() ?? p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max as number) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: (p as unknown as { objects: ObjectId[] }).objects[0]! }] });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: attack ? [attack as never] : [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
/** Play on (passing priority, driving decisions) until the combat damage step of the turn is over. */
function throughCombat(s0: GameState, attack: { attacker: ObjectId; defender: string }, o: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 120 && s.turn.step !== 'main2' && !s.result; guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o, attack);
  return s;
}

describe('CR 122.1, 702.62a, 603.2: "whenever you remove a time counter from this card while it\'s exiled" (Watcher of Hours)', () => {
  const HOUR = card('Test Hour', 'Creature — Wizard', "Suspend 3--{U}\nWhenever you remove a time counter from this card while it's exiled, you gain 1 life.", { pt: ['2', '2'], cost: '{3}{U}', colors: ['U'] });
  const PEEL = card('Test Peel', 'Instant', 'Remove a time counter from target suspended card.', { cost: '{0}' });
  const defs = [HOUR, PEEL];
  it('is automated', () => expect(automated(HOUR)).toBe(true));
  it('its owner\'s upkeep removal (suspend) is a removal by them: they gain 1 life and the card has one fewer time counter', () => {
    const s0 = scenario(['Island'], { p1: { exile: [{ name: 'Test Hour', counters: { time: 3 } }] }, defs });
    const s = advanceTo(s0, 3, 'draw'); // turn 3 is the second turn of the first player
    expect(timeOn(s, exileId(s, 'Test Hour'))).toBe(2);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 1);
  });
  it('NEGATIVE: a card with no time counter is not suspended: nothing is removed, no life', () => {
    const s0 = scenario(['Island'], { p1: { exile: ['Test Hour'] }, defs });
    const s = advanceTo(s0, 3, 'draw');
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('NEGATIVE: the card in the owner\'s hand with time counters is not exiled: the upkeep removal and the trigger do not work there', () => {
    const s0 = scenario(['Island'], { p1: { hand: [{ name: 'Test Hour', counters: { time: 3 } }] }, defs });
    const s = advanceTo(s0, 3, 'draw');
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('NEGATIVE: an opponent removing a time counter from your suspended card is not "you remove": no life (CR 122.1)', () => {
    const s0 = scenario(['Island'], { p1: { exile: [{ name: 'Test Hour', counters: { time: 3 } }] }, p2: { hand: ['Test Peel'] }, defs });
    let s = advanceTo(s0, 2, 'main1'); // the second player's turn: they have priority with an empty stack
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Peel', 'hand', 'p2') });
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, {});
    expect(timeOn(s, exileId(s, 'Test Hour'))).toBe(2);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

describe('CR 122.1, 702.62b, 608.2h: "put a time counter on it for each suspended card you own and each other permanent you control with a time counter on it" (Rose Tyler)', () => {
  const ROSE = card('Test Rose', 'Legendary Creature — Human', 'This creature gets +1/+1 for each time counter on it.\nWhenever this creature attacks, put a time counter on it for each suspended card you own and each other permanent you control with a time counter on it.', { pt: ['1', '1'], cost: '{2}{W}', colors: ['W'] });
  const SLEEPER = card('Test Sleeper', 'Creature — Zombie', 'Suspend 4--{R}', { pt: ['2', '2'], cost: '{3}{R}', colors: ['R'] });
  const CLOCK = card('Test Clock', 'Artifact', '', { cost: '{1}' });
  const defs = [ROSE, SLEEPER, CLOCK];
  it('is automated', () => expect(automated(ROSE)).toBe(true));
  const attackOf = (s0: GameState): GameState => {
    let s = s0;
    for (let g = 0; g < 80 && s.pending?.kind !== 'declareAttackers'; g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, {});
    return throughCombat(s, { attacker: find(s, 'Test Rose', 'battlefield', 'p1'), defender: 'p2' });
  };
  it('counts your suspended cards plus your other permanents with a time counter: 2 suspended + 1 permanent = 3 counters (and +1/+1 for each)', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Rose', { name: 'Test Clock', counters: { time: 2 } }], exile: [{ name: 'Test Sleeper', counters: { time: 3 } }, { name: 'Test Sleeper', counters: { time: 1 } }] }, defs });
    const s = attackOf(s0);
    expect(timeOn(s, find(s, 'Test Rose', 'battlefield', 'p1'))).toBe(3);
    expect(Number(chars(s, find(s, 'Test Rose', 'battlefield', 'p1')).power)).toBe(4);
  });
  it('NEGATIVE: an opponent\'s suspended card, a card in exile with no time counter, and a permanent without one are not counted; the creature itself is not "other"', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: [{ name: 'Test Rose', counters: { time: 1 } }, 'Test Clock'], exile: ['Test Sleeper'] }, p2: { exile: [{ name: 'Test Sleeper', counters: { time: 3 } }] }, defs });
    const s = attackOf(s0);
    expect(timeOn(s, find(s, 'Test Rose', 'battlefield', 'p1'))).toBe(1); // it keeps its one; nothing was added
  });
  it('a card you own but an opponent... four players: only the Rose\'s controller\'s own suspended cards count, whoever else has some', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Rose'], exile: [{ name: 'Test Sleeper', counters: { time: 2 } }] }, p2: { exile: [{ name: 'Test Sleeper', counters: { time: 2 } }] }, defs });
    const s = attackOf(s0);
    expect(timeOn(s, find(s, 'Test Rose', 'battlefield', 'p1'))).toBe(1);
  });
});

describe('CR 118.3, 122.1, 702.62b: "Remove a time counter from a permanent you control or suspended card you own" as a cost (Rift Elemental)', () => {
  const RIFT = card('Test Rift', 'Creature — Elemental', '{1}{R}, Remove a time counter from a permanent you control or suspended card you own: This creature gets +2/+0 until end of turn.', { pt: ['2', '2'], cost: '{2}{R}', colors: ['R'] });
  const SLEEPER = card('Test Sleeper', 'Creature — Zombie', 'Suspend 4--{R}', { pt: ['2', '2'], cost: '{3}{R}', colors: ['R'] });
  const CLOCK = card('Test Clock', 'Artifact', '', { cost: '{1}' });
  const defs = [RIFT, SLEEPER, CLOCK];
  const activate = (s0: GameState, ids?: ObjectId[][]): GameState => {
    for (let i = 0; i < 2; i++) s0.players[0]!.manaPool.push({ type: 'R' } as never);
    const s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Rift', 'battlefield', 'p1'), ability: 'p:0:0' });
    return drive(s, { ids });
  };
  it('is automated', () => expect(automated(RIFT)).toBe(true));
  it('pays with a suspended card you own in exile: it loses a time counter and the Rift gets +2/+0', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Rift'], exile: [{ name: 'Test Sleeper', counters: { time: 2 } }] }, defs });
    const sleeper = exileId(s0, 'Test Sleeper');
    const s = activate(s0, [[sleeper]]);
    expect(timeOn(s, sleeper)).toBe(1);
  });
  it('pays with a permanent you control that has a time counter', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Rift', { name: 'Test Clock', counters: { time: 2 } }] }, defs });
    const clock = find(s0, 'Test Clock', 'battlefield', 'p1');
    const s = activate(s0, [[clock]]);
    expect(timeOn(s, clock)).toBe(1);
  });
  it('NEGATIVE: nothing to pay with (an opponent\'s suspended card, a permanent with no time counter, an exiled card with none): the ability can\'t be activated', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Rift', 'Test Clock'], exile: ['Test Sleeper'] }, p2: { exile: [{ name: 'Test Sleeper', counters: { time: 3 } }] }, defs });
    for (let i = 0; i < 2; i++) s0.players[0]!.manaPool.push({ type: 'R' } as never);
    expect(reject(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Rift', 'battlefield', 'p1'), ability: 'p:0:0' }).rules.join()).toContain('CR 118.3');
  });
});

describe('CR 702.62b, 122.1, 120.1: "choose a suspended card you own and remove that many time counters from it" (Amy Pond)', () => {
  const AMY = card('Test Amy', 'Legendary Creature — Human', 'Whenever this creature deals combat damage to a player, choose a suspended card you own and remove that many time counters from it.', { pt: ['3', '3'], cost: '{2}{W}', colors: ['W'] });
  const SLEEPER = card('Test Sleeper', 'Creature — Zombie', 'Suspend 6--{R}', { pt: ['2', '2'], cost: '{3}{R}', colors: ['R'] });
  const defs = [AMY, SLEEPER];
  it('is automated', () => expect(automated(AMY)).toBe(true));
  const hit = (s0: GameState, ids?: ObjectId[][]): GameState => {
    let s = s0;
    for (let g = 0; g < 80 && s.pending?.kind !== 'declareAttackers'; g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, {});
    return throughCombat(s, { attacker: find(s, 'Test Amy', 'battlefield', 'p1'), defender: 'p2' }, { ids });
  };
  it('removes as many time counters as the damage dealt (3) from the chosen suspended card', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Amy'], exile: [{ name: 'Test Sleeper', counters: { time: 5 } }] }, defs });
    const s = hit(s0);
    expect(timeOn(s, exileId(s, 'Test Sleeper'))).toBe(2);
  });
  it('removes only what is there when the card has fewer counters than the damage (2 of 3): the last counter removed, the suspend trigger casts it, so it leaves exile (CR 702.62a)', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Amy'], exile: [{ name: 'Test Sleeper', counters: { time: 2 } }] }, defs });
    const s = hit(s0);
    expect(s.zones.exile.some((x) => chars(s, x).name === 'Test Sleeper')).toBe(false);
  });
  it('NEGATIVE: with no suspended card of yours, an opponent\'s suspended card is never touched (four players\' cards: the owner is checked)', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Amy'], exile: ['Test Sleeper'] }, p2: { exile: [{ name: 'Test Sleeper', counters: { time: 5 } }] }, defs });
    const s = hit(s0);
    expect(timeOn(s, exileId(s, 'Test Sleeper', 'p2'))).toBe(5);
    expect(timeOn(s, exileId(s, 'Test Sleeper', 'p1'))).toBe(0);
  });
});

describe('CR 702.62a, 406.1, 400.7: "exile a card from your hand with a number of time counters on it equal to its mana value. If it doesn\'t have suspend, it gains suspend" (The Eleventh Doctor)', () => {
  const DOC = card('Test Doctor', 'Legendary Creature — Time Lord', "I. AM. TALKING! -- Whenever this creature deals combat damage to a player, you may exile a card from your hand with a number of time counters on it equal to its mana value. If it doesn't have suspend, it gains suspend.", { pt: ['3', '3'], cost: '{2}{U}', colors: ['U'] });
  const THREE = card('Test Three', 'Sorcery', 'You gain 3 life.', { cost: '{2}{W}' });
  const defs = [DOC, THREE];
  it('is automated', () => expect(automated(DOC)).toBe(true));
  const hit = (s0: GameState, o: Picks): GameState => {
    let s = s0;
    for (let g = 0; g < 80 && s.pending?.kind !== 'declareAttackers'; g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, {});
    return throughCombat(s, { attacker: find(s, 'Test Doctor', 'battlefield', 'p1'), defender: 'p2' }, o);
  };
  it('the chosen card (mana value 3) is exiled with three time counters and now has suspend', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Doctor'], hand: ['Test Three'] }, defs });
    const s = hit(s0, { yes: true });
    const id = exileId(s, 'Test Three');
    expect(timeOn(s, id)).toBe(3);
    expect(chars(s, id).abilities.some((a) => JSON.stringify(a).includes('suspend'))).toBe(true);
  });
  it('NEGATIVE: declining ("you may") leaves the card in hand', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Doctor'], hand: ['Test Three'] }, defs });
    const s = hit(s0, { yes: false });
    expect(s.zones.exile.length).toBe(0);
  });
});

describe('edh-d-68 review: Watcher of Hours once for each time counter removed (CR 603.2c)', () => {
  const HOUR = card('Test Hour', 'Creature — Wizard', "Suspend 9--{U}\nWhenever you remove a time counter from this card while it's exiled, you gain 1 life.", { pt: ['2', '2'], cost: '{3}{U}', colors: ['U'] });
  const AMY = card('Test Amy', 'Legendary Creature — Human', 'Whenever this creature deals combat damage to a player, choose a suspended card you own and remove that many time counters from it.', { pt: ['3', '3'], cost: '{2}{W}', colors: ['W'] });
  it('Amy removing 3 counters from the Hour gives 3 life (plus none else)', () => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Test Amy'], exile: [{ name: 'Test Hour', counters: { time: 6 } }] }, defs: [HOUR, AMY] });
    let s = s0;
    for (let g = 0; g < 80 && s.pending?.kind !== 'declareAttackers'; g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, {});
    s = throughCombat(s, { attacker: find(s, 'Test Amy', 'battlefield', 'p1'), defender: 'p2' });
    expect(timeOn(s, exileId(s, 'Test Hour'))).toBe(3);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 3);
  });
});
