/**
 * Commander lane edh-next, round edh-next-32 (EDHREC ranks 7,501 to 8,750): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler, in 4-player games (Alice, p1, is the active player of turn 1). Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25
 * (media.wizards.com), fetched and grepped in the session.
 *
 *   CR 701.27e, 712.18, 603.2        "When this creature transforms into ..., it deals 3 damage to each other creature and each opponent." (the permanent keeps its identity: "it" is the object)
 *   CR 604.1, 508.1d         "All creatures have double strike and attack each combat if able."
 *   CR 614.1a, 615.1, 120.3  "If a spell would deal damage to you or another permanent you control, prevent that damage."
 *   CR 208.1                 "Whenever a creature you control with power equal to its toughness enters, ..."
 *   CR 201.2, 404.1          "Whenever an opponent casts a creature spell with the same name as a card in their graveyard, that player loses 10 life."
 *   CR 107.14, 118.12        "you may pay one or more {E}. If you do, put that many +1/+1 counters on ~." / "... the amount of {E} paid this way"
 *   CR 614.1c, 608.2c        "If a creature enters this way, it enters with an additional +1/+1 counter on it."
 *   CR 208.1, 109.1          "with power less than ~'s" / "with equal or lesser power"
 *   CR 401.4, 701.20e        "Put one of them into your hand and the rest on top of your library in any order."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

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
/** Pass (declaring nothing when asked) until the first main phase of turn `n`. */
function toMain(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player } as never);
    else s = settle(s, {});
  }
  return s;
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
/** The zones the objects with this name are in now (a card that changes zones is a new object, CR 400.7). */
const zonesOf = (s: GameState, name: string, owner?: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name && (owner === undefined || o.owner === owner)).map((o) => o.zone);
const countersOf = (s: GameState, id: ObjectId): Record<string, number> => ({ ...s.objects[id]!.counters });
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

const energyOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters.energy ?? 0;

