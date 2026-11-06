/**
 * Commander round edh-next-34 (EDHREC ranks 15,001-16,250): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler, in 4-player games (Alice, p1, is the active player of turn 1). Each test is named after the rule it checks, with its negative case. CR cites are from
 * the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read when the round ran.
 *
 *   CR 614.1a, 614.6, 121.1, 104.3e   "If you would draw a card, return a card from your graveyard to your hand instead. If you can't, you lose the game." (Forbidden Crypt)
 *   CR 614.1a, 400.3                  "If a card would be put into your graveyard from anywhere, exile that card instead." (Forbidden Crypt)
 *   CR 614.1a, 303.4, 701.20a         "If a card would be put into enchanted player's graveyard from anywhere, instead that card is revealed and put on the bottom of that player's library." (Wheel of Sun and Moon)
 *   CR 701.16a, 608.2c, 109.4         "Exile target creature and all other creatures its controller controls with the same name as that creature. That player investigates for each nontoken creature exiled this way." (Declaration in Stone)
 *   CR 607.2a, 108.3                  "At the beginning of your upkeep, you may put a card you own exiled with ~ into your hand." (Endless Horizons)
 *   CR 611.2a, 509.1b                 "Target creature gets +1/+0 until end of turn for each creature you control and can't be blocked this turn." (Invisible Woman)
 *   CR 508.1h, 509.1d, 303.4, 602.1   "Enchanted creature can't attack or block unless its controller pays {3}." / "Activated abilities of enchanted creature cost {3} more to activate." (Oppressive Rays)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { attackTaxes, blockTaxes } from '../../../src/statics/combat-tax';
import { applyAction } from '../../../src/index';
import { act, answer, find, findAll, pass, put } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hand = (s: GameState, p: string): ObjectId[] => s.zones.hand[p] ?? [];
const yard = (s: GameState, p: string): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const lib = (s: GameState, p: string): string[] => (s.zones.library[p] ?? []).map((id) => s.objects[id]!.defId);
const inHand = (s: GameState, p: string, name: string): boolean => hand(s, p).some((id) => s.objects[id]!.defId === name);
const exiled = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
const lost = (s: GameState, p: string): boolean => s.players.find((x) => x.id === p)!.hasLost;
/** An Aura (or any attached object) of the card `name` that `owner` controls, attached to a player or an object. */
const attach = (s: GameState, name: string, to: ObjectId, owner = 'p1'): GameState => tweak(s, (t) => { t.objects[put(t, owner, 'battlefield', name)]!.attachedTo = to; });

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] }
/** Answer what comes up (targets, object choices, then the answers); pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** Pass (declaring no attackers when asked) until turn `n` begins and its upkeep gives priority. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'upkeep' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}

const CRYPT = card('Test Crypt', 'Enchantment', 'If you would draw a card, return a card from your graveyard to your hand instead. If you can\'t, you lose the game.\nIf a card would be put into your graveyard from anywhere, exile that card instead.', undefined, '{0}');
const INSIGHT = card('Test Insight', 'Sorcery', 'Draw a card.');
const SPARK = card('Test Spark', 'Sorcery', 'Test Spark deals 1 damage to target player.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['4', '4']);

const DRAWER = card('Test Gift', 'Sorcery', 'Target player draws a card.');
const STRIKE = card('Test Edictlet', 'Sorcery', 'Target player discards a card.');

describe('CR 614.1a, 614.6, 121.1, 104.3e: "If you would draw a card, return a card from your graveyard to your hand instead. If you can\'t, you lose the game."', () => {
  const game = (graveyard: string[]) => cast(mpScenario({ defs: [CRYPT, INSIGHT, DRAWER, STRIKE, BEAR, OX], zones: { p1: { hand: ['Test Crypt', 'Test Insight', 'Test Gift', 'Test Edictlet'], graveyard }, p2: { hand: ['Test Bear'] } } }), 'Test Crypt');
  it('is automated', () => expect(full(CRYPT), JSON.stringify(CRYPT.automation)).toBe(true));
  it('a draw returns the card of your graveyard you pick to your hand instead; the library is untouched', () => {
    const s0 = game(['Test Bear', 'Test Ox']);
    const ox = find(s0, 'Test Ox', 'graveyard', 'p1');
    const libBefore = lib(s0, 'p1').length;
    const s = cast(s0, 'Test Insight', { picks: [[ox]] });
    expect(inHand(s, 'p1', 'Test Ox')).toBe(true);
    expect(inHand(s, 'p1', 'Test Bear')).toBe(false);
    expect(yard(s, 'p1')).toContain('Test Bear');
    expect(lib(s, 'p1').length).toBe(libBefore);
    expect(lost(s, 'p1')).toBe(false);
  });
  it('negative: with nothing to return (the spell itself is exiled, not put into the graveyard), you lose the game', () => {
    const s = cast(game([]), 'Test Insight');
    expect(lost(s, 'p1')).toBe(true);
    expect(lost(s, 'p2')).toBe(false);
  });
  it('negative: an opponent\'s draw is not replaced (only yours): the opponent draws normally and does not lose, and your graveyard is untouched', () => {
    const s0 = game(['Test Bear']);
    const libBefore = lib(s0, 'p2').length;
    const s = cast(s0, 'Test Gift', { targets: [[plr('p2')]] });
    expect(lib(s, 'p2').length).toBe(libBefore - 1);
    expect(lost(s, 'p2')).toBe(false);
    expect(inHand(s, 'p1', 'Test Bear')).toBe(false);
  });
  it('a card that would be put into your graveyard is exiled instead (the resolved spell too); an opponent\'s discarded card goes to the opponent\'s graveyard as usual', () => {
    const s0 = game(['Test Bear']);
    const a = cast(s0, 'Test Gift', { targets: [[plr('p1')]] });
    expect(yard(a, 'p1')).not.toContain('Test Gift');
    expect(exiled(a, 'Test Gift')).toHaveLength(1);
    const b = cast(s0, 'Test Edictlet', { targets: [[plr('p2')]] });
    expect(yard(b, 'p2')).toContain('Test Bear');
    expect(exiled(b, 'Test Bear')).toHaveLength(0);
    expect(exiled(b, 'Test Edictlet')).toHaveLength(1);
  });
});

describe('CR 614.1a, 303.4, 701.20a, 400.3: "If a card would be put into enchanted player\'s graveyard from anywhere, instead that card is revealed and put on the bottom of that player\'s library."', () => {
  const WHEEL = card('Test Wheel', 'Enchantment — Aura', 'Enchant player\nIf a card would be put into enchanted player\'s graveyard from anywhere, instead that card is revealed and put on the bottom of that player\'s library.');
  const game = () => mpScenario({ defs: [WHEEL, STRIKE, BEAR, OX], zones: { p1: { hand: ['Test Wheel', 'Test Edictlet', 'Test Edictlet'] }, p2: { hand: ['Test Bear'] }, p3: { hand: ['Test Ox'] } } });
  it('is automated', () => expect(full(WHEEL), JSON.stringify(WHEEL.automation)).toBe(true));
  it('the enchanted player\'s discarded card goes to the bottom of their library, not the graveyard; the Aura\'s controller\'s own spell and another player\'s card go to the graveyard', () => {
    const s0 = cast(game(), 'Test Wheel', { targets: [[plr('p2')]] });
    const a = cast(s0, 'Test Edictlet', { targets: [[plr('p2')]] });
    expect(yard(a, 'p2')).not.toContain('Test Bear');
    expect(lib(a, 'p2').at(-1)).toBe('Test Bear');
    expect(yard(a, 'p1')).toContain('Test Edictlet'); // negative: not enchanted
    const b = cast(s0, 'Test Edictlet', { targets: [[plr('p3')]] });
    expect(yard(b, 'p3')).toContain('Test Ox');
    expect(lib(b, 'p3').at(-1)).toBe('Plains');
  });
});

describe('CR 701.16a, 608.2c, 109.4, 201.2: "Exile target creature and all other creatures its controller controls with the same name as that creature. That player investigates for each nontoken creature exiled this way."', () => {
  const DECL = card('Test Edict', 'Sorcery', 'Exile target creature and all other creatures its controller controls with the same name as that creature. That player investigates for each nontoken creature exiled this way.', undefined, '{0}');
  const TWIN = card('Test Twin', 'Creature — Soldier', '', ['1', '1']);
  const OTHER = card('Test Other', 'Creature — Soldier', '', ['1', '1']);
  const game = () => mpScenario({ defs: [DECL, TWIN, OTHER, BEAR], zones: { p1: { hand: ['Test Edict'], battlefield: ['Test Twin'] }, p2: { battlefield: ['Test Twin', 'Test Twin', 'Test Other'] }, p3: { battlefield: ['Test Twin'] } } });
  const clues = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p).length;
  it('is automated', () => expect(full(DECL), JSON.stringify(DECL.automation)).toBe(true));
  it('exiles the target and the other creatures of the same name its controller controls, and only those; the controller investigates once for each', () => {
    const s0 = game();
    const [t1] = findAll(s0, 'Test Twin', 'battlefield', 'p2') as [ObjectId, ObjectId];
    const s = cast(s0, 'Test Edict', { targets: [[obj(t1)]] });
    expect(findAll(s, 'Test Twin', 'battlefield', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Other', 'battlefield', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Twin', 'battlefield', 'p1')).toHaveLength(1); // another player's creature of that name stays
    expect(findAll(s, 'Test Twin', 'battlefield', 'p3')).toHaveLength(1);
    expect(clues(s, 'p2')).toBe(2);
    expect(clues(s, 'p1')).toBe(0);
  });
  it('negative: a single creature with no namesake gives one Clue, and its own controller (not the caster) gets it', () => {
    const s0 = game();
    const other = find(s0, 'Test Other', 'battlefield', 'p2');
    const s = cast(s0, 'Test Edict', { targets: [[obj(other)]] });
    expect(findAll(s, 'Test Twin', 'battlefield', 'p2')).toHaveLength(2);
    expect(clues(s, 'p2')).toBe(1);
    expect(clues(s, 'p1')).toBe(0);
  });
});

describe('CR 607.2a, 108.3, 603.1: "At the beginning of your upkeep, you may put a card you own exiled with ~ into your hand."', () => {
  const HORIZONS = card('Test Horizons', 'Enchantment', 'When this enchantment enters, exile the top three cards of your library.\nAt the beginning of your upkeep, you may put a card you own exiled with this enchantment into your hand.', undefined, '{0}');
  const game = () => mpScenario({ defs: [HORIZONS, BEAR, OX], zones: { p1: { hand: ['Test Horizons'], library: ['Test Bear', 'Test Ox', 'Test Bear'] } } });
  it('is automated', () => expect(full(HORIZONS), JSON.stringify(HORIZONS.automation)).toBe(true));
  it('at your next upkeep you may take one of the exiled cards into your hand (the choice is yours); declining takes nothing', () => {
    const s0 = cast(game(), 'Test Horizons');
    expect(s0.zones.exile).toHaveLength(3);
    const ox = find(s0, 'Test Ox', 'exile');
    const up = toTurn(s0, 5);
    const taken = drain(up, queued({ picks: [[ox]], answers: [{ kind: 'yesNo', yes: true }] }));
    expect(inHand(taken, 'p1', 'Test Ox')).toBe(true);
    expect(taken.zones.exile).toHaveLength(2);
    const declined = drain(toTurn(s0, 5), queued({ answers: [{ kind: 'yesNo', yes: false }] }));
    expect(declined.zones.exile).toHaveLength(3);
  });
});

describe('CR 611.2a, 509.1b, 613.4c, 608.2h: "Target creature gets +1/+0 until end of turn for each creature you control and can\'t be blocked this turn."', () => {
  const RUSH = card('Test Rush', 'Sorcery', 'Target creature gets +1/+0 until end of turn for each creature you control and can\'t be blocked this turn.');
  const game = () => mpScenario({ defs: [RUSH, BEAR, OX], zones: { p1: { hand: ['Test Rush'], battlefield: ['Test Bear', 'Test Bear', 'Test Ox'] } } });
  it('is automated', () => expect(full(RUSH), JSON.stringify(RUSH.automation)).toBe(true));
  it('the target gets +1/+0 for each creature its caster controls (three), counted as it resolves, and ends the turn at 5/2', () => {
    const s0 = game();
    const [bear] = findAll(s0, 'Test Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s = cast(s0, 'Test Rush', { targets: [[obj(bear)]] });
    expect(pt(s, bear)).toBe('5/2');
  });
  it('negative: another creature is not pumped', () => {
    const s0 = game();
    const [bear, bear2] = findAll(s0, 'Test Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s = cast(s0, 'Test Rush', { targets: [[obj(bear)]] });
    expect(pt(s, bear2)).toBe('2/2');
  });
});

describe('CR 508.1h, 509.1d, 303.4, 602.1, 601.2f: Oppressive Rays — "Enchanted creature can\'t attack or block unless its controller pays {3}." and "Activated abilities of enchanted creature cost {3} more to activate."', () => {
  const RAYS = card('Test Rays', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can\'t attack or block unless its controller pays {3}.\nActivated abilities of enchanted creature cost {3} more to activate.', undefined, '{0}');
  const PRIEST = card('Test Priest', 'Creature — Cleric', '{T}: You gain 1 life.', ['1', '1']);
  const board = (): { s: GameState; priest: ObjectId; other: ObjectId } => {
    const s0 = mpScenario({ defs: [RAYS, PRIEST], zones: { p1: { battlefield: ['Test Priest', 'Test Priest', 'Plains', 'Plains', 'Plains'] } } });
    const [priest, other] = findAll(s0, 'Test Priest', 'battlefield', 'p1') as [ObjectId, ObjectId];
    return { s: attach(s0, 'Test Rays', priest), priest, other };
  };
  it('is automated', () => expect(full(RAYS), JSON.stringify(RAYS.automation)).toBe(true));
  it('the enchanted creature pays {3} to attack and {3} to block; another creature pays nothing', () => {
    const { s, priest, other } = board();
    expect(attackTaxes(s, [{ attacker: priest, defender: 'p2' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 3 }] }]);
    expect(blockTaxes(s, [{ blocker: priest, attacker: other }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 3 }] }]);
    expect(attackTaxes(s, [{ attacker: other, defender: 'p2' }])).toEqual([]);
    expect(blockTaxes(s, [{ blocker: other, attacker: priest }])).toEqual([]);
  });
  it('an activated ability of the enchanted creature costs {3} more (three Plains pay it), and the unenchanted creature\'s ability costs nothing extra', () => {
    const { s, priest, other } = board();
    const lifeOf = (x: GameState): number => x.players.find((p) => p.id === 'p1')!.life;
    const noMana = tweak(s, (t) => { for (const id of findAll(t, 'Plains', 'battlefield', 'p1')) t.objects[id]!.tapped = true; });
    expect(applyAction(noMana, { type: 'activate', player: 'p1', source: priest, ability: 'p:0:0' } as never).error).toBeDefined();
    const free = activate(noMana, other);
    expect(lifeOf(free)).toBe(lifeOf(noMana) + 1);
    const paid = activate(s, priest);
    expect(lifeOf(paid)).toBe(lifeOf(s) + 1);
    expect(findAll(paid, 'Plains', 'battlefield', 'p1').every((id) => paid.objects[id]!.tapped)).toBe(true);
  });
});
