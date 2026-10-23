/**
 * std-rx27 (wave 2, Standard lane rx27: cast and play permissions): the round's readings played through applyAction with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };

type Opts = { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] };
/** Answer the decisions that come up, in order, until priority (or nothing scripted is left). */
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player: 'p1' | 'p2' = 'p1'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), q), q);
}
/** Cast a card from where it is with the cast action legalActions offers for it (its method, if any), and resolve it. */
function castFrom(s0: GameState, id: ObjectId, opts: Opts = {}, player: 'p1' | 'p2' = 'p1'): GameState {
  const offer = legal(s0, player, 'cast').find((a) => a.object === id);
  if (!offer) throw new Error(`no cast action for ${id}`);
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, offer.action), q), q);
}
function activate(s0: GameState, source: ObjectId, ability: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), q), q);
}
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts = {}, max = 400): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
const castable = (s: GameState, player: 'p1' | 'p2' = 'p1'): ObjectId[] => legal(s, player, 'cast').map((a) => a.object!);
const exiled = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
const onBattlefield = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => s.objects[id]!.defId === name);

const GROVE_ELF = card('Test Grove Elf', 'Creature — Elf', '', ['1', '1'], '{1}{G}');
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '4'], '{1}{W}');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.', undefined, '{R}');
const BIG = card('Test Behemoth', 'Creature — Beast', '', ['6', '6'], '{4}{G}{G}');

describe('CR 607.2a, 601.3, 702.8a, 609.4b, 611.3a: "During your turn, you may cast cards exiled with ~ and you may cast them as though they had flash. Mana of any type can be spent to cast those spells."', () => {
  const REGENT = card('Test Regent', 'Creature — Human Rogue', "When this creature enters, exile the top card of target opponent's library.\nDuring your turn, you may cast cards exiled with this creature and you may cast them as though they had flash. Mana of any type can be spent to cast those spells.", ['2', '2']);
  it('is automated', () => expect(automated(REGENT)).toBe(true));
  it('the controller casts the opponent\'s exiled creature card with Plains mana (any type), at instant speed during their own turn; not on the opponent\'s turn', () => {
    let s = scenario([], { p1: { hand: ['Test Regent'], battlefield: ['Plains', 'Plains'] }, p2: { library: ['Test Grove Elf'] }, defs: [REGENT, GROVE_ELF] });
    s = cast(s, 'Test Regent', { targets: [[p2]] });
    const elf = exiled(s, 'Test Grove Elf')[0]!;
    // flash: the creature card is castable in the beginning of combat step of your turn (CR 702.8a)
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'beginCombat' && x.pending?.kind === 'priority');
    expect(castable(s)).toContain(elf);
    s = castFrom(s, elf);
    const now = onBattlefield(s, 'Test Grove Elf')!;
    expect(s.objects[now]!.controller).toBe('p1');
    expect(s.objects[now]!.owner).toBe('p2');
  });
  it('the permission is during your turn only (CR 611.3a): on the opponent\'s turn the card is not castable, even at instant speed', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Regent'], battlefield: ['Plains', 'Plains', 'Mountain'] }, p2: { library: ['Test Shock', 'Plains'] }, defs: [REGENT, SHOCK] });
    s = cast(s, 'Test Regent', { targets: [[p2]] });
    const shock = exiled(s, 'Test Shock')[0]!;
    expect(castable(s)).toContain(shock);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    expect(castable(s)).not.toContain(shock);
  });
  it('a card exiled by something else is not "exiled with" it (CR 607.2a)', () => {
    const EXILER = card('Test Banisher', 'Sorcery', "Exile the top card of target opponent's library.");
    let s = scenario([], { p1: { hand: ['Test Regent', 'Test Banisher'], battlefield: ['Plains', 'Plains'] }, p2: { library: ['Test Ox', 'Test Grove Elf'] }, defs: [REGENT, EXILER, OX, GROVE_ELF] });
    s = cast(s, 'Test Banisher', { targets: [[p2]] });
    const ox = exiled(s, 'Test Ox')[0]!;
    s = cast(s, 'Test Regent', { targets: [[p2]] });
    expect(castable(s)).toContain(exiled(s, 'Test Grove Elf')[0]!);
    expect(castable(s)).not.toContain(ox);
  });
});

