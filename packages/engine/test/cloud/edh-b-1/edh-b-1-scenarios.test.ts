/**
 * Commander coordinator B, round edh-b-1: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.20a, 701.20e, 608.2d   "You may reveal a Goblin, Wizard, or legendary artifact card from among them and put it into your hand." (Acclaimed Contender)
 *   CR 701.20a, 608.2c            "You may reveal an Angel card, a Demon card, and/or a Dragon card from among them and put them into your hand." (Kaalia, Zenith Seeker)
 *   CR 701.20e, 401.4             "Put an Assassin, Pirate, or Vehicle card from among them into your hand and the rest on the bottom of your library in a random order." (Adewale)
 *   CR 701.17a, 700.6             "Mill three cards. You may put a historic card from among them into your hand." (Ballad of the Black Flag)
 *   CR 205.1b, 509.1b             "~ becomes a 2/2 blue and black Horror artifact creature until end of turn and can't be blocked this turn." (Dimir Keyrune)
 *   CR 613.1d, 613.4b, 205.1b     "... have base power and toughness 5/3 and are Juggernauts in addition to their other creature types." (Graaz)
 *   CR 613.1d, 613.1f, 613.4b     "... have base power and toughness 4/4, have flying, and are Angels in addition to their other types." (Sigarda's Summons)
 *   CR 205.3m, 613.1d             "~ is also a Cleric, Rogue, Warrior, and Wizard." (Burakos, Party Leader)
 *   CR 105.2b, 903.4a              "~ is all colors. This ability doesn't affect its color identity." (Fallaji Wayfarer)
 *   CR 701.23a, 101.2             "Your opponents can't search libraries." (Stranglehold)
 *   CR 701.56a                    "Time travel three times." (The Tenth Doctor)
 *   CR 613.1f, 613.4b             "target creature loses all abilities and has base power and toughness 0/1 until end of turn." (Warkite Marauder)
 *   CR 205.1b, 613.1f             "Target artifact becomes a 9/9 Construct artifact creature and gains vigilance, indestructible, and ..." (Vronos, Masked Inquisitor)
 *   CR 207.2c                     "Bring it Down! -- ..." (Company Commander): an ability word with "it" in its title
 *   CR 611.2a, 613.4c, 122.1      "Until end of turn, other Elves you control gain vigilance and get +1/+1 for each +1/+1 counter on ~." (Haldir)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, put } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

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

/** The ids of the options of a pending object choice. */
const choices = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? s.pending.options : []);
const nameIn = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
/** Resolve the stack, answering each object choice with `picks` in turn (the ids chosen from what is offered by name) and recording what was offered. */
function resolveDig(s0: GameState, picks: string[][], offered: string[][] = []): GameState {
  let s = s0;
  const queue = picks.map((p) => [...p]);
  for (let g = 0; g < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    if (s.pending?.kind === 'chooseObjects') {
      const opts = s.pending.options;
      offered.push(opts.map((id) => nameIn(s, id)));
      const want = queue.shift() ?? [];
      const ids = want.map((n) => opts.find((id) => nameIn(s, id) === n)!);
      s = answer(s, { kind: 'chooseObjects', ids });
    } else if (s.pending?.kind === 'priority') s = pass(s);
    else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const castNamed = (s: GameState, name: string): GameState => act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never);
const handNames = (s: GameState, p = 'p1'): string[] => s.zones.hand[p]!.map((id) => nameIn(s, id)).sort();
const libNames = (s: GameState, p = 'p1'): string[] => s.zones.library[p]!.map((id) => nameIn(s, id));

const GOBLIN = card('Test Goblin Raider', 'Creature — Goblin', '', ['1', '1']);
const WIZARD = card('Test Wizard Adept', 'Creature — Wizard', '', ['1', '1']);
const BEAR = card('Test Bear Cub', 'Creature — Bear', '', ['2', '2']);
const RELIC = card('Test Grand Relic', 'Legendary Artifact', '');
const TRINKET = card('Test Trinket', 'Artifact', '');
const ANGEL = card('Test Angel Herald', 'Creature — Angel', '', ['2', '2']);
const DEMON = card('Test Demon Herald', 'Creature — Demon', '', ['2', '2']);
const DRAGON = card('Test Dragon Herald', 'Creature — Dragon', '', ['2', '2']);
const ANGELDEMON = card('Test Angel Demon', 'Creature — Angel Demon', '', ['2', '2']);
const SCOUT = card('Test Assassin Scout', 'Creature — Assassin', '', ['1', '1']);
const CART = card('Test War Cart', 'Artifact — Vehicle', '');
const SEEKER = card('Test Seeker', 'Creature — Human', 'When ~ enters, look at the top five cards of your library. You may reveal a Goblin, Wizard, or legendary artifact card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', ['1', '1']);
const HERALDS = card('Test Heraldist', 'Creature — Human', 'When ~ enters, look at the top five cards of your library. You may reveal an Angel card, a Demon card, and/or a Dragon card from among them and put them into your hand. Put the rest on the bottom of your library in a random order.', ['1', '1']);
const BREAKER = card('Test Breaker', 'Creature — Human', 'When ~ enters, reveal the top four cards of your library. Put an Assassin, Pirate, or Vehicle card from among them into your hand and the rest on the bottom of your library in a random order.', ['1', '1']);
const BALLAD = card('Test Ballad', 'Sorcery', 'Mill three cards. You may put a historic card from among them into your hand.');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [SEEKER, HERALDS, BREAKER, BALLAD]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.20a, 701.20e, 608.2d: "You may reveal a Goblin, Wizard, or legendary artifact card from among them and put it into your hand."', () => {
  const game = () => mpScenario({ defs: [SEEKER, GOBLIN, WIZARD, BEAR, RELIC, TRINKET], zones: { p1: { hand: ['Test Seeker'], library: ['Plains', 'Test Bear Cub', 'Test Goblin Raider', 'Test Trinket', 'Test Grand Relic', 'Test Wizard Adept'] } } });
  it('a Goblin, a Wizard and a legendary artifact are offered; a Bear and a nonlegendary artifact are not; the chosen card goes to the hand and the rest to the bottom', () => {
    const offered: string[][] = [];
    const s = resolveDig(castNamed(game(), 'Test Seeker'), [['Test Grand Relic']], offered);
    expect(offered).toEqual([['Test Goblin Raider', 'Test Grand Relic', 'Test Wizard Adept']]);
    expect(handNames(s)).toContain('Test Grand Relic');
    expect(libNames(s).slice(-4).sort()).toEqual(['Test Bear Cub', 'Test Goblin Raider', 'Test Trinket', 'Test Wizard Adept']);
  });
  it('choosing nothing is allowed ("you may"): the hand gets nothing and the five cards all go to the bottom', () => {
    const s = resolveDig(castNamed(game(), 'Test Seeker'), [[]]);
    expect(handNames(s)).not.toContain('Test Grand Relic');
    expect(libNames(s).slice(-5)).toHaveLength(5);
    expect(libNames(s).slice(-5)).toEqual(expect.arrayContaining(['Test Grand Relic', 'Test Bear Cub']));
  });
});

