/**
 * Commander lane edh-c, round edh-c-36 (EDHREC ranks 26,001-26,500): the round's readings played through the engine with synthetic cards (invented names), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25.
 *
 *   CR 615.1a, 120.3        "Prevent all damage that creatures would deal to players this turn." (Chameleon Blur)
 *   CR 109.4, 122.1         "Put a +1/+1 counter on each creature each opponent controls." (Aku Djinn)
 *   CR 604.1, 611.3a, 613.4c "As long as you control exactly one creature, that creature gets +3/+1 and has lifelink." (Homicidal Seclusion)
 *   CR 615.1a, 615.5, 122.1 "Prevent all damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature." (Brace for Impact)
 *   CR 608.2c, 613.4c       "Creatures you control get +0/+1 until end of turn for each card discarded this way." (Sacred Rites)
 *   CR 400.1, 406.1, 404.1  "Exile all cards from target player's hand and graveyard." (Identity Crisis)
 *   CR 401.3, 107.3         "Put target creature into its owner's library just beneath the top X cards of that library, where X is the number of Plains you control." (Quarry Colossus)
 *   CR 614.1a, 120.3        "If a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead." (Lashknife Barrier)
 *   CR 115.1, 608.2b, 613.4c "~ and up to one other target creature each get +3/+3 until end of turn." (Razorgrass Invoker)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

interface Script { targets?: TargetChoice[][]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; yes?: boolean[]; numbers?: number[]; attackers?: { attacker: ObjectId; defender: PlayerId }[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: script.attackers ?? [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const activate = (s: GameState, source: ObjectId, script: Script = {}, player: PlayerId = 'p1'): GameState =>
  settle(drive(act(s, { type: 'activate', player, source, ability: 'p:0:0' } as never), script), script);
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'exile' | 'library' = 'battlefield', owner?: PlayerId): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const inZone = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'exile' | 'library', owner?: PlayerId): boolean =>
  Object.values(s.objects).some((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const BIGBEAR = card('Test Big Bear', 'Creature — Bear', '', ['6', '6']);
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.');
const PING = card('Test Ping', 'Instant', '~ deals 1 damage to any target.');

// ---- Chameleon Blur ---------------------------------------------------------------------------------------------------------------------------------------------

const BLUR = card('Test Blur', 'Instant', 'Prevent all damage that creatures would deal to players this turn.');
const POKER = card('Test Poker', 'Creature — Goblin', '{0}: This creature deals 2 damage to target player.', ['1', '1']);
const STAB = card('Test Stab', 'Creature — Goblin', '{0}: This creature deals 2 damage to target creature.', ['1', '1']);
describe('CR 615.1a, 120.3: "Prevent all damage that creatures would deal to players this turn." (Chameleon Blur)', () => {
  const game = () => mpScenario({ players: 3, defs: [BLUR, POKER, STAB, BEAR, BOLT], zones: { p1: { hand: ['Test Blur', 'Test Bolt'], battlefield: ['Test Poker', 'Test Stab'] }, p2: { battlefield: ['Test Bear'] } } });
  it('is automated', () => expect(full(BLUR) && full(POKER) && full(STAB)).toBe(true));
  it('damage a creature would deal to a player is prevented', () => {
    const s0 = cast(game(), 'Test Blur');
    const s = activate(s0, byName(s0, 'Test Poker'), { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: without the spell the same ability deals its damage', () => {
    const s0 = game();
    expect(lifeOf(activate(s0, byName(s0, 'Test Poker'), { targets: [[pl('p2')]] }), 'p2')).toBe(18);
  });
  it('negative: damage from a creature to a creature, and damage from a spell to a player, are not prevented', () => {
    const s0 = cast(game(), 'Test Blur');
    const s1 = activate(s0, byName(s0, 'Test Stab'), { targets: [[obj(byName(s0, 'Test Bear'))]] });
    expect(s1.objects[byName(s1, 'Test Bear')]!.damage).toBe(2);
    const s2 = cast(s1, 'Test Bolt', { targets: [[pl('p2')]] });
    expect(lifeOf(s2, 'p2')).toBe(17);
  });
});

// ---- Aku Djinn --------------------------------------------------------------------------------------------------------------------------------------------------

const DJINN = card('Test Djinn Spell', 'Sorcery', 'Put a +1/+1 counter on each creature each opponent controls.');
describe('CR 109.4, 122.1: "Put a +1/+1 counter on each creature each opponent controls." (Aku Djinn)', () => {
  it('is automated', () => expect(full(DJINN)).toBe(true));
  it('puts a counter on every creature of every opponent, and on none of yours', () => {
    const s0 = mpScenario({ players: 3, defs: [DJINN, BEAR], zones: { p1: { hand: ['Test Djinn Spell'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
    const s = cast(s0, 'Test Djinn Spell');
    const bears = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Bear' && o.zone === 'battlefield');
    expect(bears.filter((o) => o.controller === 'p1').map((o) => o.counters['+1/+1'] ?? 0)).toEqual([0]);
    expect(bears.filter((o) => o.controller !== 'p1').map((o) => o.counters['+1/+1'] ?? 0)).toEqual([1, 1, 1]);
  });
});

// ---- Homicidal Seclusion ----------------------------------------------------------------------------------------------------------------------------------------

const SECLUSION = card('Test Seclusion', 'Enchantment', 'As long as you control exactly one creature, that creature gets +3/+1 and has lifelink.');
describe('CR 604.1, 611.3a, 613.4c: "As long as you control exactly one creature, that creature gets +3/+1 and has lifelink." (Homicidal Seclusion)', () => {
  it('is automated', () => expect(full(SECLUSION)).toBe(true));
  it('the one creature you control gets +3/+1 and lifelink; the creatures of others do not', () => {
    const s = mpScenario({ players: 3, defs: [SECLUSION, BEAR], zones: { p1: { battlefield: ['Test Seclusion', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
    const mine = Object.values(s.objects).find((o) => o.controller === 'p1' && s.defs[o.defId]?.name === 'Test Bear')!.id;
    const theirs = Object.values(s.objects).find((o) => o.controller === 'p2' && s.defs[o.defId]?.name === 'Test Bear')!.id;
    expect(stat(s, mine)).toBe('6/4');
    expect(kw(s, mine)).toContain('lifelink');
    expect(stat(s, theirs)).toBe('3/3');
    expect(kw(s, theirs)).not.toContain('lifelink');
  });
  it('negative: with two creatures you control it does nothing', () => {
    const s = mpScenario({ players: 3, defs: [SECLUSION, BEAR], zones: { p1: { battlefield: ['Test Seclusion', 'Test Bear', 'Test Bear'] } } });
    for (const o of Object.values(s.objects).filter((x) => x.controller === 'p1' && s.defs[x.defId]?.name === 'Test Bear')) {
      expect(stat(s, o.id)).toBe('3/3');
      expect(kw(s, o.id)).not.toContain('lifelink');
    }
  });
});

// ---- Brace for Impact -------------------------------------------------------------------------------------------------------------------------------------------

const BRACE = card('Test Brace', 'Instant', 'Prevent all damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature.');
describe('CR 615.1a, 615.5, 122.1: "Prevent all damage ... For each 1 damage prevented this way, put a +1/+1 counter on that creature." (Brace for Impact)', () => {
  const game = () => mpScenario({ players: 3, defs: [BRACE, BEAR, BOLT, PING], zones: { p1: { hand: ['Test Brace', 'Test Bolt', 'Test Ping'], battlefield: ['Test Bear', 'Test Bear'] } } });
  it('is automated', () => expect(full(BRACE)).toBe(true));
  it('the damage to the target is prevented and it gets a counter for each 1 prevented, over several damage events', () => {
    const s0 = game();
    const [a] = Object.values(s0.objects).filter((o) => o.controller === 'p1' && s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    const s1 = cast(s0, 'Test Brace', { targets: [[obj(a!)]] });
    const s2 = cast(s1, 'Test Bolt', { targets: [[obj(a!)]] });
    const s3 = cast(s2, 'Test Ping', { targets: [[obj(a!)]] });
    expect(s3.objects[a!]!.damage).toBe(0);
    expect(counters(s3, a!, '+1/+1')).toBe(4);
  });
  it('negative: damage to another creature is dealt as usual and gives no counter; with no Brace the target is damaged', () => {
    const s0 = game();
    const [a, b] = Object.values(s0.objects).filter((o) => o.controller === 'p1' && s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    const s1 = cast(s0, 'Test Brace', { targets: [[obj(a!)]] });
    const s2 = cast(s1, 'Test Ping', { targets: [[obj(b!)]] });
    expect(s2.objects[b!]!.damage).toBe(1);
    expect(counters(s2, b!, '+1/+1')).toBe(0);
    expect(counters(s2, a!, '+1/+1')).toBe(0);
  });
});

// ---- Sacred Rites -----------------------------------------------------------------------------------------------------------------------------------------------

const RITES = card('Test Rites', 'Instant', 'Discard any number of cards. Creatures you control get +0/+1 until end of turn for each card discarded this way.');
describe('CR 608.2c, 613.4c: "Discard any number of cards. Creatures you control get +0/+1 until end of turn for each card discarded this way." (Sacred Rites)', () => {
  const game = () => mpScenario({ players: 3, defs: [RITES, BEAR], zones: { p1: { hand: ['Test Rites', 'Test Bear', 'Test Bear'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
  it('is automated', () => expect(full(RITES)).toBe(true));
  it('discarding two cards gives your creatures +0/+2 and not the creatures of others', () => {
    const s0 = game();
    const s = cast(s0, 'Test Rites', { objects: [(opts, st) => opts.filter((id) => st.objects[id]!.zone === 'hand' && st.defs[st.objects[id]!.defId]?.name === 'Test Bear')] });
    const mine = Object.values(s.objects).find((o) => o.controller === 'p1' && o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Test Bear')!.id;
    const theirs = Object.values(s.objects).find((o) => o.controller === 'p2' && o.zone === 'battlefield')!.id;
    expect(stat(s, mine)).toBe('3/5');
    expect(stat(s, theirs)).toBe('3/3');
  });
  it('negative: discarding nothing gives no bonus', () => {
    const s = cast(game(), 'Test Rites', { objects: [[]] });
    const mine = Object.values(s.objects).find((o) => o.controller === 'p1' && o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Test Bear')!.id;
    expect(stat(s, mine)).toBe('3/3');
  });
});

// ---- Identity Crisis --------------------------------------------------------------------------------------------------------------------------------------------

const CRISIS = card('Test Crisis', 'Sorcery', "Exile all cards from target player's hand and graveyard.");
describe('CR 406.1, 404.1: "Exile all cards from target player\'s hand and graveyard." (Identity Crisis)', () => {
  const game = () => mpScenario({ players: 3, defs: [CRISIS, BEAR, BOLT], zones: { p1: { hand: ['Test Crisis', 'Test Bolt'], graveyard: ['Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bolt'], graveyard: ['Test Bear', 'Test Bear'] } } });
  it('is automated', () => expect(full(CRISIS)).toBe(true));
  it('exiles every card of the chosen player\'s hand and graveyard, and nothing of anyone else\'s', () => {
    const s = cast(game(), 'Test Crisis', { targets: [[pl('p2')]] });
    expect(s.zones.hand['p2']!.length).toBe(0);
    expect(s.zones.graveyard['p2']!.length).toBe(0);
    expect(Object.values(s.objects).filter((o) => o.zone === 'exile' && o.owner === 'p2').length).toBe(4);
    expect(inZone(s, 'Test Bolt', 'hand', 'p1')).toBe(true);
    expect(s.zones.graveyard['p1']!.length).toBe(2); // its own graveyard card, and the spell
  });
  it('negative: the library of the chosen player is untouched', () => {
    const s0 = game();
    const before = s0.zones.library['p2']!.length;
    expect(cast(s0, 'Test Crisis', { targets: [[pl('p2')]] }).zones.library['p2']!.length).toBe(before);
  });
});

// ---- Quarry Colossus --------------------------------------------------------------------------------------------------------------------------------------------

const COLOSSUS = card('Test Colossus', 'Creature — Giant', "When this creature enters, put target creature into its owner's library just beneath the top X cards of that library, where X is the number of Plains you control.", ['3', '3']);
describe('CR 401.3, 107.3: "... just beneath the top X cards of that library, where X is the number of Plains you control." (Quarry Colossus)', () => {
  const game = (plains: number) => mpScenario({ players: 3, defs: [COLOSSUS, BEAR], zones: { p1: { hand: ['Test Colossus'] , battlefield: Array(plains).fill('Plains') }, p2: { battlefield: ['Test Bear'] } } });
  const place = (plains: number): { index: number; size: number } => {
    const s0 = game(plains);
    const bear = byName(s0, 'Test Bear');
    const s = cast(s0, 'Test Colossus', { targets: [[obj(bear)]] });
    const lib = s.zones.library['p2']!;
    const id = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Bear' && o.zone === 'library')!.id;
    return { index: lib.indexOf(id), size: lib.length };
  };
  it('is automated', () => expect(full(COLOSSUS)).toBe(true));
  it('with no Plains the creature goes on top; with N Plains it goes just beneath the top N cards', () => {
    const top = place(0).index;
    expect([0, place(0).size - 1]).toContain(top);
    const atTop = top === 0;
    const idx = (n: number): number => place(n).index;
    expect(idx(3)).toBe(atTop ? 3 : place(3).size - 1 - 3);
    expect(idx(1)).toBe(atTop ? 1 : place(1).size - 1 - 1);
  });
  it('negative: it goes into its OWNER\'s library (not the controller\'s)', () => {
    const s0 = game(2);
    const s = cast(s0, 'Test Colossus', { targets: [[obj(byName(s0, 'Test Bear'))]] });
    expect(inZone(s, 'Test Bear', 'library', 'p2')).toBe(true);
    expect(inZone(s, 'Test Bear', 'battlefield')).toBe(false);
  });
});

// ---- Lashknife Barrier ------------------------------------------------------------------------------------------------------------------------------------------

const BARRIER = card('Test Barrier', 'Enchantment', 'If a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead.');
describe('CR 614.1a, 120.3: "If a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead." (Lashknife Barrier)', () => {
  const game = () => mpScenario({ players: 3, defs: [BARRIER, BEAR, BOLT, PING], zones: { p1: { hand: ['Test Bolt', 'Test Ping'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Barrier', 'Test Bear'], hand: [] } } });
  it('is automated', () => expect(full(BARRIER)).toBe(true));
  it('3 damage to a creature of the Barrier\'s controller is 2; 1 damage is none at all', () => {
    const s0 = game();
    const theirs = Object.values(s0.objects).find((o) => o.controller === 'p2' && s0.defs[o.defId]?.name === 'Test Bear')!.id;
    const s1 = cast(s0, 'Test Bolt', { targets: [[obj(theirs)]] });
    expect(s1.objects[theirs]!.damage).toBe(2);
    const s2 = cast(s1, 'Test Ping', { targets: [[obj(theirs)]] });
    expect(s2.objects[theirs]!.damage).toBe(2);
  });
  it('negative: a creature of another player and a player are dealt the full damage', () => {
    const s0 = game();
    const mine = Object.values(s0.objects).find((o) => o.controller === 'p1' && s0.defs[o.defId]?.name === 'Test Bear')!.id;
    const s1 = cast(s0, 'Test Bolt', { targets: [[obj(mine)]] });
    expect(inZone(s1, 'Test Bear', 'graveyard', 'p1')).toBe(true);
    const s2 = cast(game(), 'Test Bolt', { targets: [[pl('p2')]] });
    expect(lifeOf(s2, 'p2')).toBe(17);
  });
});

// ---- Razorgrass Invoker -----------------------------------------------------------------------------------------------------------------------------------------

const INVOKER = card('Test Invoker', 'Creature — Elemental', '{0}: This creature and up to one other target creature each get +3/+3 until end of turn.', ['2', '2']);
describe('CR 115.1, 608.2b, 613.4c: "~ and up to one other target creature each get +3/+3 until end of turn." (Razorgrass Invoker)', () => {
  const game = () => mpScenario({ players: 3, defs: [INVOKER, BEAR], zones: { p1: { battlefield: ['Test Invoker', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
  it('is automated', () => expect(full(INVOKER)).toBe(true));
  it('with a target both get +3/+3; with no target only the creature itself does', () => {
    const s0 = game();
    const inv = byName(s0, 'Test Invoker');
    const bear = Object.values(s0.objects).find((o) => o.controller === 'p2')!.id;
    const s1 = activate(s0, inv, { targets: [[obj(bear)]] });
    expect([stat(s1, inv), stat(s1, bear)]).toEqual(['5/5', '6/6']);
    const s2 = activate(s0, inv, { targets: [[]] });
    expect([stat(s2, inv), stat(s2, bear)]).toEqual(['5/5', '3/3']);
  });
  it('negative: the creature itself is not a legal choice for "other target creature"', () => {
    const s0 = game();
    const inv = byName(s0, 'Test Invoker');
    expect(() => activate(s0, inv, { targets: [[obj(inv)]] })).toThrow();
  });
});

// ---- G10 change: Márton Stromgald (the experimental eff.cont.pump.each.foreach reading is now read by the stable group reading) ------------------------------------

const LEADER = card('Test Rally Leader', 'Creature — Human', 'Whenever this creature attacks, other attacking creatures get +1/+1 until end of turn for each attacking creature other than this creature.', ['2', '2']);
describe('CR 611.2a, 608.2h, 613.4c: "other attacking creatures get +1/+1 until end of turn for each attacking creature other than ~" (Márton Stromgald; recorded G10 change of the JSON, same play)', () => {
  const attack = (n: number): string[] => {
    const s0 = mpScenario({ players: 3, defs: [LEADER, BEAR], zones: { p1: { battlefield: ['Test Rally Leader', ...Array(n).fill('Test Bear')] } } });
    const mine = Object.values(s0.objects).filter((o) => o.controller === 'p1' && o.zone === 'battlefield').map((o) => o.id);
    let s = passUntil(s0, (t) => t.pending?.kind === 'declareAttackers', 'declare attackers', 300);
    s = answer(s, { kind: 'declareAttackers', attacks: mine.map((attacker) => ({ attacker, defender: 'p2' as PlayerId })) });
    s = settle(s);
    return mine.map((id) => stat(s, id));
  };
  it('is automated', () => expect(full(LEADER)).toBe(true));
  it('with two other attackers each of them gets +2/+2 and the creature itself nothing; with no other attacker nothing changes', () => {
    expect(attack(2).sort()).toEqual(['2/2', '5/5', '5/5']);
    expect(attack(0)).toEqual(['2/2']);
  });
});