describe('CR 607.2a, 601.3e, 614.1c: "You may cast Elf creature spells from among cards you own exiled with ~. If you cast a spell this way, that creature enters with a finality counter on it."', () => {
  const DIGGER = card('Test Digger', 'Creature — Human Druid', '{2}: Exile target card from a graveyard.\nYou may cast Elf creature spells from among cards you own exiled with this creature. If you cast a spell this way, that creature enters with a finality counter on it.', ['1', '1']);
  it('is automated', () => expect(automated(DIGGER)).toBe(true));
  it('an Elf card you own exiled with it is castable and enters with a finality counter; an opponent\'s Elf card and your non-Elf card are not', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Digger', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Forest', 'Forest'], graveyard: ['Test Grove Elf', 'Test Ox'] }, p2: { graveyard: ['Test Grove Elf'] }, defs: [DIGGER, GROVE_ELF, OX] });
    const digger = find(s, 'Test Digger', 'battlefield', 'p1');
    s = activate(s, digger, 'p:0:0', { targets: [[obj(find(s, 'Test Grove Elf', 'graveyard', 'p1'))]] });
    s = activate(s, digger, 'p:0:0', { targets: [[obj(find(s, 'Test Ox', 'graveyard', 'p1'))]] });
    s = activate(s, digger, 'p:0:0', { targets: [[obj(find(s, 'Test Grove Elf', 'graveyard', 'p2'))]] });
    const mine = exiled(s, 'Test Grove Elf').find((id) => s.objects[id]!.owner === 'p1')!;
    const theirs = exiled(s, 'Test Grove Elf').find((id) => s.objects[id]!.owner === 'p2')!;
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(castable(s)).toContain(mine);
    expect(castable(s)).not.toContain(theirs);
    expect(castable(s)).not.toContain(ox);
    s = castFrom(s, mine);
    const elf = onBattlefield(s, 'Test Grove Elf')!;
    expect(s.objects[elf]!.counters['finality']).toBe(1);
  });
});

describe('CR 607.2a, 601.3, 118.9, 400.7: "Once each turn, you may cast a spell with mana value less than or equal to <N> from among cards exiled with ~ this turn without paying its mana cost."', () => {
  const SEER = card('Test Seer', 'Creature — Elf Faerie', "{T}: Exile the top two cards of target opponent's library.\nOnce each turn, you may cast a spell with mana value less than or equal to the number of Elves you control from among cards exiled with this creature this turn without paying its mana cost.", ['1', '1']);
  it('is automated', () => expect(automated(SEER)).toBe(true));
  it('one free spell each turn, of mana value up to the number of Elves; never for its mana cost; not a card exiled on an earlier turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Seer', 'Test Grove Elf', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { library: ['Test Ox', 'Test Shock', 'Test Behemoth', 'Test Ox'] }, defs: [SEER, GROVE_ELF, OX, SHOCK, BIG] });
    const seer = find(s, 'Test Seer', 'battlefield', 'p1');
    s = activate(s, seer, 'p:0:0', { targets: [[p2]] });
    const ox = exiled(s, 'Test Ox')[0]!;
    const shock = exiled(s, 'Test Shock')[0]!;
    // two Elves: mana value 2 or less; each offer is the free one only (CR 118.9)
    const offers = legal(s, 'p1', 'cast').filter((a) => a.object === ox || a.object === shock);
    expect(offers.map((a) => a.object).sort()).toEqual([ox, shock].sort());
    expect(offers.every((a) => a.action.type === 'cast' && typeof a.action.method === 'string' && a.action.method.startsWith('grantedCost:named:linked:'))).toBe(true);
    expect(() => act(s, { type: 'cast', player: 'p1', card: ox })).toThrow();
    s = castFrom(s, ox);
    expect(onBattlefield(s, 'Test Ox')).toBeDefined();
    // once each turn: the second card waits
    expect(castable(s)).not.toContain(shock);
    // next turn of yours: those cards were exiled on an earlier turn (CR 400.7: "this turn")
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(castable(s)).not.toContain(shock);
    s = activate(s, seer, 'p:0:0', { targets: [[p2]] });
    const big = exiled(s, 'Test Behemoth')[0]!;
    const ox2 = exiled(s, 'Test Ox')[0]!;
    expect(castable(s)).not.toContain(big); // mana value 6 > 2 Elves
    expect(castable(s)).toContain(ox2);
  });
});