describe('CR 701.20a, 608.2c: "You may reveal an Angel card, a Demon card, and/or a Dragon card from among them and put them into your hand."', () => {
  const game = () => mpScenario({ defs: [HERALDS, ANGEL, DEMON, DRAGON, ANGELDEMON, BEAR], zones: { p1: { hand: ['Test Heraldist'], library: ['Plains', 'Test Angel Demon', 'Test Angel Herald', 'Test Demon Herald', 'Test Dragon Herald', 'Test Bear Cub'] } } });
  it('up to one card of each kind: an Angel, a Demon and a Dragon go to the hand together; the Bear goes to the bottom', () => {
    const s = resolveDig(castNamed(game(), 'Test Heraldist'), [['Test Angel Herald'], ['Test Demon Herald'], ['Test Dragon Herald']]);
    expect(handNames(s)).toEqual(expect.arrayContaining(['Test Angel Herald', 'Test Demon Herald', 'Test Dragon Herald']));
    expect(handNames(s)).not.toContain('Test Bear Cub');
    expect(libNames(s).slice(-2).sort()).toEqual(['Test Angel Demon', 'Test Bear Cub']);
  });
  it('one card cannot be two of the choices: after the Angel Demon is taken as the Angel, the Demon choice does not offer it', () => {
    const offered: string[][] = [];
    const s = resolveDig(castNamed(game(), 'Test Heraldist'), [['Test Angel Demon'], [], []], offered);
    expect(offered[0]).toEqual(['Test Angel Demon', 'Test Angel Herald']);
    expect(offered[1]).toEqual(['Test Demon Herald']);
    expect(handNames(s).filter((n) => n.startsWith('Test Angel Demon'))).toHaveLength(1);
  });
});