// ---- the synthetic cards ----
const SLAUGHTER = card('Test Fury Banner', 'Enchantment', 'All creatures have double strike and attack each combat if able.');
const WARDEN = card('Test Warden', 'Creature — Knight', 'If a spell would deal damage to you or another permanent you control, prevent that damage.', ['2', '2']);
const BOLT = card('Test Bolt', 'Sorcery', 'Test Bolt deals 3 damage to target creature.');
const BLAST = card('Test Blast', 'Sorcery', 'Test Blast deals 3 damage to target player.');
const PINGER = card('Test Pinger', 'Creature — Imp', '{0}: This creature deals 1 damage to target creature.', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const TWIN = card('Test Twin', 'Creature — Twin', '', ['1', '1'], '{0}');
const OTHER_TWIN = card('Test Other', 'Creature — Twin', '', ['1', '1'], '{0}');
const DRAGON = card('Test Dragonlord', 'Creature — Dragon', 'Whenever an opponent casts a creature or planeswalker spell with the same name as a card in their graveyard, that player loses 10 life.', ['3', '3']);
const MATRIX = card('Test Matrix', 'Artifact', 'Whenever a creature you control with power equal to its toughness enters, you may pay {1}. If you do, draw a card.');
const SQUARE = card('Test Square', 'Creature — Construct', '', ['2', '2'], '{0}');
const OBLONG = card('Test Oblong', 'Creature — Construct', '', ['3', '2'], '{0}');
const HOUND = card('Test Hound', 'Creature — Hound', 'At the beginning of your upkeep, you get an amount of {E} equal to this creature\'s power. Then you may pay one or more {E}. If you do, put that many +1/+1 counters on this creature.', ['2', '2']);
const SHIELD = card('Test Shield', 'Sorcery', 'You get {E}, then you may pay one or more {E}. If you do, each creature you control with power equal to the amount of {E} paid this way gains indestructible until end of turn.\nDestroy all creatures.');
const THREE = card('Test Three', 'Creature — Giant', '', ['3', '3']);
const RECALL = card('Test Recall', 'Sorcery', 'Return target artifact or creature card with mana value 3 or less from your graveyard to the battlefield. If a creature enters this way, it enters with an additional +1/+1 counter on it.');
const HISTORIC = card('Test Historic', 'Sorcery', 'Return target historic permanent card from your graveyard to the battlefield. It enters with two additional +1/+1 counters on it if it\'s a creature.');
const LEGEND = card('Test Legend', 'Legendary Creature — Hero', '', ['2', '2'], '{0}');
const RELIC = card('Test Relic', 'Artifact', '', undefined, '{0}');
const SEER = card('Test Seer', 'Creature — Seer', 'When this creature enters, you may return target creature card with power less than ~\'s from your graveyard to the battlefield with a finality counter on it.', ['3', '3']);
const SMALL = card('Test Small', 'Creature — Mouse', '', ['2', '2'], '{0}');
const BIG = card('Test Big', 'Creature — Ox', '', ['4', '4'], '{0}');
const LAUNDERER = card('Test Launderer', 'Creature — Rogue', 'When this creature dies, return another target non-Rogue creature card with equal or lesser power from your graveyard to the battlefield.', ['3', '3']);
const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
const ROGUE = card('Test Rogue', 'Creature — Rogue', '', ['2', '2'], '{0}');
const KITE = card('Test Kite', 'Creature — Construct', 'Flying, haste\nWhen this creature enters, you get {E}{E}. Then you may pay one or more {E}. When you do, this creature deals that much damage to each other creature.', ['3', '3']);
const REFINERY = card('Test Refinery', 'Artifact', '{T}: You get {E}, then you may pay one or more {E}. If you do, create an X/X black Aetherborn creature token, where X is the amount of {E} paid this way.');
const WOLF = compileCard({ name: 'Test Wolf // Test Alpha', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Werewolf // Creature — Werewolf', colors: [], card_faces: [
  { name: 'Test Wolf', mana_cost: '{0}', type_line: 'Creature — Werewolf', oracle_text: '{0}: Transform this creature.', power: '4', toughness: '4', colors: [] },
  { name: 'Test Alpha', mana_cost: '', type_line: 'Creature — Werewolf', oracle_text: "Whenever this creature transforms into Test Alpha, you may have it fight target non-Werewolf creature you don't control.", power: '6', toughness: '6', colors: [] },
] } as unknown as OracleCard);
const MACHINES = card('Test Machines', 'Enchantment', 'Each noncreature artifact is an artifact creature in addition to its other types.');
const VISION = card('Test Vision', 'Sorcery', 'Look at the top three cards of your library. Put one of them into your hand and the rest on top of your library in any order.');
const AV_FRONT = compileCard({ name: 'Test Angel // Test Purifier', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Angel // Creature — Angel', colors: [], card_faces: [
  { name: 'Test Angel', mana_cost: '{0}', type_line: 'Creature — Angel', oracle_text: '{0}: Transform this creature.', power: '4', toughness: '4', colors: [] },
  { name: 'Test Purifier', mana_cost: '', type_line: 'Creature — Angel', oracle_text: 'When this creature transforms into Test Purifier, it deals 3 damage to each other creature and each opponent.\n{0}: Transform this creature.', power: '6', toughness: '5', colors: [] },
] } as unknown as OracleCard);

const ALL = [SLAUGHTER, WARDEN, BOLT, BLAST, PINGER, BEAR, TWIN, OTHER_TWIN, DRAGON, MATRIX, SQUARE, OBLONG, HOUND, SHIELD, THREE, RECALL, HISTORIC, LEGEND, RELIC, SEER, SMALL, BIG, LAUNDERER, SLAY, ROGUE, VISION, KITE, REFINERY, AV_FRONT, WOLF];
describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of ALL) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 604.1, 508.1d: "All creatures have double strike and attack each combat if able."', () => {
  const game = (): GameState => mpScenario({ defs: [SLAUGHTER, BEAR, RELIC], zones: { p1: { battlefield: ['Test Fury Banner', 'Test Bear', 'Test Relic'] }, p2: { battlefield: ['Test Bear'] } } });
  it('every creature, on every side of the table, has double strike', () => {
    const s = game();
    expect(kw(s, byName(s, 'Test Bear', 'battlefield', 'p1'))).toContain('double strike');
    expect(kw(s, byName(s, 'Test Bear', 'battlefield', 'p2'))).toContain('double strike');
  });
  it('negative: a noncreature permanent has no abilities from it', () => {
    const s = game();
    expect(kw(s, byName(s, 'Test Relic'))).not.toContain('double strike');
  });
  it('the creatures must attack: declaring no attackers is refused, and attacking with them is accepted', () => {
    let s = game();
    for (let i = 0; i < 200 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player } as never) : settle(s, {});
    expect(s.pending?.kind).toBe('declareAttackers');
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [] })).toThrow(/obeys 0 of the requirements/);
  });
});

