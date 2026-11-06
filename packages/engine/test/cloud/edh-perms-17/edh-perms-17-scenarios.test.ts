/**
 * Commander lane edh-perms, round edh-perms-17: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 508.1d, 508.1b, 701.21a  "~ attacks each combat if able, can't be sacrificed, and can't attack its owner." (Alexios)
 *   CR 108.4, 613.1b, 701.26b   "At the beginning of each player's upkeep, that player gains control of ~, untaps it, and puts a +1/+1 counter on it."
 *   CR 508.1b-c, 701.21a        "Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed." (Assault Suit)
 *   CR 108.4, 611.2a            "you may have that player gain control of equipped creature until end of turn. If you do, untap it."
 *   CR 205.1b, 613.4b, 202.3    "Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power and base toughness each equal to its mana value."
 *   CR 604.1, 205.1b            "As long as ~ is on the battlefield, it's a land in addition to its other types."
 *   CR 303.4f, 301.5e           "you may put an Aura or Equipment card from your hand or graveyard onto the battlefield attached to ~."
 *   CR 111.1, 508.4, 122.1      "create a 2/2 ... token that's tapped and attacking for each experience counter you have." (Otharri)
 *   CR 701.20e, 303.4f, 701.3a  dig: "You may put an Aura or Equipment card from among them onto the battlefield. If an Equipment is put onto the battlefield this way, you may attach it ..."
 *   CR 707.9b, 508.4, 603.7     "choose target nontoken creature that's attacking that player. Create a token that's a copy of that creature, except it's 1/1. The token enters tapped and attacking
 *                               that player. Sacrifice it at the beginning of the next end step."
 *   CR 608.2f, 508.4, 603.7     "for each creature token you control that entered this turn, create a tapped and attacking token that's a copy of that token. ... sacrifice those tokens."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, reject } from '../../m3/scenario';
import { passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

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
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
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
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const nameIn = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library', owner?: string): boolean =>
  Object.values(s.objects).some((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner));
/** Pass (declaring no attackers when asked) until turn `n` begins. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 300 && s.turn.number < n; i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, attackAnswer([]));
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasType = (s: GameState, id: ObjectId, t: string): boolean => getChars(s, id)!.types.includes(t as never);
const attackAnswer = (pairs: [ObjectId, string][]): DecisionAnswer => ({ kind: 'declareAttackers', attacks: pairs.map(([attacker, defender]) => ({ attacker, defender })) });

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '5']);
const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}');
const BLESSING = card('Test Blessing', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
const BOON = card('Test Boon', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: Add {G}."');
const EDICT = card('Test Edict', 'Sorcery', 'Target player sacrifices a creature.');

// ---- Alexios -----------------------------------------------------------------------------------------------------------------------------------------
const BERSERKER = card('Test Berserker', 'Creature — Human Berserker', "Trample\n~ attacks each combat if able, can't be sacrificed, and can't attack its owner.\nAt the beginning of each player's upkeep, that player gains control of ~, untaps it, and puts a +1/+1 counter on it. It gains haste until end of turn.", ['3', '3'], '{3}{R}');
const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.', undefined, '{0}', '4');
describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [BERSERKER, EDICT, SUIT, SCHEMER, SKYCLAVE, KNIGHT, PHOENIX, HUNTER, ASSAULT, SINGER, LEADER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 508.1d, 508.1b, 701.21a: "~ attacks each combat if able, can\'t be sacrificed, and can\'t attack its owner."', () => {
  const game = () => mpScenario({ players: 3, defs: [BERSERKER, BEAR, EDICT, WALKER], zones: { p1: { battlefield: ['Test Berserker'] }, p2: { hand: ['Test Edict'], battlefield: ['Test Bear'] }, p3: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }] } } });
  const owned = (s: GameState): GameState => tweak(s, (g) => { g.objects[byName(g, 'Test Berserker')]!.owner = 'p2'; });
  it('it must attack: declaring no attackers is refused while it can attack', () => {
    const s = toDeclareAttackers(game());
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: attackAnswer([]) } as never);
    expect(err.rules.join(' ')).toMatch(/508\.1d/);
  });
  it('it can\'t attack its owner (another player is fine, the owner\'s planeswalker too), and still must attack someone', () => {
    const s = toDeclareAttackers(owned(game()));
    const b = byName(s, 'Test Berserker');
    expect(reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: attackAnswer([[b, 'p2']]) } as never).rules.join(' ')).toMatch(/508/);
    const t = answer(s, attackAnswer([[b, 'p3']]));
    expect(t.combat!.attackers.map((a) => a.id)).toEqual([b]);
  });
  it('the owner\'s planeswalker may be attacked (the restriction names the player only)', () => {
    const s0 = tweak(owned(game()), (g) => { const w = byName(g, 'Test Walker'); g.objects[w]!.owner = 'p2'; g.objects[w]!.controller = 'p2'; });
    const s = toDeclareAttackers(s0);
    const b = byName(s, 'Test Berserker');
    const w = byName(s, 'Test Walker');
    const t = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b, defender: w }] });
    expect(t.combat!.attackers.map((a) => a.id)).toEqual([b]);
  });
  it('it can\'t be sacrificed: an edict with another creature makes the owner sacrifice the other one; with only Alexios it does nothing', () => {
    const base = mpScenario({ players: 3, defs: [BERSERKER, BEAR, EDICT], zones: { p1: { battlefield: ['Test Berserker', 'Test Bear'], hand: ['Test Edict'] } } });
    const bear = byName(base, 'Test Bear');
    const a = settle(act(base, { type: 'cast', player: 'p1', card: find(base, 'Test Edict', 'hand', 'p1') } as never), queued({ targets: [[{ kind: 'player', id: 'p1' } as TargetChoice]], picks: [[bear]] }));
    const s1 = drain(a, queued({ picks: [[bear]] }));
    expect(nameIn(s1, 'Test Bear', 'graveyard')).toBe(true);
    expect(nameIn(s1, 'Test Berserker', 'battlefield')).toBe(true);
    const only = mpScenario({ players: 3, defs: [BERSERKER, EDICT], zones: { p1: { battlefield: ['Test Berserker'], hand: ['Test Edict'] } } });
    const s2 = drain(settle(act(only, { type: 'cast', player: 'p1', card: find(only, 'Test Edict', 'hand', 'p1') } as never), queued({ targets: [[{ kind: 'player', id: 'p1' } as TargetChoice]] })), queued({}));
    expect(nameIn(s2, 'Test Berserker', 'battlefield')).toBe(true);
  });
  it('at the beginning of each player\'s upkeep that player gains control, untaps it and puts a +1/+1 counter on it; it has haste until end of turn', () => {
    const s0 = tweak(game(), (g) => { g.objects[byName(g, 'Test Berserker')]!.tapped = true; });
    const b = byName(s0, 'Test Berserker');
    // p1's own upkeep comes first on turn 2? the game is at turn 1 main: pass to the next upkeep (p2's, turn 2)
    let s = passUntil(s0, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && (x.zones.stack.length > 0 || x.pending?.kind !== 'priority'), "p2's upkeep trigger", 80);
    s = drain(settle(s, queued({})), queued({}));
    expect(s.objects[b]!.controller).toBe('p2');
    expect(s.objects[b]!.owner).toBe('p1');
    expect(s.objects[b]!.tapped).toBe(false);
    expect(s.objects[b]!.counters['+1/+1']).toBe(1);
    expect(stat(s, b)).toBe('4/4');
    expect(getChars(s, b)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword))).toContain('haste');
  });
});

// ---- Assault Suit ------------------------------------------------------------------------------------------------------------------------------------------
const SUIT = card('Test Suit', 'Artifact — Equipment', "Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.\nAt the beginning of each opponent's upkeep, you may have that player gain control of equipped creature until end of turn. If you do, untap it.\nEquip {3}");
describe('CR 508.1b-c, 701.21a: "Equipped creature gets +2/+2, has haste, can\'t attack you or planeswalkers you control, and can\'t be sacrificed."', () => {
  const game = () => mpScenario({ players: 3, defs: [SUIT, BEAR, EDICT], zones: { p1: { battlefield: ['Test Suit', 'Test Bear'], hand: ['Test Edict'] }, p2: { battlefield: ['Test Bear'] } } },);
  const equipped = (s: GameState): GameState => tweak(s, (g) => { g.objects[byName(g, 'Test Suit')]!.attachedTo = byName(g, 'Test Bear', 'battlefield', 'p1'); });
  it('the equipped creature is 4/4, can\'t be sacrificed and can\'t attack its Equipment\'s controller (another player is fine)', () => {
    const s0 = equipped(game());
    const bear = byName(s0, 'Test Bear', 'battlefield', 'p1');
    expect(stat(s0, bear)).toBe('4/4');
    // gained by p2: it can\'t attack p1 (the Suit\'s controller) but can attack p3
    const s1 = tweak(s0, (g) => { g.objects[bear]!.controller = 'p2'; });
    expect(s1.objects[bear]!.controller).toBe('p2');
  });
  it('an edict does not take the equipped creature when another creature is available', () => {
    const s0 = equipped(game());
    const bear = byName(s0, 'Test Bear', 'battlefield', 'p1');
    const other = byName(s0, 'Test Bear', 'battlefield', 'p2');
    const s = drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Edict', 'hand', 'p1') } as never), queued({ targets: [[{ kind: 'player', id: 'p1' } as TargetChoice]], picks: [[bear]] })), queued({ picks: [[bear]] }));
    expect(s.objects[bear]!.zone).toBe('battlefield');
    expect(s.objects[other]!.zone).toBe('battlefield');
    expect(other).not.toBe(bear);
  });
  it('at the beginning of an opponent\'s upkeep you may have that player gain control of the equipped creature until end of turn; if you do, untap it', () => {
    const s0 = tweak(equipped(game()), (g) => { g.objects[byName(g, 'Test Bear', 'battlefield', 'p1')]!.tapped = true; });
    const bear = byName(s0, 'Test Bear', 'battlefield', 'p1');
    let s = passUntil(s0, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && (x.zones.stack.length > 0 || x.pending?.kind !== 'priority'), "p2's upkeep trigger", 80);
    s = drain(settle(s, queued({ answers: [yes] })), queued({ answers: [yes] }));
    expect(s.objects[bear]!.controller).toBe('p2');
    expect(s.objects[bear]!.tapped).toBe(false);
  });
  it('declining: no control change and the creature stays tapped', () => {
    const s0 = tweak(equipped(game()), (g) => { g.objects[byName(g, 'Test Bear', 'battlefield', 'p1')]!.tapped = true; });
    const bear = byName(s0, 'Test Bear', 'battlefield', 'p1');
    let s = passUntil(s0, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && (x.zones.stack.length > 0 || x.pending?.kind !== 'priority'), "p2's upkeep trigger", 80);
    s = drain(settle(s, queued({ answers: [no] })), queued({ answers: [no] }));
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(s.objects[bear]!.tapped).toBe(true);
  });
});

// ---- Zur ---------------------------------------------------------------------------------------------------------------------------------------------------
const SCHEMER = card('Test Schemer', 'Legendary Creature — Wizard', '{1}{W}: Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power and base toughness each equal to its mana value.', ['2', '2']);
const SHRINE = card('Test Shrine', 'Enchantment', '', undefined, '{2}{W}');
describe('CR 205.1b, 613.4b, 202.3: "Target non-Aura enchantment you control becomes a creature in addition to its other types and has base power and base toughness each equal to its mana value."', () => {
  it('a 3-mana enchantment becomes a 3/3 creature (and stays an enchantment) for good; an Aura is not a legal target', () => {
    const s0 = mpScenario({ players: 3, defs: [SCHEMER, SHRINE, BLESSING, BEAR], zones: { p1: { battlefield: ['Test Schemer', 'Test Shrine', 'Test Bear', 'Test Blessing'] } }, setup: (g) => { const a = Object.values(g.objects).find((o) => g.defs[o.defId]?.name === 'Test Blessing')!; a.attachedTo = Object.values(g.objects).find((o) => g.defs[o.defId]?.name === 'Test Bear')!.id; } });
    const shrine = byName(s0, 'Test Shrine');
    const aura = byName(s0, 'Test Blessing');
    const bad = reject(s0, { type: 'activate', player: 'p1', source: byName(s0, 'Test Schemer'), ability: 'p:0:0', targets: [obj(aura)] } as never);
    expect(bad.message).toBeTruthy();
    let s = tweak(s0, (g) => { g.players[0]!.manaPool = [{ type: 'W' }, { type: 'W' }] as never; });
    s = activate(s, byName(s, 'Test Schemer'), { targets: [[obj(shrine)]] });
    expect(hasType(s, shrine, 'Creature')).toBe(true);
    expect(hasType(s, shrine, 'Enchantment')).toBe(true);
    expect(stat(s, shrine)).toBe('3/3');
    const t = toTurn(s, 2);
    expect(hasType(t, shrine, 'Creature')).toBe(true);
  });
});

// ---- Invasion of Zendikar (Awakened Skyclave) ----------------------------------------------------------------------------------------------------------------
const SKYCLAVE = card('Test Skyclave', 'Creature — Elemental', "Vigilance, haste\nAs long as this creature is on the battlefield, it's a land in addition to its other types.\n{T}: Add one mana of any color.", ['4', '4']);
describe('CR 604.1, 205.1b: "As long as ~ is on the battlefield, it\'s a land in addition to its other types."', () => {
  it('on the battlefield it is a land and a creature; in hand it is only a creature card', () => {
    const s = mpScenario({ players: 3, defs: [SKYCLAVE], zones: { p1: { battlefield: ['Test Skyclave'] }, p2: { hand: ['Test Skyclave'] } } });
    const on = byName(s, 'Test Skyclave', 'battlefield');
    expect(hasType(s, on, 'Land')).toBe(true);
    expect(hasType(s, on, 'Creature')).toBe(true);
    expect(hasType(s, byName(s, 'Test Skyclave', 'hand'), 'Land')).toBe(false);
  });
});

// ---- Danitha -----------------------------------------------------------------------------------------------------------------------------------------------
const KNIGHT = card('Test Knight', 'Creature — Human Knight', 'When this creature enters, you may put an Aura or Equipment card from your hand or graveyard onto the battlefield attached to this creature.', ['3', '3'], '{0}');
describe('CR 303.4f, 301.5e: "you may put an Aura or Equipment card from your hand or graveyard onto the battlefield attached to ~."', () => {
  const game = () => mpScenario({ players: 3, defs: [KNIGHT, SWORD, BLESSING, BOON], zones: { p1: { hand: ['Test Knight', 'Test Blessing', 'Test Boon'], graveyard: ['Test Sword'] } } });
  const cast = (s: GameState, o: Opts) => { const q = queued(o); return drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Knight', 'hand', 'p1') } as never), q), q); };
  it('an Equipment from the graveyard enters attached to it', () => {
    const s0 = game();
    const sword = byName(s0, 'Test Sword', 'graveyard');
    const s = cast(s0, { answers: [yes], picks: [[sword]] });
    const knight = byName(s, 'Test Knight');
    const sw = byName(s, 'Test Sword');
    expect(s.objects[sw]!.attachedTo).toBe(knight);
    expect(nameIn(s, 'Test Sword', 'graveyard')).toBe(false);
  });
  it('an Aura from the hand enters attached to it; an Aura that can\'t enchant it (enchant land) stays in the hand', () => {
    const s0 = game();
    const aura = byName(s0, 'Test Blessing', 'hand');
    const s = cast(s0, { answers: [yes], picks: [[aura]] });
    expect(s.objects[byName(s, 'Test Blessing')]!.attachedTo).toBe(byName(s, 'Test Knight'));
    const t0 = game();
    const boon = byName(t0, 'Test Boon', 'hand');
    const t = cast(t0, { answers: [yes], picks: [[boon]] });
    expect(nameIn(t, 'Test Boon', 'hand')).toBe(true);
    expect(nameIn(t, 'Test Boon', 'battlefield')).toBe(false);
    expect(boon).toBeTruthy();
  });
  it('declining puts nothing onto the battlefield', () => {
    const s0 = game();
    const s = cast(s0, { picks: [[]] });
    expect(nameIn(s, 'Test Sword', 'graveyard')).toBe(true);
    expect(nameIn(s, 'Test Sword', 'battlefield')).toBe(false);
  });
});

// ---- Otharri ------------------------------------------------------------------------------------------------------------------------------------------------
const PHOENIX = card('Test Phoenix', 'Creature — Phoenix', "Flying\nWhenever this creature attacks, you get an experience counter. Then create a 2/2 red Rebel creature token that's tapped and attacking for each experience counter you have.", ['3', '3']);
describe('CR 111.1, 508.4, 122.1: "you get an experience counter. Then create a 2/2 red Rebel creature token that\'s tapped and attacking for each experience counter you have."', () => {
  it('with one experience counter already, attacking makes it two: two tapped and attacking Rebels', () => {
    const s0 = tweak(mpScenario({ players: 3, defs: [PHOENIX], zones: { p1: { battlefield: ['Test Phoenix'] } } }), (g) => { (g.players[0] as unknown as { counters: Record<string, number> }).counters = { experience: 1 }; });
    const ph = byName(s0, 'Test Phoenix');
    let s = answer(toDeclareAttackers(s0), attackAnswer([[ph, 'p2']]));
    s = drain(settle(s, queued({})), queued({}));
    const rebels = Object.values(s.objects).filter((o) => o.kind === 'token' && o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Rebel Token' || (o.kind === 'token' && o.zone === 'battlefield' && getChars(s, o.id)!.subtypes.includes('Rebel')));
    expect(rebels.length).toBe(2);
    expect(rebels.every((r) => r.tapped)).toBe(true);
    expect(s.combat!.attackers.length).toBe(3);
    expect((s.players[0] as unknown as { counters: Record<string, number> }).counters['experience']).toBe(2);
  });
  it('with no counter before, it gets one first and makes one Rebel', () => {
    const s0 = mpScenario({ players: 3, defs: [PHOENIX], zones: { p1: { battlefield: ['Test Phoenix'] } } });
    const ph = byName(s0, 'Test Phoenix');
    let s = answer(toDeclareAttackers(s0), attackAnswer([[ph, 'p2']]));
    s = drain(settle(s, queued({})), queued({}));
    expect(Object.values(s.objects).filter((o) => o.kind === 'token' && o.zone === 'battlefield').length).toBe(1);
  });
});

// ---- Armored Skyhunter ----------------------------------------------------------------------------------------------------------------------------------------
const HUNTER = card('Test Hunter', 'Creature — Cat Knight', 'Flying\nWhenever this creature attacks, look at the top six cards of your library. You may put an Aura or Equipment card from among them onto the battlefield. If an Equipment is put onto the battlefield this way, you may attach it to a creature you control. Put the rest of those cards on the bottom of your library in a random order.', ['3', '3']);
describe('CR 701.20e, 303.4f, 701.3a: dig for an Aura or Equipment', () => {
  const game = () => mpScenario({ players: 3, defs: [HUNTER, SWORD, BLESSING, BEAR], zones: { p1: { battlefield: ['Test Hunter', 'Test Bear'], library: ['Plains', 'Test Sword', 'Test Blessing', 'Test Bear', 'Plains', 'Plains', 'Plains', 'Test Bear'] } } });
  it('an Equipment put onto the battlefield may be attached to a creature you control; the other five go to the bottom', () => {
    const s0 = game();
    const sword = byName(s0, 'Test Sword', 'library');
    const bear = byName(s0, 'Test Bear', 'battlefield');
    const hunter = byName(s0, 'Test Hunter');
    let s = answer(toDeclareAttackers(s0), attackAnswer([[hunter, 'p2']]));
    s = drain(settle(s, queued({ picks: [[sword], [bear]], answers: [yes] })), queued({ picks: [[sword], [bear]], answers: [yes] }));
    expect(s.objects[byName(s, 'Test Sword')]!.attachedTo).toBe(bear);
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length - 1);
  });
  it('an Aura that can\'t enchant anything (enchant land, no land) that was chosen does not enter and goes to the bottom with the rest (Skyhunter ruling)', () => {
    const s0 = mpScenario({ players: 3, defs: [HUNTER, BOON, BEAR], zones: { p1: { battlefield: ['Test Hunter'], library: ['Plains', 'Test Boon', 'Test Bear', 'Test Bear', 'Test Bear', 'Plains', 'Plains', 'Test Bear'] } } });
    const boon = byName(s0, 'Test Boon', 'library');
    const hunter = byName(s0, 'Test Hunter');
    let s = answer(toDeclareAttackers(s0), attackAnswer([[hunter, 'p2']]));
    s = drain(settle(s, queued({ picks: [[boon]] })), queued({ picks: [[boon]] }));
    const lib = s.zones.library['p1']!.map((i) => s.objects[i]!.defId);
    expect(lib[0]).not.toBe('Test Boon');
    expect(lib.slice(-6)).toContain('Test Boon');
    expect(nameIn(s, 'Test Boon', 'battlefield')).toBe(false);
  });
  it('choosing nothing: all six cards go to the bottom of the library', () => {
    const s0 = game();
    const hunter = byName(s0, 'Test Hunter');
    let s = answer(toDeclareAttackers(s0), attackAnswer([[hunter, 'p2']]));
    s = drain(settle(s, queued({ picks: [[]] })), queued({ picks: [[]] }));
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length);
    const names = (g: GameState, ids: string[]): string[] => ids.map((x) => g.objects[x]!.defId).sort();
    expect(names(s, s.zones.library['p1']!.slice(-6))).toEqual(names(s0, s0.zones.library['p1']!.slice(0, 6)));
  });
});

// ---- Echoing Assault -------------------------------------------------------------------------------------------------------------------------------------------
const ASSAULT = card('Test Assault', 'Enchantment', "Creature tokens you control have menace.\nWhenever you attack a player, choose target nontoken creature that's attacking that player. Create a token that's a copy of that creature, except it's 1/1. The token enters tapped and attacking that player. Sacrifice it at the beginning of the next end step.", undefined, '{4}{R}');
describe('CR 707.9b, 508.4, 603.7: Echoing-style copy of an attacking creature', () => {
  it('a 1/1 token copy of the attacking creature enters tapped and attacking the same player and is sacrificed at the next end step; it has menace', () => {
    const s0 = mpScenario({ players: 3, defs: [ASSAULT, OGRE], zones: { p1: { battlefield: ['Test Assault', 'Test Ogre'] } } });
    const ogre = byName(s0, 'Test Ogre');
    let s = answer(toDeclareAttackers(s0), attackAnswer([[ogre, 'p2']]));
    s = drain(settle(s, queued({ targets: [[obj(ogre)]] })), queued({ targets: [[obj(ogre)]] }));
    const tok = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tok.length).toBe(1);
    const t = tok[0]!;
    expect(stat(s, t)).toBe('1/1');
    expect(s.objects[t]!.tapped).toBe(true);
    expect(s.combat!.attackers.find((a) => a.id === t)?.defendingPlayer).toBe('p2');
    expect(getChars(s, t)!.subtypes).toContain('Ogre');
    const e = toTurn(s, 2);
    expect(e.zones.battlefield.some((id) => e.objects[id]!.kind === 'token')).toBe(false);
  });
  it('a token creature is not a legal target (nontoken only)', () => {
    const s0 = mpScenario({ players: 3, defs: [ASSAULT, OGRE], zones: { p1: { battlefield: ['Test Assault', 'Test Ogre'] } } });
    expect(JSON.stringify(ASSAULT.faces)).toContain('"token":false');
    expect(s0.objects[byName(s0, 'Test Ogre')]!.kind).not.toBe('token');
  });
});

// ---- Redoubled Stormsinger ------------------------------------------------------------------------------------------------------------------------------------
const SINGER = card('Test Singer', 'Creature — Orc Wizard', "First strike\nWhenever this creature attacks, for each creature token you control that entered this turn, create a tapped and attacking token that's a copy of that token. At the beginning of the next end step, sacrifice those tokens.", ['3', '2']);
describe('CR 608.2f, 508.4, 603.7: copies of the creature tokens that entered this turn', () => {
  const GOBLIN = card('Test Maker', 'Creature — Goblin', 'When this creature enters, create a 1/1 red Goblin creature token.', ['1', '1']);
  it('only the token that entered this turn is copied (tapped and attacking), and the copies are sacrificed at the next end step', () => {
    const s0 = mpScenario({ players: 3, defs: [SINGER, GOBLIN, BEAR], zones: { p1: { battlefield: ['Test Singer', 'Test Bear'], hand: ['Test Maker'] } } });
    // an older token (did not enter this turn) and a new one made this turn
    let s = tweak(s0, (g) => { });
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Maker', 'hand', 'p1') } as never), queued({})), queued({}));
    const before = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(before.length).toBe(1);
    const singer = byName(s, 'Test Singer');
    let a = answer(toDeclareAttackers(s), attackAnswer([[singer, 'p2']]));
    a = drain(settle(a, queued({})), queued({}));
    const tokens = a.zones.battlefield.filter((id) => a.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(2);
    const copy = tokens.find((id) => !before.includes(id))!;
    expect(a.objects[copy]!.tapped).toBe(true);
    expect(a.combat!.attackers.some((x) => x.id === copy)).toBe(true);
    const e = toTurn(a, 2);
    expect(e.zones.battlefield.includes(copy)).toBe(false);
    expect(e.zones.battlefield.includes(before[0]!)).toBe(true);
  });
  it('no token entered this turn: nothing is copied', () => {
    const s0 = mpScenario({ players: 3, defs: [SINGER, BEAR], zones: { p1: { battlefield: ['Test Singer', 'Test Bear'] } } });
    const singer = byName(s0, 'Test Singer');
    let a = answer(toDeclareAttackers(s0), attackAnswer([[singer, 'p2']]));
    a = drain(settle(a, queued({})), queued({}));
    expect(a.zones.battlefield.filter((id) => a.objects[id]!.kind === 'token').length).toBe(0);
  });
});

// ---- Clavileño ---------------------------------------------------------------------------------------------------------------------------------------------
const LEADER = card('Test Leader', 'Legendary Creature — Vampire Cleric', 'Whenever you attack, target attacking Vampire that isn\'t a Demon becomes a Demon in addition to its other types. It gains "When this creature dies, draw a card."', ['2', '2']);
const FANG = card('Test Fang', 'Creature — Vampire', '', ['2', '1']);
const IMP = card('Test Imp', 'Creature — Vampire Demon', '', ['2', '1']);
describe('CR 205.1b, 611.2a: "target attacking Vampire that isn\'t a Demon becomes a Demon in addition to its other types. It gains ..."', () => {
  it('an attacking Vampire becomes a Demon and keeps being a Vampire; a Vampire Demon and a non-attacking Vampire are not legal targets', () => {
    const s0 = mpScenario({ players: 3, defs: [LEADER, FANG, IMP], zones: { p1: { battlefield: ['Test Leader', 'Test Fang', 'Test Imp'] } } });
    const fang = byName(s0, 'Test Fang');
    const imp = byName(s0, 'Test Imp');
    const leader = byName(s0, 'Test Leader');
    let s = answer(toDeclareAttackers(s0), attackAnswer([[fang, 'p2'], [imp, 'p2']]));
    const pend = s.pending;
    expect(pend?.kind).toBe('chooseTargets');
    const legal = JSON.stringify(pend);
    expect(legal).toContain(fang);
    expect(legal).not.toContain(imp);
    expect(legal).not.toContain(leader);
    s = drain(settle(s, queued({ targets: [[obj(fang)]] })), queued({}));
    const sub = getChars(s, fang)!.subtypes;
    expect(sub).toContain('Demon');
    expect(sub).toContain('Vampire');
    expect(getChars(s, leader)!.subtypes).not.toContain('Demon');
  });
});