describe('CR 607.2a, 611.2a, 601.3, 305.1: "Whenever ~ attacks, until end of turn, you may play a card exiled with ~." (one card only)', () => {
  const RAIDER = card('Test Raider', 'Creature — Turtle', '{T}: Exile the top card of your library.\nWhenever this creature attacks, until end of turn, you may play a card exiled with this creature.', ['3', '3']);
  const STRIKER = card('Test Striker', 'Creature — Turtle', '{1}: Exile the top card of your library.\nWhenever this creature attacks, until end of turn, you may play a card exiled with this creature.', ['3', '3']);
  it('is automated', () => expect(automated(RAIDER)).toBe(true));
  it('nothing is playable before it attacks; after its trigger, one of the cards (a land counts) and then no other this turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Striker', 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Ox', 'Plains', 'Test Ox'] }, defs: [STRIKER, OX] });
    const striker = find(s, 'Test Striker', 'battlefield', 'p1');
    s = activate(s, striker, 'p:0:0');
    s = activate(s, striker, 'p:0:0');
    const [a, b] = s.zones.exile;
    expect(castable(s)).not.toContain(a);
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: striker, defender: 'p2' }] });
    s = drain(settle(s));
    // second main phase: the land and the creature card are both offered, one of them may be played
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'main2' && x.pending?.kind === 'priority');
    const land = [a, b].find((id) => s.objects[id!]!.defId === 'Plains')!;
    const ox = [a, b].find((id) => s.objects[id!]!.defId === 'Test Ox')!;
    expect(legal(s, 'p1', 'playLand').map((x) => x.object)).toContain(land);
    expect(castable(s)).toContain(ox);
    s = act(s, { type: 'playLand', player: 'p1', card: land });
    expect(castable(s)).not.toContain(ox);
  });
  it('the permission ends with the turn (CR 611.2a)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Striker', 'Plains', 'Plains', 'Plains'], library: ['Test Ox', 'Test Ox'] }, defs: [STRIKER, OX] });
    const striker = find(s, 'Test Striker', 'battlefield', 'p1');
    s = activate(s, striker, 'p:0:0');
    const ox = s.zones.exile[0]!;
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: striker, defender: 'p2' }] });
    s = drain(settle(s));
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'main2' && x.pending?.kind === 'priority');
    expect(castable(s)).toContain(ox);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(castable(s)).not.toContain(ox);
  });
});

describe('CR 401.5, 601.3, 601.3e, 614.1c: "You may play lands and cast Elf spells from the top of your library. If you cast a creature spell this way, that creature enters with an additional +1/+1 counter on it."', () => {
  const PLANNER = card('Test Planner', 'Creature — Elf Druid', 'You may look at the top card of your library any time.\nYou may play lands and cast Elf spells from the top of your library. If you cast a creature spell this way, that creature enters with an additional +1/+1 counter on it.', ['2', '2']);
  const ELF_RITE = card('Test Elf Rite', 'Kindred Sorcery — Elf', 'You gain 1 life.', undefined, '{W}');
  it('is automated', () => expect(automated(PLANNER)).toBe(true));
  it('an Elf creature card on top is cast from there and enters with a +1/+1 counter; cast from the hand it gets none', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Planner', 'Forest', 'Forest'], hand: ['Test Grove Elf'], library: ['Test Grove Elf', 'Test Ox'] }, defs: [PLANNER, GROVE_ELF, OX] });
    const top = s.zones.library['p1']![0]!;
    expect(castable(s)).toContain(top);
    s = castFrom(s, top);
    const elf = onBattlefield(s, 'Test Grove Elf')!;
    expect(s.objects[elf]!.counters['+1/+1']).toBe(1);
    // the next card is an Ox: not an Elf spell
    expect(castable(s)).not.toContain(s.zones.library['p1']![0]!);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    s = cast(s, 'Test Grove Elf');
    const second = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Grove Elf').find((id) => id !== elf)!;
    expect(s.objects[second]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('a land on top is played from there; an Elf spell that is not a creature gets no counter rider (it never enters)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Planner', 'Plains'], library: ['Plains', 'Test Elf Rite'] }, defs: [PLANNER, ELF_RITE] });
    const land = s.zones.library['p1']![0]!;
    expect(legal(s, 'p1', 'playLand').map((x) => x.object)).toContain(land);
    s = act(s, { type: 'playLand', player: 'p1', card: land });
    const rite = s.zones.library['p1']![0]!;
    expect(castable(s)).toContain(rite);
    s = castFrom(s, rite);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Elf Rite');
  });
});

