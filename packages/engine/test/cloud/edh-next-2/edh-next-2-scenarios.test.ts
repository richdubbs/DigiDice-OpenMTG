/**
 * Commander lane edh-next, round edh-next-2: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 205.1b, 611.2a, 613.1d   "Until end of turn, any number of target lands you control become 1/1 Elemental creatures with ... They're still lands." (Kamahl's Will)
 *   CR 205.1b, 608.2d           "you may have target land you control become a 3/3 Elemental creature with haste until end of turn. It's still a land." (Embodiment of Insight)
 *   CR 205.3m, 702.73a          "~ becomes a 4/3 creature with vigilance and all creature types until end of turn. It's still a land." (Faceless Haven)
 *   CR 205.4a, 205.1b           "until end of turn, ~ becomes a legendary 6/6 Nightmare God creature with menace and deathtouch. It's still an enchantment." (Cacophony Unleashed)
 *   CR 205.1b, 613.1d           "Untap up to six target lands. They become 6/6 Elemental creatures. They're still lands." (Nissa, Vastwood Seer)
 *   CR 614.1a, 614.5, 120.3     "Double all damage that creatures you control with counters on them would deal." (Raphael, the Muscle)
 *   CR 614.1a, 607.2d, 120.3    "If a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead." (Sawhorn Nemesis)
 *   CR 614.1a, 303.4, 120.3     "If a source would deal damage to enchanted player, it deals double that damage to that player instead." (Curse of Bloodletting)
 *   CR 614.1a, 119.3, 119.4     "If an opponent would gain life, that player loses that much life instead." (Plague Drone, Tainted Remedy)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, put } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; options?: string[] }
/** Answer what comes up: targets, object choices, option labels, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseOption' && o.options && o.options.length > 0) {
      const label = o.options.shift()!;
      const opt = p.options.find((x) => x.label === label);
      if (!opt) throw new Error(`no option ${label} among ${p.options.map((x) => x.label).join(', ')}`);
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] });
    } else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])], options: [...(o.options ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never), q), q);
}
/** Pass (declaring no attackers when asked) until turn `n` begins. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 300 && s.turn.number < n; i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasType = (s: GameState, id: ObjectId, t: string): boolean => getChars(s, id)!.types.includes(t as never);
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

const WILL = card('Test Wild Will', 'Instant', "Until end of turn, any number of target lands you control become 1/1 Elemental creatures with vigilance, indestructible, and haste. They're still lands.");
const INSIGHT = card('Test Insight', 'Creature — Elemental', "{0}: You may have target land you control become a 3/3 Elemental creature with haste until end of turn. It's still a land.", ['1', '1']);
const HAVEN = card('Test Haven', 'Land', "{0}: ~ becomes a 4/3 creature with vigilance and all creature types until end of turn. It's still a land.");
const CACOPHONY = card('Test Cacophony', 'Enchantment', "{0}: Until end of turn, ~ becomes a legendary 6/6 Nightmare God creature with menace and deathtouch. It's still an enchantment.");
const SEER = card('Test Seer', 'Legendary Planeswalker — Test', "−1: Untap up to two target lands. They become 6/6 Elemental creatures. They're still lands.", undefined, '{0}', '4');
const MUSCLE = card('Test Muscle', 'Creature — Mutant', "Double all damage that creatures you control with counters on them would deal.", ['2', '2']);
const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}: ~ deals 1 damage to target player.', ['1', '1']);
const PINGER2 = card('Test Pinger Two', 'Creature — Wizard', '{0}: ~ deals 1 damage to target creature.', ['1', '1']);
const NEMESIS = card('Test Nemesis', 'Creature — Dinosaur', 'As ~ enters, choose a player.\nIf a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead.', ['3', '3']);
const CURSE = card('Test Curse', 'Enchantment — Aura Curse', 'Enchant player\nIf a source would deal damage to enchanted player, it deals double that damage to that player instead.');
const DRONE = card('Test Drone', 'Creature — Demon', 'If an opponent would gain life, that player loses that much life instead.', ['1', '1']);
const BOON = card('Test Boon', 'Sorcery', 'Target player gains 3 life.');
const AWAKENING = card('Test Awakening', 'Sorcery', "Until your next turn, all lands you control become 2/2 Elemental creatures with reach, indestructible, and haste. They're still lands.");
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '9']);
const GROWTH = card('Test Growth', 'Instant', 'Put a +1/+1 counter on target creature.');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [WILL, INSIGHT, HAVEN, CACOPHONY, SEER, MUSCLE, PINGER, PINGER2, NEMESIS, CURSE, DRONE, BOON, GROWTH, WALL, AWAKENING]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 205.1b, 611.2a, 613.1d: "Until end of turn, any number of target lands you control become 1/1 Elemental creatures with ... They\'re still lands."', () => {
  const game = () => mpScenario({ players: 3, defs: [WILL], zones: { p1: { hand: ['Test Wild Will'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Plains'] } } });
  it('the chosen lands are 1/1 Elemental creatures that are still lands, with the granted abilities; an unchosen land and an opponent\'s land are unchanged', () => {
    const s0 = game();
    const mine = Object.values(s0.objects).filter((o) => s0.defs[o.defId]?.name === 'Plains' && o.zone === 'battlefield' && o.controller === 'p1').map((o) => o.id);
    const theirs = byName(s0, 'Plains', 'battlefield', 'p2');
    const s = cast(s0, 'Test Wild Will', { targets: [[obj(mine[0]!), obj(mine[1]!)]] });
    for (const id of [mine[0]!, mine[1]!]) {
      expect(stat(s, id)).toBe('1/1');
      expect(hasType(s, id, 'Creature')).toBe(true);
      expect(hasType(s, id, 'Land')).toBe(true);
      expect(getChars(s, id)!.subtypes).toContain('Elemental');
      expect(kw(s, id)).toEqual(expect.arrayContaining(['haste', 'vigilance', 'indestructible']));
    }
    expect(hasType(s, mine[2]!, 'Creature')).toBe(false);
    expect(hasType(s, theirs, 'Creature')).toBe(false);
  });
  it('"any number" includes none: a cast with no target resolves and animates nothing', () => {
    const s0 = game();
    const none = cast(s0, 'Test Wild Will', { targets: [[]] });
    expect(Object.values(none.objects).some((o) => o.zone === 'battlefield' && hasType(none, o.id, 'Creature'))).toBe(false);
    expect(byName(none, 'Test Wild Will', 'graveyard')).toBeDefined();
  });
  it('the effect ends at the end of the turn', () => {
    const s0 = game();
    const one = Object.values(s0.objects).find((o) => s0.defs[o.defId]?.name === 'Plains' && o.zone === 'battlefield' && o.controller === 'p1')!.id;
    const s1 = cast(s0, 'Test Wild Will', { targets: [[obj(one)]] });
    expect(hasType(s1, one, 'Creature')).toBe(true);
    const s = toTurn(s1, 2);
    expect(s.turn.number).toBe(2);
    expect(hasType(s, one, 'Creature')).toBe(false);
    expect(hasType(s, one, 'Land')).toBe(true);
  });
});

describe('CR 611.2c, 205.1b: "Until your next turn, all lands you control become 2/2 Elemental creatures with reach, indestructible, and haste. They\'re still lands."', () => {
  it('every land you control as it resolves is a 2/2 Elemental creature that is still a land, until your next turn; a land that enters later and an opponent\'s land are not affected (a set fixed on resolution)', () => {
    const s0 = mpScenario({ players: 3, defs: [AWAKENING], zones: { p1: { hand: ['Test Awakening'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Plains'] } } });
    const mine = Object.values(s0.objects).filter((o) => s0.defs[o.defId]?.name === 'Plains' && o.zone === 'battlefield' && o.controller === 'p1').map((o) => o.id);
    const s1 = cast(s0, 'Test Awakening');
    for (const id of mine) { expect(stat(s1, id)).toBe('2/2'); expect(hasType(s1, id, 'Land')).toBe(true); expect(kw(s1, id)).toEqual(expect.arrayContaining(['reach', 'indestructible', 'haste'])); }
    expect(hasType(s1, byName(s1, 'Plains', 'battlefield', 'p2'), 'Creature')).toBe(false);
    const later = tweak(s1, (g) => { put(g, 'p1', 'battlefield', 'Plains'); });
    const fresh = Object.values(later.objects).find((o) => later.defs[o.defId]?.name === 'Plains' && o.zone === 'battlefield' && o.controller === 'p1' && !mine.includes(o.id))!.id;
    expect(hasType(later, fresh, 'Creature')).toBe(false);
    expect(hasType(toTurn(s1, 2), mine[0]!, 'Creature')).toBe(true); // still a creature in the opponent's turn 2 (it lasts until MY next turn)
  });
});

describe('CR 205.1b, 608.2d: "You may have target land you control become a 3/3 Elemental creature with haste until end of turn. It\'s still a land."', () => {
  const game = () => mpScenario({ players: 3, defs: [INSIGHT], zones: { p1: { battlefield: ['Test Insight', 'Plains'] } } });
  it('when the controller says yes the land is a 3/3 Elemental creature with haste that is still a land', () => {
    const s0 = game();
    const land = byName(s0, 'Plains');
    const s = activate(s0, byName(s0, 'Test Insight'), { targets: [[obj(land)]], answers: [yes] });
    expect(stat(s, land)).toBe('3/3');
    expect(hasType(s, land, 'Land')).toBe(true);
    expect(hasType(s, land, 'Creature')).toBe(true);
    expect(kw(s, land)).toContain('haste');
  });
  it('when the controller says no nothing changes', () => {
    const s0 = game();
    const land = byName(s0, 'Plains');
    const s = activate(s0, byName(s0, 'Test Insight'), { targets: [[obj(land)]], answers: [{ kind: 'yesNo', yes: false }] });
    expect(hasType(s, land, 'Creature')).toBe(false);
  });
});

describe('CR 205.3m, 702.73a: "~ becomes a 4/3 creature with vigilance and all creature types until end of turn. It\'s still a land."', () => {
  it('the land is a 4/3 creature of every creature type with vigilance and is still a land', () => {
    const s0 = mpScenario({ players: 3, defs: [HAVEN], zones: { p1: { battlefield: ['Test Haven'] } } });
    const h = byName(s0, 'Test Haven');
    expect(hasType(s0, h, 'Creature')).toBe(false);
    const s = activate(s0, h);
    expect(stat(s, h)).toBe('4/3');
    expect(hasType(s, h, 'Land')).toBe(true);
    expect(hasType(s, h, 'Creature')).toBe(true);
    expect(kw(s, h)).toContain('vigilance');
    expect(getChars(s, h)!.subtypes.length).toBeGreaterThan(20);
  });
});

describe('CR 205.4a, 205.1b: "until end of turn, ~ becomes a legendary 6/6 Nightmare God creature with menace and deathtouch. It\'s still an enchantment."', () => {
  it('the enchantment is a legendary 6/6 Nightmare God creature with menace and deathtouch, still an enchantment', () => {
    const s0 = mpScenario({ players: 3, defs: [CACOPHONY], zones: { p1: { battlefield: ['Test Cacophony'] } } });
    const c = byName(s0, 'Test Cacophony');
    const s = activate(s0, c);
    const ch = getChars(s, c)!;
    expect(stat(s, c)).toBe('6/6');
    expect(ch.types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(ch.supertypes).toContain('Legendary');
    expect(ch.subtypes).toEqual(expect.arrayContaining(['Nightmare', 'God']));
    expect(kw(s, c)).toEqual(expect.arrayContaining(['menace', 'deathtouch']));
  });
});

describe('CR 205.1b, 613.1d: "Untap up to two target lands. They become 6/6 Elemental creatures. They\'re still lands."', () => {
  it('the targeted lands untap and are 6/6 Elemental creatures that are still lands, for good; an untargeted land is not', () => {
    const s0 = mpScenario({ players: 3, defs: [SEER], zones: { p1: { battlefield: [{ name: 'Test Seer', counters: { loyalty: 4 } }, 'Plains', 'Plains', 'Plains'] } } });
    const lands = Object.values(s0.objects).filter((o) => s0.defs[o.defId]?.name === 'Plains' && o.zone === 'battlefield' && o.controller === 'p1').map((o) => o.id);
    const tapped = tweak(s0, (g) => { for (const id of lands) g.objects[id]!.tapped = true; });
    const s1 = activate(tapped, byName(tapped, 'Test Seer'), { targets: [[obj(lands[0]!), obj(lands[1]!)]] });
    for (const id of [lands[0]!, lands[1]!]) {
      expect(s1.objects[id]!.tapped).toBe(false);
      expect(stat(s1, id)).toBe('6/6');
      expect(hasType(s1, id, 'Land')).toBe(true);
      expect(hasType(s1, id, 'Creature')).toBe(true);
    }
    expect(s1.objects[lands[2]!]!.tapped).toBe(true);
    expect(hasType(s1, lands[2]!, 'Creature')).toBe(false);
    const s = toTurn(s1, 2);
    expect(hasType(s, lands[0]!, 'Creature')).toBe(true); // no duration: it lasts
  });
});

describe('CR 614.1a, 614.5, 120.3: "Double all damage that creatures you control with counters on them would deal."', () => {
  const game = () => mpScenario({ players: 3, defs: [MUSCLE, PINGER, GROWTH], zones: { p1: { battlefield: ['Test Muscle', 'Test Pinger'], hand: ['Test Growth'] } } });
  it('a creature you control with a counter deals double damage, one without does not', () => {
    const s0 = game();
    const pinger = byName(s0, 'Test Pinger');
    const plain = activate(s0, pinger, { targets: [[plr('p2')]] });
    expect(lifeOf(plain, 'p2')).toBe(19);
    const grown = cast(s0, 'Test Growth', { targets: [[obj(pinger)]] });
    expect(grown.objects[pinger]!.counters['+1/+1']).toBe(1);
    const s = activate(grown, pinger, { targets: [[plr('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(18); // 1 damage doubled: Test Pinger is 2/2 now, its ability still deals 1, doubled to 2
  });
});

describe('CR 614.1a, 607.2d: "If a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead."', () => {
  const game = () => mpScenario({ players: 3, defs: [NEMESIS, PINGER, PINGER2, WALL], zones: { p1: { hand: ['Test Nemesis'], battlefield: ['Test Pinger', 'Test Pinger Two'] }, p2: { battlefield: ['Test Wall'] }, p3: { battlefield: ['Test Wall'] } } });
  it('damage to the chosen player is doubled, damage to another player is not', () => {
    const s0 = cast(game(), 'Test Nemesis', { options: ['Bob'] });
    const pinger = byName(s0, 'Test Pinger', 'battlefield', 'p1');
    const a = activate(s0, pinger, { targets: [[plr('p2')]] });
    expect(lifeOf(a, 'p2')).toBe(18);
    const b = activate(s0, pinger, { targets: [[plr('p3')]] });
    expect(lifeOf(b, 'p3')).toBe(19);
  });
  it('damage to a permanent the chosen player controls is doubled, damage to another player\'s permanent is not', () => {
    const s0 = cast(game(), 'Test Nemesis', { options: ['Bob'] });
    const ping = byName(s0, 'Test Pinger Two');
    const a = activate(s0, ping, { targets: [[obj(byName(s0, 'Test Wall', 'battlefield', 'p2'))]] });
    expect(a.objects[byName(a, 'Test Wall', 'battlefield', 'p2')]!.damage).toBe(2);
    const b = activate(s0, ping, { targets: [[obj(byName(s0, 'Test Wall', 'battlefield', 'p3'))]] });
    expect(b.objects[byName(b, 'Test Wall', 'battlefield', 'p3')]!.damage).toBe(1);
  });
});

describe('CR 614.1a, 303.4: "If a source would deal damage to enchanted player, it deals double that damage to that player instead."', () => {
  const game = () => mpScenario({ players: 3, defs: [CURSE, PINGER], zones: { p1: { hand: ['Test Curse'], battlefield: ['Test Pinger'] } } });
  it('damage to the enchanted player is doubled; damage to another player is not', () => {
    const s0 = cast(game(), 'Test Curse', { targets: [[plr('p2')]] });
    const pinger = byName(s0, 'Test Pinger');
    expect(lifeOf(activate(s0, pinger, { targets: [[plr('p2')]] }), 'p2')).toBe(18);
    expect(lifeOf(activate(s0, pinger, { targets: [[plr('p3')]] }), 'p3')).toBe(19);
  });
});

describe('CR 614.1a, 119.3: "If an opponent would gain life, that player loses that much life instead."', () => {
  const game = () => mpScenario({ players: 3, defs: [DRONE, BOON], zones: { p1: { battlefield: ['Test Drone'], hand: ['Test Boon'] } } });
  it('an opponent that would gain 3 life loses 3; the controller gaining life is unaffected', () => {
    const a = cast(game(), 'Test Boon', { targets: [[plr('p2')]] });
    expect(lifeOf(a, 'p2')).toBe(17);
    const b = cast(game(), 'Test Boon', { targets: [[plr('p1')]] });
    expect(lifeOf(b, 'p1')).toBe(23);
  });
});