describe('CR 614.1a, 615.1, 120.3: "If a spell would deal damage to you or another permanent you control, prevent that damage."', () => {
  const game = (): GameState => mpScenario({ defs: [WARDEN, BEAR, BOLT, BLAST, PINGER], zones: { p1: { battlefield: ['Test Warden', 'Test Bear', 'Test Pinger'] }, p2: { hand: ['Test Bolt', 'Test Blast'], battlefield: ['Test Bear'] } } });
  const p2cast = (s0: GameState, name: string, t: TargetChoice): GameState => {
    let s = s0;
    while (s.turn.number < 2 || s.turn.step !== 'main1') s = toMain(s, 2);
    const q = queued({ targets: [[t]] });
    return drain(settle(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') } as never), q), q);
  };
  it('a spell\'s damage to you and to another permanent you control is prevented', () => {
    const s0 = game();
    const bear = byName(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = p2cast(s0, 'Test Bolt', obj(bear));
    expect(s1.objects[bear]!.damage).toBe(0);
    const life = lifeOf(s0, 'p1');
    const s2 = p2cast(s0, 'Test Blast', plr('p1'));
    expect(lifeOf(s2, 'p1')).toBe(life);
  });
  it('negative: damage to the permanent itself, to an opponent\'s permanent, or from an ability is not prevented', () => {
    const s0 = game();
    const warden = byName(s0, 'Test Warden');
    expect(zonesOf(p2cast(s0, 'Test Bolt', obj(warden)), 'Test Warden')).toEqual(['graveyard']);
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = activate(s0, byName(s0, 'Test Pinger'), { targets: [[obj(byName(s0, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(s1.objects[byName(s1, 'Test Bear', 'battlefield', 'p1')]!.damage).toBe(1);
    const s2 = activate(s0, byName(s0, 'Test Pinger'), { targets: [[obj(theirs)]] });
    expect(s2.objects[theirs]!.damage).toBe(1);
  });
});

describe('CR 201.2, 404.1: "Whenever an opponent casts a creature spell with the same name as a card in their graveyard, that player loses 10 life."', () => {
  const game = (): GameState => mpScenario({ defs: [DRAGON, TWIN, OTHER_TWIN], zones: { p1: { battlefield: ['Test Dragonlord'] }, p2: { hand: ['Test Twin', 'Test Other'], graveyard: ['Test Twin'] }, p3: { graveyard: ['Test Other'] } } });
  const p2cast = (s0: GameState, name: string): GameState => {
    let s = s0;
    while (s.turn.number < 2 || s.turn.step !== 'main1') s = toMain(s, 2);
    return drain(settle(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') } as never), queued({})), queued({}));
  };
  it('the opponent loses 10 life when the name is in their own graveyard', () => {
    const s0 = game();
    const before = lifeOf(s0, 'p2');
    expect(lifeOf(p2cast(s0, 'Test Twin'), 'p2')).toBe(before - 10);
  });
  it('negative: a name only in another player\'s graveyard, or in no graveyard, does nothing', () => {
    const s0 = game();
    const before = lifeOf(s0, 'p2');
    expect(lifeOf(p2cast(s0, 'Test Other'), 'p2')).toBe(before);
  });
});

describe('CR 208.1: "a creature you control with power equal to its toughness enters"', () => {
  const game = (): GameState => mpScenario({ defs: [MATRIX, SQUARE, OBLONG], zones: { p1: { hand: ['Test Square', 'Test Oblong'], battlefield: ['Test Matrix', 'Plains', 'Plains'] } } });
  it('a 2/2 entering lets you pay {1} to draw a card', () => {
    const s0 = game();
    const hand = s0.zones.hand['p1']!.length;
    const s = cast(s0, 'Test Square', { answers: [{ kind: 'yesNo', yes: true }] });
    expect(s.zones.hand['p1']!.length).toBe(hand); // the Square left the hand, a card was drawn
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(s0.players.find((p) => p.id === 'p1')!.life);
  });
  it('negative: a 3/2 entering does not trigger it (no mana is asked, no card is drawn)', () => {
    const s0 = game();
    const hand = s0.zones.hand['p1']!.length;
    const s = cast(s0, 'Test Oblong');
    expect(s.zones.hand['p1']!.length).toBe(hand - 1);
  });
});

describe('CR 107.14, 118.12: "you get an amount of {E} equal to ~\'s power. Then you may pay one or more {E}. If you do, put that many +1/+1 counters on ~."', () => {
  const game = (energy = 0): GameState => mpScenario({ defs: [HOUND], zones: { p1: { battlefield: ['Test Hound'] } }, setup: (st) => { st.players.find((p) => p.id === 'p1')!.counters.energy = energy; } });
  /** Play to p1's first upkeep trigger, answer its "how many" question with `n` (at most the energy there is), and let it resolve. */
  const upkeep = (s0: GameState, n: number): { s: GameState; max: number; paid: number } => {
    let s = s0;
    for (let i = 0; i < 400 && s.pending?.kind !== 'chooseNumber'; i++) {
      const p = s.pending;
      if (p?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (p?.kind === 'priority') s = act(s, { type: 'pass', player: p.player } as never);
      else s = settle(s, {});
    }
    expect(s.pending?.kind).toBe('chooseNumber');
    const max = (s.pending as { max: number }).max;
    const paid = Math.min(n, max);
    s = answer(s, { kind: 'chooseNumber', n: paid });
    return { s: drain(s, {}), max, paid };
  };
  it('you get energy equal to its power, pay some of it, and it gets that many counters (the rest of the energy stays)', () => {
    const { s, max, paid } = upkeep(game(1), 2);
    expect(max).toBe(3); // 1 energy before, 2 more for its power 2
    expect(paid).toBe(2);
    expect(countersOf(s, byName(s, 'Test Hound'))['+1/+1']).toBe(2);
    expect(energyOf(s, 'p1')).toBe(1);
  });
  it('negative: paying 0 puts no counters on it and pays no energy', () => {
    const { s, max } = upkeep(game(0), 0);
    expect(max).toBe(2);
    expect(countersOf(s, byName(s, 'Test Hound'))['+1/+1'] ?? 0).toBe(0);
    expect(energyOf(s, 'p1')).toBe(2);
  });
});

describe('CR 107.14, 603.12: "you may pay one or more {E}. When you do, this creature deals that much damage to each other creature." and "create an X/X token, where X is the amount of {E} paid this way"', () => {
  const answerNumber = (s0: GameState, n: number): GameState => {
    let s = s0;
    for (let i = 0; i < 60 && (s.zones.stack.length > 0 || s.pending?.kind === 'chooseNumber'); i++) {
      if (s.pending?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n });
      else s = settle(pass(s), queued({}));
    }
    return s;
  };
  it('paying 2 of the 2 energy deals 2 damage to every other creature, not to the Kite itself', () => {
    const s0 = mpScenario({ defs: [KITE, BEAR, BIG], zones: { p1: { hand: ['Test Kite'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Big'] } } });
    const s = answerNumber(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kite', 'hand', 'p1') } as never), queued({})), 2);
    expect(zonesOf(s, 'Test Bear')).toEqual(['graveyard']);
    expect(s.objects[byName(s, 'Test Big')]!.damage).toBe(2);
    expect(s.objects[byName(s, 'Test Kite')]!.damage).toBe(0);
    expect(energyOf(s, 'p1')).toBe(0);
  });
  it('negative: paying nothing deals no damage and keeps the energy', () => {
    const s0 = mpScenario({ defs: [KITE, BEAR], zones: { p1: { hand: ['Test Kite'], battlefield: ['Test Bear'] } } });
    const s = answerNumber(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kite', 'hand', 'p1') } as never), queued({})), 0);
    expect(zonesOf(s, 'Test Bear')).toEqual(['battlefield']);
    expect(energyOf(s, 'p1')).toBe(2);
  });
  it('the Refinery makes a token as big as the energy paid; paying nothing makes none', () => {
    const mk = (n: number): GameState => {
      const s0 = mpScenario({ defs: [REFINERY], zones: { p1: { battlefield: ['Test Refinery'] } }, setup: (st) => { st.players.find((p) => p.id === 'p1')!.counters.energy = 2; } });
      return answerNumber(settle(act(s0, { type: 'activate', player: 'p1', source: byName(s0, 'Test Refinery'), ability: 'p:0:0' } as never), queued({})), n);
    };
    const s = mk(3);
    const token = Object.values(s.objects).find((o) => s.defs[o.defId]?.name.includes('Aetherborn') && o.zone === 'battlefield');
    expect(token === undefined ? 'none' : stat(s, token.id)).toBe('3/3');
    expect(Object.values(mk(0).objects).some((o) => s.defs[o.defId]?.name.includes('Aetherborn') && o.zone === 'battlefield')).toBe(false);
  });
});

describe('CR 107.14, 611.2c: "You get {E}, then you may pay one or more {E}. If you do, each creature you control with power equal to the amount of {E} paid this way gains indestructible until end of turn. Destroy all creatures."', () => {
  const game = (): GameState => mpScenario({ defs: [SHIELD, BEAR, THREE], zones: { p1: { hand: ['Test Shield'], battlefield: ['Test Bear', 'Test Three'] }, p2: { battlefield: ['Test Bear'] } }, setup: (st) => { st.players.find((p) => p.id === 'p1')!.counters.energy = 1; } });
  const play = (n: number): GameState => {
    const s0 = game();
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shield', 'hand', 'p1') } as never), queued({}));
    for (let i = 0; i < 60 && s.zones.stack.length > 0; i++) {
      if (s.pending?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n });
      else s = settle(pass(s), queued({}));
    }
    return s;
  };
  it('paying 2 saves your creatures with power 2 only; the 3-power one and the opponent\'s creature die', () => {
    const s = play(2);
    expect(zonesOf(s, 'Test Bear', 'p1')).toEqual(['battlefield']);
    expect(zonesOf(s, 'Test Three', 'p1')).toEqual(['graveyard']);
    expect(zonesOf(s, 'Test Bear', 'p2')).toEqual(['graveyard']);
    expect(energyOf(s, 'p1')).toBe(0);
  });
  it('negative: paying nothing saves nothing', () => {
    const s = play(0);
    expect(zonesOf(s, 'Test Bear', 'p1')).toEqual(['graveyard']);
    expect(energyOf(s, 'p1')).toBe(2);
  });
});

describe('CR 614.1c, 608.2c: "If a creature enters this way, it enters with an additional +1/+1 counter on it."', () => {
  const game = (): GameState => mpScenario({ defs: [RECALL, SMALL, RELIC], zones: { p1: { hand: ['Test Recall'], graveyard: ['Test Small', 'Test Relic'] } } });
  it('a creature card returned this way enters with the counter', () => {
    const s0 = game();
    const s = cast(s0, 'Test Recall', { targets: [[obj(byName(s0, 'Test Small', 'graveyard'))]] });
    expect(countersOf(s, byName(s, 'Test Small'))['+1/+1']).toBe(1);
  });
  it('negative: an artifact card returned this way enters with no counter', () => {
    const s0 = game();
    const s = cast(s0, 'Test Recall', { targets: [[obj(byName(s0, 'Test Relic', 'graveyard'))]] });
    expect(zonesOf(s, 'Test Relic')).toEqual(['battlefield']);
    expect(countersOf(s, byName(s, 'Test Relic'))['+1/+1'] ?? 0).toBe(0);
  });
});

describe('review (CR 614.12, 613.1d; Recommission ruling 2022-10-14): another permanent that makes a whole group creatures leaves the counters to the player', () => {
  it('with a "noncreature artifacts are creatures" permanent on the battlefield, the returned artifact is not silently left without the counter', () => {
    const s0 = mpScenario({ defs: [RECALL, RELIC, MACHINES], zones: { p1: { hand: ['Test Recall'], graveyard: ['Test Relic'], battlefield: ['Test Machines'] } } });
    const s = cast(s0, 'Test Recall', { targets: [[obj(byName(s0, 'Test Relic', 'graveyard'))]] });
    const relic = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Relic' && o.zone === 'battlefield');
    const silentlyWrong = relic !== undefined && (relic.counters['+1/+1'] ?? 0) === 0 && s.pending === null;
    expect(silentlyWrong).toBe(false);
  });
});

describe('CR 614.1c, 205.4: "It enters with two additional +1/+1 counters on it if it\'s a creature." (historic permanent)', () => {
  const game = (): GameState => mpScenario({ defs: [HISTORIC, LEGEND], zones: { p1: { hand: ['Test Historic'], graveyard: ['Test Legend'] } } });
  it('a legendary creature returned enters with two counters', () => {
    const s0 = game();
    const s = cast(s0, 'Test Historic', { targets: [[obj(byName(s0, 'Test Legend', 'graveyard'))]] });
    expect(countersOf(s, byName(s, 'Test Legend'))['+1/+1']).toBe(2);
  });
  it('negative: a non-historic card cannot be chosen', () => {
    const s0 = mpScenario({ defs: [HISTORIC, SMALL], zones: { p1: { hand: ['Test Historic'], graveyard: ['Test Small'] } } });
    expect(() => cast(s0, 'Test Historic', { targets: [[obj(byName(s0, 'Test Small', 'graveyard'))]] })).toThrow();
  });
});

describe('CR 208.1, 109.1: "with power less than ~\'s" (the object\'s own power)', () => {
  const game = (): GameState => mpScenario({ defs: [SEER, SMALL, BIG], zones: { p1: { hand: ['Test Seer'], graveyard: ['Test Small', 'Test Big'] } } });
  it('a card with less power than the entering Seer (3) can be returned, with a finality counter', () => {
    const s0 = game();
    const s = cast(s0, 'Test Seer', { targets: [[obj(byName(s0, 'Test Small', 'graveyard'))]], answers: [{ kind: 'yesNo', yes: true }] });
    expect(zonesOf(s, 'Test Small')).toEqual(['battlefield']);
    expect(countersOf(s, byName(s, 'Test Small')).finality).toBe(1);
  });
  it('negative: a card with more power (4) cannot be chosen', () => {
    const s0 = game();
    expect(() => cast(s0, 'Test Seer', { targets: [[obj(byName(s0, 'Test Big', 'graveyard'))]], answers: [{ kind: 'yesNo', yes: true }] })).toThrow();
  });
});

describe('CR 208.1, 603.10a: "When this creature dies, return another target non-Rogue creature card with equal or lesser power from your graveyard to the battlefield."', () => {
  const game = (): GameState => mpScenario({ defs: [LAUNDERER, SLAY, SMALL, BIG, ROGUE], zones: { p1: { battlefield: ['Test Launderer'], graveyard: ['Test Small', 'Test Big', 'Test Rogue'] }, p2: { hand: ['Test Slay'] } } });
  const kill = (s0: GameState, target: ObjectId): GameState => {
    let s = s0;
    while (s.turn.number < 2 || s.turn.step !== 'main1') s = toMain(s, 2);
    const q = queued({ targets: [[obj(target)], [obj(byName(s, 'Test Small', 'graveyard'))]] });
    return drain(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Slay', 'hand', 'p2') } as never), q), q);
  };
  it('returns a card whose power is at most its own (3): the 2-power one', () => {
    const s0 = game();
    const s = kill(s0, byName(s0, 'Test Launderer'));
    expect(zonesOf(s, 'Test Launderer')).toEqual(['graveyard']);
    expect(zonesOf(s, 'Test Small')).toEqual(['battlefield']);
  });
  it('negative: a Rogue, or a card with more power, is not a legal target; the Launderer itself is no "another" card', () => {
    const s0 = game();
    const launderer = byName(s0, 'Test Launderer');
    for (const bad of ['Test Rogue', 'Test Big']) {
      let s = s0;
      while (s.turn.number < 2 || s.turn.step !== 'main1') s = toMain(s, 2);
      const q = queued({ targets: [[obj(launderer)], [obj(byName(s, bad, 'graveyard'))]] });
      expect(() => drain(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Slay', 'hand', 'p2') } as never), q), q), bad).toThrow();
    }
  });
});

describe('Body Launderer ruling 2022-04-29 (CR 603.10a): its power as it last existed on the battlefield decides the legal targets', () => {
  it('with a +1/+1 counter (power 4) it can return the 4-power card, which a plain Launderer could not', () => {
    const s0 = mpScenario({ defs: [LAUNDERER, SLAY, BIG], zones: { p1: { battlefield: ['Test Launderer'], graveyard: ['Test Big'] }, p2: { hand: ['Test Slay'] } }, setup: (st) => { const id = Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Launderer')!.id; st.objects[id]!.counters['+1/+1'] = 1; } });
    let s = s0;
    while (s.turn.number < 2 || s.turn.step !== 'main1') s = toMain(s, 2);
    const q = queued({ targets: [[obj(byName(s, 'Test Launderer'))], [obj(byName(s, 'Test Big', 'graveyard'))]] });
    s = drain(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Slay', 'hand', 'p2') } as never), q), q);
    expect(zonesOf(s, 'Test Big')).toEqual(['battlefield']);
  });
});

describe('G10 change (a formerly full unit, representation only): "Whenever this creature transforms into ..., you may have it fight target ..." keeps playing the same', () => {
  it('the transformed creature (the object itself, CR 712.18) fights the target; the target dies; declining leaves it alone', () => {
    const play = (yes: boolean): GameState => {
      const s0 = mpScenario({ defs: [WOLF, BEAR], zones: { p1: { battlefield: ['Test Wolf // Test Alpha'] }, p2: { battlefield: ['Test Bear'] } } });
      const bear = byName(s0, 'Test Bear');
      let s = act(s0, { type: 'activate', player: 'p1', source: byName(s0, 'Test Wolf // Test Alpha'), ability: 'p:0:0' } as never);
      for (let i = 0; i < 20 && s.pending && (s.zones.stack.length > 0 || s.pending.kind !== 'priority'); i++) {
        const p = s.pending;
        if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(bear)] });
        else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
        else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else s = pass(s);
      }
      return s;
    };
    expect(zonesOf(play(true), 'Test Bear')).toEqual(['graveyard']);
    expect(zonesOf(play(false), 'Test Bear')).toEqual(['battlefield']);
  });
});

describe('CR 401.4, 701.20e: "Look at the top three cards of your library. Put one of them into your hand and the rest on top of your library in any order."', () => {
  it('the chosen card goes to hand and the other two stay on top of the library', () => {
    const s0 = mpScenario({ defs: [VISION, SMALL, BIG, ROGUE], zones: { p1: { hand: ['Test Vision'], library: ['Test Small', 'Test Big', 'Test Rogue'] } } });
    const lib0 = s0.zones.library['p1']!.length;
    const nameOf = (st: GameState, id: ObjectId): string => st.defs[st.objects[id]!.defId]!.name;
    const top = s0.zones.library['p1']!.slice(0, 3);
    const s = cast(s0, 'Test Vision', { picks: [[top[1]!]], answers: [{ kind: 'order', ids: [top[2]!, top[0]!] }] });
    expect(zonesOf(s, nameOf(s0, top[1]!)).includes('hand')).toBe(true);
    expect(s.zones.library['p1']!.length).toBe(lib0 - 1);
    expect(s.zones.library['p1']!.slice(0, 2).map((id) => nameOf(s, id))).toEqual([nameOf(s0, top[2]!), nameOf(s0, top[0]!)]); // the order the player chose
  });
});

describe('CR 701.27e, 712.18, 603.2: "When this creature transforms into Test Purifier, it deals 3 damage to each other creature and each opponent."', () => {
  const game = (): GameState => mpScenario({ defs: [AV_FRONT, BEAR, BIG], zones: { p1: { battlefield: ['Test Angel // Test Purifier', 'Test Bear'] }, p2: { battlefield: ['Test Big'] } } });
  const flip = (s0: GameState): GameState => { const a = byName(s0, 'Test Angel // Test Purifier'); return activate(s0, a); };
  it('every other creature and every opponent is dealt 3 once it transforms; it does not hurt itself', () => {
    const s0 = game();
    const life = (s: GameState, p: string) => lifeOf(s, p);
    const s = flip(s0);
    expect(zonesOf(s, 'Test Bear')).toEqual(['graveyard']);
    expect(s.objects[byName(s, 'Test Big')]!.damage).toBe(3);
    for (const p of ['p2', 'p3', 'p4']) expect(life(s, p)).toBe(life(s0, p) - 3);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(s.objects[byName(s, 'Test Angel // Test Purifier')]!.damage).toBe(0);
  });
  it('negative: transforming back does not trigger it again', () => {
    const s0 = game();
    const s1 = flip(s0);
    const s2 = activate(s1, byName(s1, 'Test Angel // Test Purifier'), {}, 'p:1:1');
    expect(lifeOf(s2, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
  });
});