describe('CR 305.2, 601.3, 110.4a, 611.3a: "During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard."', () => {
  const GRAVETIDE = card('Test Gravetide', 'Creature — Elemental Avatar', 'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.', ['6', '6']);
  const RELIC = card('Test Relic', 'Artifact', '', undefined, '{1}');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2'], '{2}');
  it('is automated', () => expect(automated(GRAVETIDE)).toBe(true));
  it('one land and one spell of each permanent type each turn; an artifact creature card uses the artifact or the creature permission, the player\'s choice', () => {
    let s = scenario([], { p1: { battlefield: ['Test Gravetide', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], graveyard: ['Plains', 'Plains', 'Test Ox', 'Test Ox', 'Test Relic', 'Test Golem'] }, defs: [GRAVETIDE, OX, RELIC, GOLEM] });
    const lands = s.zones.graveyard['p1']!.filter((id) => s.objects[id]!.defId === 'Plains');
    expect(legal(s, 'p1', 'playLand').map((x) => x.object)).toEqual(expect.arrayContaining(lands));
    s = act(s, { type: 'playLand', player: 'p1', card: lands[0]! });
    // the land play of the turn is used, and so is the graveyard land permission
    expect(legal(s, 'p1', 'playLand').map((x) => x.object)).not.toContain(lands[1]);
    const golem = find(s, 'Test Golem', 'graveyard', 'p1');
    // two ways for the artifact creature card: the player picks one (CR 601.3)
    const ways = legal(s, 'p1', 'cast').filter((a) => a.object === golem && a.action.type === 'cast' && a.action.method?.startsWith('permission:') === true);
    expect(ways.length).toBe(2);
    s = drain(settle(act(s, ways[1]!.action)));
    expect(onBattlefield(s, 'Test Golem')).toBeDefined();
    const oxen = s.zones.graveyard['p1']!.filter((id) => s.objects[id]!.defId === 'Test Ox');
    const relic = find(s, 'Test Relic', 'graveyard', 'p1');
    // the Golem used the creature permission (the second way): an Ox waits, the Relic is still castable
    expect(castable(s)).not.toContain(oxen[0]);
    expect(castable(s)).toContain(relic);
    s = castFrom(s, relic);
    expect(castable(s)).not.toContain(oxen[0]);
  });
  it('not during an opponent\'s turn (CR 611.3a), and again on your next turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Gravetide', 'Plains', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Ox', 'Test Ox'] }, defs: [GRAVETIDE, OX] });
    const [a, b] = s.zones.graveyard['p1']!;
    s = castFrom(s, a!);
    expect(castable(s)).not.toContain(b);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    expect(castable(s)).not.toContain(b);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(castable(s)).toContain(b);
  });
});

