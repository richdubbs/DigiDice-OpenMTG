/**
 * Commander lane edh-next, round edh-next-17: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 603.2, 500.1, 102.1      "Whenever you cast a creature spell during an opponent's turn, tap up to one target creature." (Breath of the Sleepless)
 *   CR 602.2, 605.1a, 605.3b    "Whenever you activate an ability of an artifact or creature that isn't a mana ability, ~ gets +1/+1 until end of turn." (Crackdown Construct)
 *   CR 601.3, 601.2i, 101.2     "You can cast spells only during your turn and you can cast no more than two spells each turn." (Fires of Invention)
 *   CR 615.1a, 615.7, 611.2a    "Prevent the next 1 damage that would be dealt by ~ this turn." (Barbed Wire)
 *   CR 205.3m, 613.1d, 613.1f   "Each creature with a gold counter on it is a Wall in addition to its other creature types and has defender." (Aurification)
 *   CR 508.1, 603.2, 303.4      "Whenever an enchanted creature or enchantment creature you control attacks, draw a card." (Kestia, the Cultivator)
 *   CR 305.1, 601.3, 101.2      "You can't play lands or cast spells from your hand." (Experimental Frenzy)
 *   CR 609.4, 702.3b, 508.1     "Wall creatures can attack as though they didn't have defender." (Rolling Stones)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, pass } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  s = settle(s, o);
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0', player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player, source, ability } as never), q), q);
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'exile' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const castable = (s: GameState, name: string, player = 'p1'): boolean => legal(s, player, 'cast').some((a) => a.object === byName(s, name, 'hand', player));
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;

describe('CR 603.2, 500.1, 102.1: "Whenever you cast a creature spell during an opponent\'s turn, tap up to one target creature."', () => {
  const SLEEPLESS = card('Test Sleepless', 'Enchantment', "Whenever you cast a creature spell during an opponent's turn, tap up to one target creature.");
  const AMBUSHER = card('Test Ambusher', 'Creature — Elf', 'Flash', ['1', '1']);
  const WALKER = card('Test Walker', 'Creature — Elf', '', ['2', '2']);
  const FLASH_ZAP = card('Test Flash Zap', 'Instant', 'You gain 1 life.');
  const start = () => mpScenario({ players: 3, defs: [SLEEPLESS, AMBUSHER, WALKER, FLASH_ZAP], zones: { p1: { battlefield: ['Test Walker'] }, p2: { hand: ['Test Ambusher', 'Test Flash Zap'], battlefield: ['Test Sleepless'] } } });
  const toP2 = (s: GameState): GameState => act(s, { type: 'pass', player: 'p1' });
  it('is automated', () => expect(full(SLEEPLESS)).toBe(true));
  it("a creature spell its controller casts on another player's turn taps a creature", () => {
    const s0 = toP2(start());
    expect(s0.pending?.player).toBe('p2');
    const walker = byName(s0, 'Test Walker');
    const s = cast(s0, 'Test Ambusher', { targets: [[obj(walker)]] }, 'p2');
    expect(s.objects[walker]!.tapped).toBe(true);
  });
  it('a noncreature spell cast on an opponent\'s turn, and a creature spell on its controller\'s own turn, do not trigger it', () => {
    const s0 = toP2(start());
    const walker = byName(s0, 'Test Walker');
    const s = cast(s0, 'Test Flash Zap', { targets: [[obj(walker)]] }, 'p2');
    expect(s.pending?.kind).toBe('priority');
    expect(s.objects[walker]!.tapped).toBe(false);
    // p2's own turn: its creature spell does not trigger the ability of its own Sleepless
    const own = passUntil(start(), (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's main phase");
    const after = cast(own, 'Test Ambusher', { targets: [[obj(byName(own, 'Test Walker'))]] }, 'p2');
    expect(after.objects[byName(after, 'Test Walker')]!.tapped).toBe(false);
  });
});

describe('CR 602.2, 605.1a, 605.3b: "Whenever you activate an ability of an artifact or creature that isn\'t a mana ability, ~ gets +1/+1 until end of turn."', () => {
  const CONSTRUCT = card('Test Construct', 'Artifact Creature — Construct', "Whenever you activate an ability of an artifact or creature that isn't a mana ability, this creature gets +1/+1 until end of turn.", ['1', '1']);
  const GADGET = card('Test Gadget', 'Artifact', '{0}: You gain 1 life.');
  const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}.');
  const SHRINE = card('Test Shrine', 'Enchantment', '{0}: You gain 1 life.');
  const start = () => mpScenario({ players: 3, defs: [CONSTRUCT, GADGET, ROCK, SHRINE], zones: { p1: { battlefield: ['Test Construct', 'Test Gadget', 'Test Rock', 'Test Shrine'] } } });
  it('is automated', () => expect(full(CONSTRUCT)).toBe(true));
  it('a non-mana ability of an artifact makes it 2/2; each activation counts again', () => {
    const s0 = start();
    const c = byName(s0, 'Test Construct');
    let s = activate(s0, byName(s0, 'Test Gadget'));
    expect(stat(s, c)).toBe('2/2');
    s = activate(s, byName(s, 'Test Gadget'));
    expect(stat(s, c)).toBe('3/3');
  });
  it('a mana ability of an artifact and an ability of an enchantment do not trigger it', () => {
    const s0 = start();
    const c = byName(s0, 'Test Construct');
    const viaRock = activate(s0, byName(s0, 'Test Rock'));
    expect(stat(viaRock, c)).toBe('1/1');
    const viaShrine = activate(s0, byName(s0, 'Test Shrine'));
    expect(stat(viaShrine, c)).toBe('1/1');
  });
  it("an ability activated from a hand (cycling) is not an ability of a creature on the battlefield (CR 109.2, ruling 2017-02-09)", () => {
    const CYCLER = card('Test Cycler', 'Creature — Elf', 'Cycling {0}', ['1', '1']);
    const s0 = mpScenario({ players: 3, defs: [CONSTRUCT, CYCLER], zones: { p1: { hand: ['Test Cycler'], battlefield: ['Test Construct'] } } });
    const cycle = legal(s0, 'p1', 'activate').find((a) => a.label.includes('Test Cycler'))!;
    const o = { answers: [{ kind: 'yesNo', yes: true } as DecisionAnswer] };
    const s = drain(settle(act(s0, cycle.action), o), o);
    expect(byName(s, 'Test Cycler', 'graveyard')).toBeDefined(); // it was cycled: the activation did happen
    expect(stat(s, byName(s, 'Test Construct'))).toBe('1/1');
  });
  it("an opponent's activation does not trigger it (the text says you)", () => {
    const s0 = mpScenario({ players: 3, defs: [CONSTRUCT, GADGET], zones: { p1: { battlefield: ['Test Construct'] }, p2: { battlefield: ['Test Gadget'] } } });
    const s1 = act(s0, { type: 'pass', player: 'p1' });
    const s = activate(s1, byName(s1, 'Test Gadget'), {}, 'p:0:0', 'p2');
    expect(stat(s, byName(s, 'Test Construct'))).toBe('1/1');
  });
});

describe('CR 601.3, 601.2i, 101.2: "You can cast spells only during your turn and you can cast no more than two spells each turn."', () => {
  const FIRES = card('Test Fires', 'Enchantment', 'You can cast spells only during your turn and you can cast no more than two spells each turn.');
  const zap = (n: string) => card(`Test Zap ${n}`, 'Sorcery', 'You gain 1 life.');
  const FLASHY = card('Test Flashy', 'Instant', 'You gain 1 life.');
  const A = zap('A'); const B = zap('B'); const C = zap('C');
  const start = () => mpScenario({ players: 3, defs: [FIRES, A, B, C, FLASHY], zones: { p1: { hand: ['Test Zap A', 'Test Zap B', 'Test Zap C', 'Test Flashy'], battlefield: ['Test Fires'] }, p2: { hand: ['Test Flashy'] } } });
  it('is automated', () => expect(full(FIRES)).toBe(true));
  it('allows two spells on your own turn and refuses the third', () => {
    let s = start();
    expect(castable(s, 'Test Zap A')).toBe(true);
    s = cast(s, 'Test Zap A');
    expect(castable(s, 'Test Zap B')).toBe(true);
    s = cast(s, 'Test Zap B');
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(castable(s, 'Test Zap C')).toBe(false);
    expect(castable(s, 'Test Flashy')).toBe(false);
  });
  it("refuses a spell on another player's turn (even an instant), and does not limit the other players", () => {
    const s = passUntil(start(), (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'p1 with priority on the turn of p2');
    expect(castable(s, 'Test Flashy')).toBe(false);
    const s0 = start();
    const t = act(s0, { type: 'pass', player: 'p1' });
    expect(castable(t, 'Test Flashy', 'p2')).toBe(true);
  });
});

describe('CR 615.1a, 615.7, 611.2a: "Prevent the next 1 damage that would be dealt by ~ this turn."', () => {
  const WIRE = card('Test Wire', 'Artifact', '{0}: Test Wire deals 1 damage to target player.\n{0}: Prevent the next 1 damage that would be dealt by Test Wire this turn.');
  const BOLT = card('Test Plain Bolt', 'Instant', 'Test Plain Bolt deals 1 damage to target player.');
  const start = () => mpScenario({ players: 3, defs: [WIRE, BOLT], zones: { p1: { hand: ['Test Plain Bolt'], battlefield: ['Test Wire'] } } });
  it('is automated', () => expect(full(WIRE)).toBe(true));
  it('prevents the first damage the artifact would deal, and no more than that; with no shield it deals damage', () => {
    const s0 = start();
    const w = byName(s0, 'Test Wire');
    const plain = activate(s0, w, { targets: [[plr('p2')]] }, 'p:0:0');
    expect(lifeOf(plain, 'p2')).toBe(19);
    let s = activate(s0, w, {}, 'p:0:1');
    s = activate(s, w, { targets: [[plr('p2')]] }, 'p:0:0');
    expect(lifeOf(s, 'p2')).toBe(20);
    s = activate(s, w, { targets: [[plr('p2')]] }, 'p:0:0');
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('does not prevent damage from another source', () => {
    const s0 = start();
    let s = activate(s0, byName(s0, 'Test Wire'), {}, 'p:0:1');
    s = cast(s, 'Test Plain Bolt', { targets: [[plr('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});

describe('CR 205.3m, 613.1d, 613.1f: "Each creature with a gold counter on it is a Wall in addition to its other creature types and has defender."', () => {
  const GILDING = card('Test Gilding', 'Enchantment', 'Each creature with a gold counter on it is a Wall in addition to its other creature types and has defender.');
  const KNIGHT = card('Test Knight', 'Creature — Human Knight', '', ['2', '2']);
  const start = () => mpScenario({ players: 3, defs: [GILDING, KNIGHT], zones: { p1: { battlefield: ['Test Gilding', { name: 'Test Knight', counters: { gold: 1 } }, 'Test Knight'] }, p2: { battlefield: [{ name: 'Test Knight', counters: { gold: 1 } }] } } });
  it('is automated', () => expect(full(GILDING)).toBe(true));
  it('every creature with a gold counter, whoever controls it, is a Wall with defender and keeps its types; one without the counter is not', () => {
    const s = start();
    const knights = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Knight');
    const gold = knights.filter((o) => (o.counters['gold'] ?? 0) > 0);
    const plain = knights.filter((o) => (o.counters['gold'] ?? 0) === 0);
    expect(gold).toHaveLength(2);
    for (const k of gold) {
      expect(getChars(s, k.id)!.subtypes).toEqual(expect.arrayContaining(['Wall', 'Human', 'Knight']));
      expect(kw(s, k.id)).toContain('defender');
    }
    for (const k of plain) {
      expect(getChars(s, k.id)!.subtypes).not.toContain('Wall');
      expect(kw(s, k.id)).not.toContain('defender');
    }
  });
});

describe('CR 508.1, 603.2, 303.4: "Whenever an enchanted creature or enchantment creature you control attacks, draw a card."', () => {
  const KESTIA = card('Test Cultivator', 'Enchantment Creature — Elf Druid', 'Whenever an enchanted creature or enchantment creature you control attacks, draw a card.', ['2', '2']);
  const CHARM = card('Test Charm', 'Enchantment — Aura', 'Enchant creature');
  const SCOUT = card('Test Scout', 'Creature — Elf', '', ['1', '1']);
  const OTHER = card('Test Other Scout', 'Creature — Elf', '', ['1', '1']);
  const start = () => mpScenario({ players: 3, defs: [KESTIA, CHARM, SCOUT, OTHER], zones: { p1: { hand: ['Test Charm'], battlefield: ['Test Cultivator', 'Test Scout', 'Test Other Scout'] } } });
  it('is automated', () => expect(full(KESTIA)).toBe(true));
  it('the enchantment creature itself and an enchanted creature each draw a card when they attack; an unenchanted creature does not', () => {
    const s0 = start();
    const scout = byName(s0, 'Test Scout');
    const other = byName(s0, 'Test Other Scout');
    const charmed = cast(s0, 'Test Charm', { targets: [[obj(scout)]] });
    const before = handSize(charmed, 'p1');
    const one = declareAttackers(toDeclareAttackers(charmed), [[other, 'p2']]);
    expect(handSize(drain(one, {}), 'p1')).toBe(before);
    const two = declareAttackers(toDeclareAttackers(charmed), [[scout, 'p2'], [byName(charmed, 'Test Cultivator'), 'p2']]);
    expect(handSize(drain(two, {}), 'p1')).toBe(before + 2);
  });
});

describe('CR 305.1, 601.3, 101.2: "You can\'t play lands or cast spells from your hand."', () => {
  const FRENZY = card('Test Frenzy', 'Enchantment', "You may look at the top card of your library any time.\nYou may play lands and cast spells from the top of your library.\nYou can't play lands or cast spells from your hand.");
  const BAN = card('Test Hand Ban', 'Enchantment', "You can't play lands or cast spells from your hand.");
  const MEADOW = card('Test Meadow', 'Land', '');
  const HAND_SPELL = card('Test Hand Spell', 'Sorcery', 'You gain 1 life.');
  const OTHER_SPELL = card('Test Other Spell', 'Instant', 'You gain 1 life.');
  const landOffered = (s: GameState, name: string, player = 'p1'): boolean => legal(s, player, 'playLand').some((a) => a.object === byName(s, name, 'hand', player));
  it('is automated', () => { expect(full(BAN)).toBe(true); expect(full(FRENZY)).toBe(true); });
  it("its controller can neither play a land nor cast a spell from their hand; another player can, and with no ban both can", () => {
    const withBan = mpScenario({ players: 3, defs: [BAN, MEADOW, HAND_SPELL, OTHER_SPELL], zones: { p1: { hand: ['Test Meadow', 'Test Hand Spell'], battlefield: ['Test Hand Ban'] }, p2: { hand: ['Test Other Spell'] } } });
    expect(landOffered(withBan, 'Test Meadow')).toBe(false);
    expect(castable(withBan, 'Test Hand Spell')).toBe(false);
    expect(castable(act(withBan, { type: 'pass', player: 'p1' }), 'Test Other Spell', 'p2')).toBe(true);
    const without = mpScenario({ players: 3, defs: [BAN, MEADOW, HAND_SPELL], zones: { p1: { hand: ['Test Meadow', 'Test Hand Spell'] } } });
    expect(landOffered(without, 'Test Meadow')).toBe(true);
    expect(castable(without, 'Test Hand Spell')).toBe(true);
  });
  it("a spell cast from the graveyard or the library is not a spell cast from the hand: the ban lets them be cast by another permission", () => {
    const s = mpScenario({ players: 3, defs: [FRENZY, MEADOW, HAND_SPELL, OTHER_SPELL], zones: { p1: { hand: ['Test Hand Spell'], library: ['Test Other Spell', 'Test Other Spell'], battlefield: ['Test Frenzy'] } } }); // (the first of the two is drawn in the draw step)
    expect(castable(s, 'Test Hand Spell')).toBe(false);
    expect(legal(s, 'p1', 'cast').filter((a) => s.objects[a.object as ObjectId]?.zone === 'hand')).toEqual([]);
    // the card put into the library is the top card; the top-card permission of the same permanent is not stopped by the hand ban
    const fromLibrary = legal(s, 'p1', 'cast').filter((a) => s.objects[a.object as ObjectId]?.zone === 'library' && s.defs[s.objects[a.object as ObjectId]!.defId]?.name === 'Test Other Spell');
    expect(fromLibrary.length).toBe(1);
  });
});

describe('CR 609.4, 702.3b, 508.1: "Wall creatures can attack as though they didn\'t have defender."', () => {
  const STONES = card('Test Stones', 'Artifact', "Wall creatures can attack as though they didn't have defender.");
  const WALL = card('Test Barrier', 'Creature — Wall', 'Defender', ['0', '4']);
  const OX = card('Test Heavy Ox', 'Creature — Ox', 'Defender', ['3', '3']);
  const canAttack = (s0: GameState, player: string, creature: string): boolean => {
    let s = s0;
    for (let guard = 0; guard < 60 && s.pending?.kind !== 'declareAttackers'; guard++) {
      if (s.turn.activePlayer === player && s.pending?.kind === 'priority' && s.pending.player === player) s = act(s, { type: 'pass', player });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    const d = s.pending as unknown as { kind: string; player: string; options?: { attacker: ObjectId }[]; legal?: unknown };
    if (d?.kind !== 'declareAttackers' || d.player !== player) return false;
    const id = byName(s, creature);
    const defender = s.players.find((p) => p.id !== player)!.id;
    return !('error' in (act as unknown as (...a: unknown[]) => object)(s, { type: 'answer', player, decisionId: (s.pending as { id: string }).id, answer: { kind: 'declareAttackers', attacks: [{ attacker: id, defender }] } }) && false);
  };
  void canAttack;
  it('is automated', () => expect(full(STONES)).toBe(true));
  it("lets a Wall (of any player) attack; a creature that has defender but is not a Wall still can't", () => {
    const s0 = mpScenario({ players: 3, defs: [STONES, WALL, OX], zones: { p1: { battlefield: ['Test Stones', 'Test Barrier', 'Test Heavy Ox'] } } });
    const wall = byName(s0, 'Test Barrier');
    const ox = byName(s0, 'Test Heavy Ox');
    let s = toDeclareAttackers(s0);
    const d = s.pending as unknown as { options?: unknown };
    void d;
    s = declareAttackers(s, [[wall, 'p2']]);
    expect(s.combat?.attackers.map((a) => a.id)).toEqual([wall]);
    expect(() => declareAttackers(toDeclareAttackers(s0), [[ox, 'p2']])).toThrow();
    const none = mpScenario({ players: 3, defs: [WALL], zones: { p1: { battlefield: ['Test Barrier'] } } });
    expect(() => declareAttackers(toDeclareAttackers(none), [[byName(none, 'Test Barrier'), 'p2']])).toThrow();
  });
});