describe('CR 701.20e, 401.4: "Put an Assassin, Pirate, or Vehicle card from among them into your hand and the rest on the bottom of your library in a random order."', () => {
  const game = (lib: string[]) => mpScenario({ defs: [BREAKER, SCOUT, CART, BEAR, GOBLIN], zones: { p1: { hand: ['Test Breaker'], library: ['Plains', ...lib] } } });
  it('one matching card is put into the hand (a Vehicle counts) and the other three go to the bottom', () => {
    const s = resolveDig(castNamed(game(['Test Bear Cub', 'Test War Cart', 'Test Goblin Raider', 'Test Assassin Scout']), 'Test Breaker'), [['Test War Cart']]);
    expect(handNames(s)).toContain('Test War Cart');
    expect(libNames(s).slice(-3).sort()).toEqual(['Test Assassin Scout', 'Test Bear Cub', 'Test Goblin Raider']);
  });
  it('with no matching card among the four nothing is put into the hand and all four go to the bottom', () => {
    const s = resolveDig(castNamed(game(['Test Bear Cub', 'Test Goblin Raider', 'Test Bear Cub', 'Test Goblin Raider']), 'Test Breaker'), []);
    expect(handNames(s).filter((n) => n !== 'Plains')).toEqual([]);
    expect(libNames(s).slice(-4)).toEqual(expect.arrayContaining(['Test Bear Cub', 'Test Goblin Raider']));
  });
});

describe('CR 701.17a, 700.6: "Mill three cards. You may put a historic card from among them into your hand."', () => {
  const game = () => mpScenario({ defs: [BALLAD, RELIC, BEAR, TRINKET, GOBLIN], zones: { p1: { hand: ['Test Ballad'], library: ['Plains', 'Test Bear Cub', 'Test Trinket', 'Test Goblin Raider', 'Test Grand Relic'] } } });
  it('an artifact (historic) of the three milled cards may be taken; a Bear (not historic) is not offered; the fourth card is not milled and not offered', () => {
    const offered: string[][] = [];
    const s = resolveDig(castNamed(game(), 'Test Ballad'), [['Test Trinket']], offered);
    expect(offered).toEqual([['Test Trinket']]);
    expect(handNames(s)).toContain('Test Trinket');
    expect(s.zones.graveyard['p1']!.map((id) => nameIn(s, id))).toEqual(expect.arrayContaining(['Test Bear Cub', 'Test Goblin Raider']));
    expect(libNames(s)[0]).toBe('Test Grand Relic');
  });
});