describe('CR 603.2h, 608.2g, 118.9: "Whenever you scry, look at the top card of your library. You may cast that card without paying its mana cost. Do this only once each turn."', () => {
  const ORRERY = card('Test Orrery', 'Artifact', '{1}, {T}: Scry 1.\n{2}: Scry 1.\nWhenever you scry, look at the top card of your library. You may cast that card without paying its mana cost. Do this only once each turn.');
  it('is automated, the limit counting the optional cast (the looks before it are not the action)', () => {
    expect(automated(ORRERY)).toBe(true);
    const t = ORRERY.faces[0]!.abilities[2]!;
    expect(t.kind === 'triggered' && t.limit).toEqual({ per: 'turn', max: 1, action: true });
  });
  it('declined, it triggers again; once a card was cast this way, it does nothing more this turn; next turn it works again', () => {
    let s = scenario([], { p1: { battlefield: ['Test Orrery', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Ox', 'Test Ox', 'Test Ox', 'Test Ox'] }, defs: [ORRERY, OX] });
    const orrery = find(s, 'Test Orrery', 'battlefield', 'p1');
    const oxen = (x: GameState): number => x.zones.battlefield.filter((id) => x.objects[id]!.defId === 'Test Ox').length;
    const keep = { kind: 'chooseObjects', ids: [] } as DecisionAnswer;
    const scry = (x: GameState, ability: string, cast: boolean | null): GameState => {
      // the scry keeps the card on top; then the trigger asks whether to cast it (null: the trigger must not ask)
      const answers: DecisionAnswer[] = [keep, ...(cast === null ? [] : [{ kind: 'yesNo', yes: cast } as DecisionAnswer])];
      return drain(settle(act(x, { type: 'activate', player: 'p1', source: orrery, ability }), { answers }), { answers });
    };
    s = scry(s, 'p:0:1', false);
    expect(oxen(s)).toBe(0);
    s = scry(s, 'p:0:1', true);
    expect(oxen(s)).toBe(1);
    // the action was taken this turn: the next scry has nothing to cast (the ability does not trigger, CR 603.2h)
    s = scry(s, 'p:0:0', null);
    expect(oxen(s)).toBe(1);
    expect(s.pending?.kind).toBe('priority');
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    s = scry(s, 'p:0:1', true);
    expect(oxen(s)).toBe(2);
  });
});

describe('CR 602.5b, 702.177a, 611.3a: "During your turn, as long as you haven\'t activated an exhaust ability this turn, you may activate exhaust abilities as though they haven\'t been activated."', () => {
  const REFUELER = card('Test Refueler', 'Creature — Elf Druid', "During your turn, as long as you haven't activated an exhaust ability this turn, you may activate exhaust abilities as though they haven't been activated.\nExhaust -- {1}: Put a +1/+1 counter on this creature.", ['1', '1']);
  const MANUAL_EXHAUST = card('Test Racer', 'Creature — Goblin', 'Exhaust -- {1}: Put a +1/+1 counter on this creature.', ['1', '1']);
  it('is automated', () => expect(automated(REFUELER)).toBe(true));
  const canExhaust = (s: GameState, id: ObjectId): boolean => legal(s, 'p1', 'activate').some((a) => a.object === id);
  it('an exhaust ability used once may be activated again on a later turn of yours, once each turn; not on an opponent\'s turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Refueler', 'Test Racer', 'Plains', 'Plains', 'Plains'] }, defs: [REFUELER, MANUAL_EXHAUST] });
    const racer = find(s, 'Test Racer', 'battlefield', 'p1');
    const refueler = find(s, 'Test Refueler', 'battlefield', 'p1');
    s = activate(s, racer, 'p:0:0');
    expect(s.objects[racer]!.counters['+1/+1']).toBe(1);
    // an exhaust ability was activated this turn: the permission does not apply now (CR 611.3a)
    expect(canExhaust(s, racer)).toBe(false);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    expect(canExhaust(s, racer)).toBe(false); // not your turn
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(canExhaust(s, racer)).toBe(true);
    s = activate(s, racer, 'p:0:0');
    expect(s.objects[racer]!.counters['+1/+1']).toBe(2);
    // the one activation of the turn is spent: the other exhaust ability (never used) is still activatable as usual, the used one is not
    expect(canExhaust(s, racer)).toBe(false);
    expect(canExhaust(s, refueler)).toBe(true);
  });
});

describe('CR 702.195a-b, 602.2b, 118.9, 702.6a: "As long as you have an enduring story, you may pay {0} rather than pay the equip cost of the first equip ability you activate each turn."', () => {
  const SCOUT = card('Test Story Scout', 'Creature — Dwarf Scout', 'Storied\nAs long as you have an enduring story, you may pay {0} rather than pay the equip cost of the first equip ability you activate each turn.', ['1', '2']);
  const AXE = card('Test Axe', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {2}', undefined, '{1}');
  const COG = card('Test Cog', 'Artifact', '', undefined, '{1}');
  it('is automated', () => expect(automated(SCOUT)).toBe(true));
  const canEquip = (s: GameState, id: ObjectId): boolean => legal(s, 'p1', 'activate').some((a) => a.object === id);
  it('with an enduring story the first equip of the turn costs {0}; the second costs its equip cost; the next turn the first is free again', () => {
    let s = scenario([], { p1: { battlefield: ['Test Story Scout', 'Test Axe', 'Test Axe', 'Test Cog'] }, defs: [SCOUT, AXE, COG] });
    const [a1, a2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Axe');
    const scout = find(s, 'Test Story Scout', 'battlefield', 'p1');
    // three artifacts: the enduring story is had for the rest of the game (CR 702.195b)
    expect(s.designations.enduringStory).toContain('p1');
    expect(canEquip(s, a1!)).toBe(true);
    const equip = legal(s, 'p1', 'activate').find((x) => x.object === a1)!.action;
    s = drain(settle(act(s, equip), { targets: [[obj(scout)]] }), {});
    expect(s.objects[a1!]!.attachedTo).toBe(scout);
    // no land: the second equip ability can't be paid
    expect(canEquip(s, a2!)).toBe(false);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(canEquip(s, a2!)).toBe(true);
  });
  it('without an enduring story the equip cost is paid as usual', () => {
    const s = scenario([], { p1: { battlefield: ['Test Story Scout', 'Test Axe'] }, defs: [SCOUT, AXE] });
    expect(canEquip(s, find(s, 'Test Axe', 'battlefield', 'p1'))).toBe(false);
  });
});

describe('CR 607.2a, 701.59a, 608.2g, 614.1a: "Collect evidence N: ..." and "Whenever ~ attacks, you may cast an instant or sorcery spell from among cards exiled with it. If that spell would be put into a graveyard, put it on the bottom of its owner\'s library instead."', () => {
  const STRIDER = card('Test Strider', 'Artifact — Vehicle', "Collect evidence 3: This Vehicle becomes an artifact creature until end of turn.\nWhenever this Vehicle attacks, you may cast an instant or sorcery spell from among cards exiled with it. If that spell would be put into a graveyard, put it on the bottom of its owner's library instead.", ['3', '3'], '{3}');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{2}{R}');
  it('is automated, the collect evidence cost linked to the trigger (parser/parse.ts#linkExiled)', () => {
    expect(automated(STRIDER)).toBe(true);
    expect(JSON.stringify(STRIDER.faces[0]!.abilities[0])).toContain('"link":"exiled"');
  });
  it('the cards the cost exiled are "exiled with it": one may be cast as it attacks, then goes to the bottom of its owner\'s library', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Strider', 'Mountain', 'Mountain', 'Mountain'], graveyard: ['Test Bolt', 'Test Ox'] }, defs: [STRIDER, BOLT, OX] });
    const strider = find(s, 'Test Strider', 'battlefield', 'p1');
    const bolt = find(s, 'Test Bolt', 'graveyard', 'p1');
    s = activate(s, strider, 'p:0:0', { picks: [[bolt]] });
    const exiledBolt = exiled(s, 'Test Bolt')[0]!;
    expect(s.objects[strider]!.links?.['exiled']?.objects?.map((h) => h.id)).toContain(exiledBolt);
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: strider, defender: 'p2' }] });
    const q = { picks: [[exiledBolt]], targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] };
    s = drain(settle(s, q), q);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(17);
    const lib = s.zones.library['p1']!;
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe('Test Bolt');
  });
});