const KEYRUNE = card('Test Keyrune', 'Artifact', '{T}: Add {U} or {B}.\n{0}: ~ becomes a 2/2 blue and black Horror artifact creature until end of turn and can\'t be blocked this turn.');
const PLAINRUNE = card('Test Plainrune', 'Artifact', '{0}: ~ becomes a 3/3 green and white Wolf artifact creature until end of turn.');
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '9']);
describe('CR 205.1b, 509.1b, 611.2a: "~ becomes a 2/2 blue and black Horror artifact creature until end of turn and can\'t be blocked this turn."', () => {
  it('is automated', () => expect([KEYRUNE, PLAINRUNE].every(full)).toBe(true));
  const game = () => tweak(mpScenario({ defs: [KEYRUNE, WALL], zones: { p1: { battlefield: ['Test Keyrune'] }, p2: { battlefield: ['Test Wall'] } } }), (s) => {
    for (const id of s.zones.battlefield) if (s.objects[id]!.controller === 'p1') s.objects[id]!.controlledSinceTurn = -1; // not summoning sick: it may attack
  });
  it('it is a 2/2 blue and black Horror artifact creature that no creature can block this turn', () => {
    const s0 = game();
    const rune = byName(s0, 'Test Keyrune');
    const s1 = activate(s0, rune, {}, 'p:0:1');
    expect(stat(s1, rune)).toBe('2/2');
    expect(hasType(s1, rune, 'Creature')).toBe(true);
    expect(hasType(s1, rune, 'Artifact')).toBe(true);
    expect(getChars(s1, rune)!.subtypes).toContain('Horror');
    expect([...getChars(s1, rune)!.colors].sort()).toEqual(['B', 'U']);
    const s2 = passUntil(declareAttackers(toDeclareAttackers(s1), [[rune]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'end' || x.turn.number > 1, 'blockers');
    expect(s2.pending?.kind === 'declareBlockers' ? JSON.stringify(s2.pending) : '').not.toContain(`"${byName(s2, 'Test Wall')}"`);
  });
  it('without the second half the same ability leaves the creature blockable, and the effect ends at the end of the turn', () => {
    const s0 = tweak(mpScenario({ defs: [PLAINRUNE, WALL], zones: { p1: { battlefield: ['Test Plainrune'] }, p2: { battlefield: ['Test Wall'] } } }), (s) => { for (const id of s.zones.battlefield) s.objects[id]!.controlledSinceTurn = -1; });
    const rune = byName(s0, 'Test Plainrune');
    const s1 = activate(s0, rune, {}, 'p:0:0');
    expect(stat(s1, rune)).toBe('3/3');
    const s2 = passUntil(declareAttackers(toDeclareAttackers(s1), [[rune]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(JSON.stringify(s2.pending)).toContain(byName(s2, 'Test Wall'));
    const s3 = toTurn(s1, 2);
    expect(hasType(s3, rune, 'Creature')).toBe(false);
  });
});

const GRAAZ = card('Test Juggernaut King', 'Legendary Artifact Creature — Juggernaut', 'Other creatures you control have base power and toughness 5/3 and are Juggernauts in addition to their other creature types.', ['5', '5']);
const SUMMONS = card('Test Choir', 'Enchantment', 'Creatures you control with +1/+1 counters on them have base power and toughness 4/4, have flying, and are Angels in addition to their other types.');
const ELF = card('Test Elf Scout', 'Creature — Elf', '', ['1', '1']);
describe('CR 613.1d, 613.4b: "... have base power and toughness N/M and are <Type> in addition to their other creature types"', () => {
  it('are automated', () => expect([GRAAZ, SUMMONS].every(full)).toBe(true));
  it('every OTHER creature you control is a 5/3 Juggernaut and keeps its types; the source itself and an opponent\'s creature are unchanged', () => {
    const s = mpScenario({ defs: [GRAAZ, ELF], zones: { p1: { battlefield: ['Test Juggernaut King', 'Test Elf Scout'] }, p2: { battlefield: ['Test Elf Scout'] } } });
    const elf = byName(s, 'Test Elf Scout', 'battlefield', 'p1');
    expect(stat(s, elf)).toBe('5/3');
    expect(getChars(s, elf)!.subtypes).toEqual(expect.arrayContaining(['Elf', 'Juggernaut']));
    expect(stat(s, byName(s, 'Test Juggernaut King'))).toBe('5/5');
    expect(stat(s, byName(s, 'Test Elf Scout', 'battlefield', 'p2'))).toBe('1/1');
  });
  it('only creatures with a +1/+1 counter become 4/4 flying Angels; one without a counter does not', () => {
    const s = mpScenario({ defs: [SUMMONS, ELF], zones: { p1: { battlefield: ['Test Choir', { name: 'Test Elf Scout', counters: { '+1/+1': 1 } } as never, 'Test Elf Scout'] } } });
    const [withCounter, without] = s.zones.battlefield.filter((id) => nameIn(s, id) === 'Test Elf Scout');
    expect(stat(s, withCounter!)).toBe('5/5'); // base 4/4 (layer 7b), then the counter's +1/+1 (7d)
    expect(kw(s, withCounter!)).toContain('flying');
    expect(getChars(s, withCounter!)!.subtypes).toEqual(expect.arrayContaining(['Elf', 'Angel']));
    expect(stat(s, without!)).toBe('1/1');
    expect(kw(s, without!)).not.toContain('flying');
  });
});

const PARTY = card('Test Party Leader', 'Legendary Creature — Orc', '~ is also a Cleric, Rogue, Warrior, and Wizard.', ['2', '2']);
const SHIFTER = card('Test Prism Shifter', 'Creature — Shapeshifter', "~ is all colors. This ability doesn't affect its color identity.", ['2', '2']);
describe('CR 205.3m, 105.2b, 903.4a: "~ is also a Cleric, Rogue, Warrior, and Wizard." and "~ is all colors."', () => {
  it('are automated', () => expect([PARTY, SHIFTER].every(full)).toBe(true));
  it('the Orc is also each of the four and keeps being an Orc', () => {
    const s = mpScenario({ defs: [PARTY], zones: { p1: { battlefield: ['Test Party Leader'] } } });
    expect(getChars(s, byName(s, 'Test Party Leader'))!.subtypes).toEqual(expect.arrayContaining(['Orc', 'Cleric', 'Rogue', 'Warrior', 'Wizard']));
  });
  it('a characteristic-defining ability (CR 604.3) works in every zone: the card in hand is all five colors and has the four types too; the color identity of its definition is unchanged', () => {
    const s = mpScenario({ defs: [SHIFTER, PARTY], zones: { p1: { battlefield: ['Test Prism Shifter'], hand: ['Test Prism Shifter', 'Test Party Leader'] } } });
    expect([...getChars(s, byName(s, 'Test Prism Shifter'))!.colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect([...getChars(s, byName(s, 'Test Prism Shifter', 'hand'))!.colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(getChars(s, byName(s, 'Test Party Leader', 'hand'))!.subtypes).toEqual(expect.arrayContaining(['Cleric', 'Rogue', 'Warrior', 'Wizard']));
    expect(s.defs['Test Prism Shifter']!.colorIdentity ?? []).toEqual([]);
  });
});

const HOLD = card('Test Strangler', 'Enchantment', 'Your opponents can\'t search libraries.');
const FETCH = card('Test Fetch Spell', 'Sorcery', 'Search your library for a basic land card, put it onto the battlefield, then shuffle.');
describe('CR 701.23a, 101.2: "Your opponents can\'t search libraries."', () => {
  it('is automated', () => expect([HOLD, FETCH].every(full)).toBe(true));
  const landsOf = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && nameIn(s, id) === 'Plains').length;
  it('the opponent of the permanent\'s controller finds nothing: the search is not made and no land comes', () => {
    const s = cast(mpScenario({ defs: [HOLD, FETCH], zones: { p1: { hand: ['Test Fetch Spell'], library: ['Plains'] }, p2: { battlefield: ['Test Strangler'] } } }), 'Test Fetch Spell');
    expect(landsOf(s, 'p1')).toBe(0);
  });
  it('negative: the controller of the permanent still searches, and with no such permanent the search works', () => {
    const own = resolveDig(castNamed(mpScenario({ defs: [HOLD, FETCH], zones: { p1: { hand: ['Test Fetch Spell'], battlefield: ['Test Strangler'], library: ['Plains'] } } }), 'Test Fetch Spell'), [['Plains']]);
    expect(landsOf(own, 'p1')).toBe(1);
    const none = resolveDig(castNamed(mpScenario({ defs: [FETCH], zones: { p1: { hand: ['Test Fetch Spell'], library: ['Plains'] } } }), 'Test Fetch Spell'), [['Plains']]);
    expect(landsOf(none, 'p1')).toBe(1);
  });
});

const DOCTOR = card('Test Chrono Engine', 'Artifact', '{0}: Time travel three times.');
const DIAL = card('Test Dial', 'Artifact', '{T}: You gain 1 life.');
describe('CR 701.56a: "Time travel three times." (three separate time travels)', () => {
  it('is automated', () => expect(full(DOCTOR)).toBe(true));
  const start = () => mpScenario({ defs: [DOCTOR, DIAL], zones: { p1: { battlefield: ['Test Chrono Engine', { name: 'Test Dial', counters: { time: 2 } } as never] } } });
  it('adding a counter each time: the permanent gets three more time counters in all; choosing to remove each time takes it down to zero (it stops at the counters it has)', () => {
    const run = (pick: 'add' | 'remove') => {
      let s = act(start(), { type: 'activate', player: 'p1', source: byName(start(), 'Test Chrono Engine'), ability: 'p:0:0' } as never);
      let asked = 0;
      for (let g = 0; g < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
        const d = s.pending;
        if (d?.kind === 'chooseOption') { asked++; s = answer(s, { kind: 'chooseOption', ids: [d.options.find((o) => o.id === pick)?.id ?? d.options[0]!.id] }); }
        else if (d?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else if (d?.kind === 'priority') s = pass(s);
        else break;
      }
      return { s, asked };
    };
    const up = run('add');
    expect(up.asked).toBe(3);
    expect(Object.values(up.s.objects).find((o) => nameIn(up.s, o.id) === 'Test Dial')!.counters['time']).toBe(5);
    const down = run('remove');
    expect(Object.values(down.s.objects).find((o) => nameIn(down.s, o.id) === 'Test Dial')!.counters['time'] ?? 0).toBe(0);
  });
});

const MARAUDER = card('Test Marauder', 'Creature — Human Pirate', 'Whenever ~ attacks, target creature defending player controls loses all abilities and has base power and toughness 0/1 until end of turn.', ['2', '2']);
const GUARD = card('Test Guard', 'Creature — Soldier', 'Vigilance', ['3', '3']);
describe('CR 613.1f, 613.4b, 611.2a: "target creature defending player controls loses all abilities and has base power and toughness 0/1 until end of turn."', () => {
  it('is automated', () => expect(full(MARAUDER)).toBe(true));
  it('the targeted creature has no abilities and is 0/1 for the turn; another creature of the defender is unchanged; it recovers at end of turn', () => {
    const s0 = tweak(mpScenario({ defs: [MARAUDER, GUARD], zones: { p1: { battlefield: ['Test Marauder'] }, p2: { battlefield: ['Test Guard', 'Test Guard'] } } }), (s) => { for (const id of s.zones.battlefield) s.objects[id]!.controlledSinceTurn = -1; });
    const [g1, g2] = s0.zones.battlefield.filter((id) => nameIn(s0, id) === 'Test Guard');
    let s = declareAttackers(toDeclareAttackers(s0), [[byName(s0, 'Test Marauder')]]);
    s = settle(s, { targets: [[obj(g1!)]] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.pending?.kind === 'priority' && x.zones.stack.length === 0, 'resolved');
    expect(stat(s, g1!)).toBe('0/1');
    expect(kw(s, g1!)).not.toContain('vigilance');
    expect(stat(s, g2!)).toBe('3/3');
    expect(kw(s, g2!)).toContain('vigilance');
  });
});

const VRONOS = card('Test Inquisitor', 'Legendary Planeswalker — Test', '−1: Target artifact you control becomes a 9/9 Construct artifact creature and gains vigilance, indestructible, and "This creature can\'t be blocked."', undefined, '{0}', '7');
const GADGET = card('Test Gadget', 'Artifact — Equipment', '');
describe('CR 205.1b, 613.1f, 613.4b: "Target artifact you control becomes a 9/9 Construct artifact creature and gains vigilance, indestructible, and ..."', () => {
  it('is automated', () => expect(full(VRONOS)).toBe(true));
  it('the artifact is a 9/9 Construct artifact creature with the keywords for good (not just this turn); the planeswalker\'s other artifacts are unchanged', () => {
    const s0 = mpScenario({ defs: [VRONOS, GADGET], zones: { p1: { battlefield: [{ name: 'Test Inquisitor', counters: { loyalty: 7 } } as never, 'Test Gadget', 'Test Gadget'] } } });
    const [a, b] = s0.zones.battlefield.filter((id) => nameIn(s0, id) === 'Test Gadget');
    const s1 = activate(s0, byName(s0, 'Test Inquisitor'), { targets: [[obj(a!)]] }, 'p:0:0');
    expect(stat(s1, a!)).toBe('9/9');
    expect(hasType(s1, a!, 'Creature')).toBe(true);
    expect(hasType(s1, a!, 'Artifact')).toBe(true);
    expect(getChars(s1, a!)!.subtypes).toContain('Construct');
    expect(getChars(s1, a!)!.subtypes).toContain('Equipment'); // the ruling: only creature types are replaced; an artifact subtype stays
    expect(kw(s1, a!)).toEqual(expect.arrayContaining(['vigilance', 'indestructible']));
    expect(hasType(s1, b!, 'Creature')).toBe(false);
    const s2 = toTurn(s1, 2);
    expect(stat(s2, a!)).toBe('9/9');
  });
});

const COMMANDER = card('Test Company Captain', 'Creature — Human Soldier', 'Bring it Down! -- Whenever this creature attacks, creatures you control gain deathtouch until end of turn.', ['2', '2']);
describe('CR 207.2c: an ability word with "it" in its title ("Bring it Down! -- ...") is a label with no rules meaning; the ability after it plays', () => {
  it('is automated, and the attack trigger gives every creature you control deathtouch for the turn', () => {
    expect(full(COMMANDER)).toBe(true);
    const s0 = tweak(mpScenario({ defs: [COMMANDER, GUARD], zones: { p1: { battlefield: ['Test Company Captain', 'Test Guard'] } } }), (s) => { for (const id of s.zones.battlefield) s.objects[id]!.controlledSinceTurn = -1; });
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[byName(s0, 'Test Company Captain')]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'declareBlockers' || x.turn.step === 'combatDamage', 'trigger resolved');
    expect(kw(s, byName(s, 'Test Guard'))).toContain('deathtouch');
  });
});

const ELDER = card('Test Elf Elder', 'Legendary Creature — Elf Soldier', '{0}: Until end of turn, other Elves you control gain vigilance and get +1/+1 for each +1/+1 counter on ~.', ['2', '2']);
describe('CR 611.2a, 613.4c, 122.1: "Until end of turn, other Elves you control gain vigilance and get +1/+1 for each +1/+1 counter on ~."', () => {
  it('is automated', () => expect(full(ELDER)).toBe(true));
  it('with two counters on the source, each other Elf gets +2/+2 and vigilance; the source itself, a non-Elf and an opponent\'s Elf do not', () => {
    const s0 = mpScenario({ defs: [ELDER, ELF, BEAR], zones: { p1: { battlefield: [{ name: 'Test Elf Elder', counters: { '+1/+1': 2 } } as never, 'Test Elf Scout', 'Test Bear Cub'] }, p2: { battlefield: ['Test Elf Scout'] } } });
    const s = activate(s0, byName(s0, 'Test Elf Elder'), {}, 'p:0:0');
    expect(stat(s, byName(s, 'Test Elf Scout', 'battlefield', 'p1'))).toBe('3/3');
    expect(kw(s, byName(s, 'Test Elf Scout', 'battlefield', 'p1'))).toContain('vigilance');
    expect(stat(s, byName(s, 'Test Elf Elder'))).toBe('4/4');
    expect(stat(s, byName(s, 'Test Bear Cub'))).toBe('2/2');
    expect(stat(s, byName(s, 'Test Elf Scout', 'battlefield', 'p2'))).toBe('1/1');
  });
});