describe('CR 608.2g, 118.9, 101.4, 614.1a: "Each opponent mills three cards, then you may cast a spell from each opponent\'s graveyard without paying its mana cost. If a spell cast this way would be put into a graveyard, exile it instead."', () => {
  const SALVAGE = card('Test Salvage', 'Sorcery', "Each opponent mills three cards, then you may cast a spell from each opponent's graveyard without paying its mana cost. If a spell cast this way would be put into a graveyard, exile it instead.", undefined, '{1}');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{2}{R}');
  it('is automated, the rider on the cast for each opponent', () => {
    expect(automated(SALVAGE)).toBe(true);
    expect(JSON.stringify(SALVAGE.faces[0]!.abilities[0])).toContain('"graveyardInstead":{"to":{"zone":"exile"}}');
  });
  it('the spell cast from the opponent\'s graveyard is free and goes to exile; declining casts nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Salvage'], battlefield: ['Plains'] }, p2: { library: ['Test Bolt', 'Plains', 'Test Ox'] }, defs: [SALVAGE, BOLT, OX] });
    const q: Opts = { picks: [], targets: [[p2]] };
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Salvage', 'hand', 'p1') });
    s = settle(s, q);
    s = pass(pass(s));
    // the mill, then the choice among the opponent's nonland cards
    expect(s.pending?.kind).toBe('chooseObjects');
    const bolt = find(s, 'Test Bolt', 'graveyard', 'p2');
    s = drain(settle(answer(s, { kind: 'chooseObjects', ids: [bolt] }), q), q);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(17);
    expect(exiled(s, 'Test Bolt')).toHaveLength(1);
  });
});

describe('CR 601.2f-h, 602.2b, 302.6: "For each mana in this ability\'s activation cost, you may tap an untapped creature you control rather than pay that mana."', () => {
  const TOME = card('Test Tome', 'Artifact — Book', "{3}, {T}: You gain 2 life. For each mana in this ability's activation cost, you may tap an untapped creature you control rather than pay that mana. Activate only as a sorcery.", undefined, '{2}');
  const COLORED = card('Test Red Tome', 'Artifact', "{2}{R}, {T}: You gain 2 life. For each mana in this ability's activation cost, you may tap an untapped creature you control rather than pay that mana.", undefined, '{2}');
  const canUse = (s: GameState, id: ObjectId): boolean => legal(s, 'p1', 'activate').some((a) => a.object === id);
  it('is automated; with colored mana in the cost it is not', () => {
    expect(automated(TOME)).toBe(true);
    expect(TOME.faces[0]!.abilities.some((a) => a.kind === 'activated' && a.tapForMana !== undefined)).toBe(true);
    expect(automated(COLORED)).toBe(false);
  });
  it('three creatures pay the whole {3}; the ability is offered with no land at all', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tome', 'Test Grove Elf', 'Test Grove Elf', 'Test Ox'] }, defs: [TOME, GROVE_ELF, OX] });
    const tome = find(s, 'Test Tome', 'battlefield', 'p1');
    const creatures = s.zones.battlefield.filter((id) => s.objects[id]!.defId !== 'Test Tome');
    expect(canUse(s, tome)).toBe(true);
    const life = s.players.find((p) => p.id === 'p1')!.life;
    s = activate(s, tome, 'p:0:0', { picks: [creatures] });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life + 2);
    expect(creatures.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.objects[tome]!.tapped).toBe(true);
  });
  it('one creature and two lands pay it; two creatures and no land are not enough (not offered)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tome', 'Test Ox', 'Plains', 'Plains'] }, defs: [TOME, OX] });
    const tome = find(s, 'Test Tome', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    s = activate(s, tome, 'p:0:0', { picks: [[ox]] });
    expect(s.objects[ox]!.tapped).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains').every((id) => s.objects[id]!.tapped)).toBe(true);
    const t = scenario([], { p1: { battlefield: ['Test Tome', 'Test Ox', 'Test Grove Elf'] }, defs: [TOME, OX, GROVE_ELF] });
    expect(canUse(t, find(t, 'Test Tome', 'battlefield', 'p1'))).toBe(false);
  });
  it('a creature that came under your control this turn may be tapped this way (not a {T} cost, CR 302.6); an opponent\'s creature may not', () => {
    let s = scenario([], { p1: { hand: ['Test Ox'], battlefield: ['Test Tome', 'Test Grove Elf', 'Test Grove Elf', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Ox'] }, defs: [TOME, GROVE_ELF, OX] });
    s = cast(s, 'Test Ox', {}, 'p1');
    const tome = find(s, 'Test Tome', 'battlefield', 'p1');
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.defId !== 'Test Tome' && s.objects[id]!.defId !== 'Plains');
    expect(mine.length).toBe(3);
    expect(canUse(s, tome)).toBe(true); // the lands are tapped for the Ox: only the three creatures can pay
    s = activate(s, tome, 'p:0:0', { picks: [mine] });
    expect(mine.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.objects[find(s, 'Test Ox', 'battlefield', 'p2')]!.tapped).toBe(false);
  });
});

describe('CR 122.1, 400.7, 601.3, 305.1, 609.4b, 611.3a: "exile it from their graveyard with a bounty counter on it"; "During your turn, you may play cards you don\'t own with bounty counters on them from exile, and mana of any type can be spent to cast those spells."', () => {
  const THIEF = card('Test Bounty Thief', 'Legendary Creature — Skeleton Rogue', "Whenever an opponent discards a card, exile it from their graveyard with a bounty counter on it.\nDuring your turn, you may play cards you don't own with bounty counters on them from exile, and mana of any type can be spent to cast those spells.\n{1}, {T}: Each opponent discards a card. Activate only as a sorcery.", ['2', '2']);
  const TAKER = card('Test Taker', 'Instant', 'Exile target card from a graveyard.', undefined, '{0}');
  it('is automated', () => expect(automated(THIEF)).toBe(true));
  it('the discarded card is exiled with a bounty counter; its new owner-opponent\'s card is cast with Plains mana on your turn only', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bounty Thief', 'Plains', 'Plains'] }, p2: { hand: ['Test Shock'] }, defs: [THIEF, SHOCK] });
    s = activate(s, find(s, 'Test Bounty Thief', 'battlefield', 'p1'), 'p:0:2');
    const [shock] = exiled(s, 'Test Shock');
    expect(shock).toBeDefined();
    expect(s.objects[shock!]!.counters['bounty']).toBe(1);
    expect(castable(s)).toContain(shock);
    s = castFrom(s, shock!, { targets: [[p2]] });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
  });
  it('not during an opponent\'s turn; a land card is played from exile; a card without a bounty counter is not offered', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Bounty Thief', 'Plains'], hand: ['Test Taker'] }, p2: { hand: ['Mountain'], graveyard: ['Test Ox'] }, defs: [THIEF, OX, TAKER] });
    s = activate(s, find(s, 'Test Bounty Thief', 'battlefield', 'p1'), 'p:0:2');
    const [mountain] = exiled(s, 'Mountain');
    expect(s.objects[mountain!]!.counters['bounty']).toBe(1);
    // a card exiled another way has no bounty counter (CR 122.1)
    s = cast(s, 'Test Taker', { targets: [[obj(find(s, 'Test Ox', 'graveyard', 'p2'))]] });
    const [ox] = exiled(s, 'Test Ox');
    expect(s.objects[ox!]!.counters['bounty']).toBeUndefined();
    expect(castable(s)).not.toContain(ox);
    expect(legal(s, 'p1', 'playLand').map((a) => a.object)).toContain(mountain);
    s = act(s, { type: 'playLand', player: 'p1', card: mountain! });
    expect(onBattlefield(s, 'Mountain')).toBeDefined();
    expect(s.objects[onBattlefield(s, 'Mountain')!]!.controller).toBe('p1');
  });
  it('during the opponent\'s turn the exiled card is not offered (CR 611.3a)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bounty Thief', 'Plains', 'Plains'] }, p2: { hand: ['Test Shock'] }, defs: [THIEF, SHOCK] });
    s = activate(s, find(s, 'Test Bounty Thief', 'battlefield', 'p1'), 'p:0:2');
    const [shock] = exiled(s, 'Test Shock');
    s = passTo(s, (x) => x.turn.number === 2 && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    expect(castable(s)).not.toContain(shock);
  });
});
