/**
 * edh-next-56 (Commander lane exile-play): the round's readings played through applyAction with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
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
const onBattlefield = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => s.objects[id]!.defId === name);
const exiled = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '4'], '{3}{W}');
const BEHEMOTH = card('Test Behemoth', 'Creature — Beast', '', ['6', '6'], '{4}{G}{G}');
const life = (s: GameState, id: 'p1' | 'p2'): number => s.players.find((p) => p.id === id)!.life;

describe('CR 607.2a, 611.2a, 601.3, 118.9: "Until end of turn, you may cast a spell from among cards exiled with ~ without paying its mana cost." (ONE spell, for free)', () => {
  const VAULT = card('Test Vault', 'Artifact', '{0}: Exile the top card of your library.\n{T}: Until end of turn, you may cast a spell from among cards exiled with this artifact without paying its mana cost.');
  it('is automated', () => expect(automated(VAULT)).toBe(true));
  it('with no mana, one exiled spell is cast for free; the other is then not offered; a land card is never offered (it is not a spell)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Vault'], library: ['Test Ox', 'Plains', 'Test Behemoth'] }, defs: [VAULT, OX, BEHEMOTH] });
    const vault = find(s, 'Test Vault', 'battlefield', 'p1');
    s = activate(s, vault, 'p:0:0');
    s = activate(s, vault, 'p:0:0');
    s = activate(s, vault, 'p:0:0');
    expect(s.zones.exile.length).toBe(3);
    const ox = exiled(s, 'Test Ox')[0]!;
    const plains = exiled(s, 'Plains')[0]!;
    const big = exiled(s, 'Test Behemoth')[0]!;
    expect(castable(s)).not.toContain(ox); // nothing is offered before the permission exists
    s = activate(s, vault, 'p:0:1');
    expect(castable(s)).toContain(ox);
    expect(castable(s)).toContain(big);
    expect(castable(s)).not.toContain(plains);
    expect(legal(s, 'p1', 'playLand').map((a) => a.object)).not.toContain(plains);
    s = castFrom(s, big);
    expect(onBattlefield(s, 'Test Behemoth')).toBeDefined();
    expect(castable(s)).not.toContain(ox); // one spell only
  });
  it('the permission ends with the turn, and the exiled card is not castable by the opponent', () => {
    let s = scenario([], { p1: { battlefield: ['Test Vault'], library: ['Test Ox', 'Test Ox'] }, defs: [VAULT, OX] });
    const vault = find(s, 'Test Vault', 'battlefield', 'p1');
    s = activate(s, vault, 'p:0:0');
    const ox = exiled(s, 'Test Ox')[0]!;
    s = activate(s, vault, 'p:0:1');
    expect(castable(s)).toContain(ox);
    expect(castable(s, 'p2')).not.toContain(ox);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(castable(s)).not.toContain(ox);
  });
});

describe('CR 611.2b, 108.3, 601.3, 118.9: "Exile target nonland permanent. For as long as that card remains exiled, its owner may cast it without paying its mana cost."', () => {
  const WIND = card('Test Wind', 'Instant', 'Exile target nonland permanent. For as long as that card remains exiled, its owner may cast it without paying its mana cost.', undefined, '{0}');
  const OXEN = card('Test Oxen', 'Creature — Ox', 'Flash', ['1', '4'], '{3}{W}');
  it('is automated', () => expect(automated(WIND)).toBe(true));
  it("the permanent's owner (not the caster) may cast it for free, with no mana; the caster may not", () => {
    let s = scenario([], { p1: { hand: ['Test Wind'] }, p2: { battlefield: ['Test Oxen'] }, defs: [WIND, OXEN] });
    const target = find(s, 'Test Oxen', 'battlefield', 'p2');
    s = cast(s, 'Test Wind', { targets: [[obj(target)]] });
    const card2 = exiled(s, 'Test Oxen')[0]!;
    expect(card2).toBeDefined();
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(castable(s, 'p2')).toContain(card2);
    expect(castable(s)).not.toContain(card2);
  });
  it('when the card has left exile it is a new object and is no longer castable (CR 400.7)', () => {
    let s = scenario([], { p1: { hand: ['Test Wind'] }, p2: { battlefield: ['Test Oxen'] }, defs: [WIND, OXEN] });
    const target = find(s, 'Test Oxen', 'battlefield', 'p2');
    s = cast(s, 'Test Wind', { targets: [[obj(target)]] });
    const c = exiled(s, 'Test Oxen')[0]!;
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    s = castFrom(s, c, {}, 'p2');
    expect(onBattlefield(s, 'Test Oxen')).toBeDefined();
    expect(exiled(s, 'Test Oxen')).toEqual([]);
  });
});

describe('CR 603.12, 608.2c, 608.2h: "Exile the top card of your library. You may play that card this turn. When you exile a nonland card this way, ~ deals damage equal to the exiled card\'s mana value to any target."', () => {
  const FIEND = card('Test Fiend', 'Creature — Demon', '{T}: Exile the top card of your library. You may play that card this turn. When you exile a nonland card this way, ~ deals damage equal to the exiled card\'s mana value to any target.', ['1', '1']);
  it('is automated', () => expect(automated(FIEND)).toBe(true));
  it('a nonland card: damage equal to its mana value to the chosen target (a player); the card is playable this turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Fiend'], library: ['Test Behemoth', 'Plains'] }, defs: [FIEND, BEHEMOTH] });
    const fiend = find(s, 'Test Fiend', 'battlefield', 'p1');
    s = activate(s, fiend, 'p:0:0', { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(20 - 6);
    expect(exiled(s, 'Test Behemoth').length).toBe(1);
  });
  it('a land card: no trigger, no damage (the condition asks for a nonland card)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Fiend'], library: ['Plains', 'Test Behemoth'] }, defs: [FIEND, BEHEMOTH] });
    const fiend = find(s, 'Test Fiend', 'battlefield', 'p1');
    s = activate(s, fiend, 'p:0:0', { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 406.3, 701.20e, 611.2a, 601.3: "Exile the top card of your library face down. You may look at and play that card this turn."', () => {
  const SCOUT = card('Test Scout', 'Creature — Elf Rogue', '{T}: Exile the top card of your library face down. You may look at and play that card this turn.', ['1', '1']);
  it('is automated', () => expect(automated(SCOUT)).toBe(true));
  it('the face-down card can be cast this turn and not on a later turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Scout', 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Ox', 'Plains'] }, defs: [SCOUT, OX] });
    const scout = find(s, 'Test Scout', 'battlefield', 'p1');
    s = activate(s, scout, 'p:0:0');
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(castable(s)).toContain(ox);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(castable(s)).not.toContain(ox);
  });
});

describe('CR 607.2a, 400.7, 108.3: "{T}, Sacrifice this land: Return each creature card exiled with this land to the battlefield under its owner\'s control."', () => {
  const DUNES = card('Test Dunes', 'Land', '{0}: Exile target permanent you control.\n{T}, Sacrifice this land: Return each creature card exiled with this land to the battlefield under its owner\'s control.');
  const IDOL = card('Test Idol', 'Artifact', '', undefined, '{0}');
  it('is automated', () => expect(automated(DUNES)).toBe(true));
  it('returns the creature cards it exiled (the land is sacrificed as a cost, its link is read as it last existed) and leaves a non-creature card in exile', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dunes', 'Test Ox', 'Test Idol'] }, defs: [DUNES, OX, IDOL] });
    const dunes = find(s, 'Test Dunes', 'battlefield', 'p1');
    s = activate(s, dunes, 'p:0:0', { targets: [[obj(find(s, 'Test Ox', 'battlefield', 'p1'))]] });
    s = activate(s, dunes, 'p:0:0', { targets: [[obj(find(s, 'Test Idol', 'battlefield', 'p1'))]] });
    expect(exiled(s, 'Test Ox').length + exiled(s, 'Test Idol').length).toBe(2);
    s = activate(s, dunes, 'p:0:1');
    expect(onBattlefield(s, 'Test Ox')).toBeDefined();
    expect(s.objects[onBattlefield(s, 'Test Ox')!]!.controller).toBe('p1');
    expect(exiled(s, 'Test Idol').length).toBe(1);
    expect(onBattlefield(s, 'Test Dunes')).toBeUndefined();
  });
});

describe('CR 607.2a, 603.10a, 400.7: "When this creature leaves the battlefield, return each card exiled with it to the battlefield under your control."', () => {
  const CATCHER = card('Test Catcher', 'Creature — Spirit', 'Whenever you sacrifice another creature, exile it.\n{0}, Sacrifice another creature: You gain 1 life.\n{0}, Sacrifice this creature: You gain 1 life.\nWhen this creature leaves the battlefield, return each card exiled with it to the battlefield under your control.', ['2', '2']);
  it('is automated', () => expect(automated(CATCHER)).toBe(true));
  it('every sacrificed creature it exiled comes back under your control when it leaves; nothing comes back before that', () => {
    let s = scenario([], { p1: { battlefield: ['Test Catcher', 'Test Ox'] }, defs: [CATCHER, OX] });
    const catcher = find(s, 'Test Catcher', 'battlefield', 'p1');
    s = activate(s, catcher, 'p:0:1', { picks: [[find(s, 'Test Ox', 'battlefield', 'p1')]] });
    expect(exiled(s, 'Test Ox').length).toBe(1);
    expect(onBattlefield(s, 'Test Ox')).toBeUndefined();
    s = activate(s, catcher, 'p:0:2');
    expect(onBattlefield(s, 'Test Catcher')).toBeUndefined();
    expect(onBattlefield(s, 'Test Ox')).toBeDefined();
    expect(exiled(s, 'Test Ox').length).toBe(0);
  });
});

describe('CR 607.2a, 122.6, 614.1c: "You may put a creature card exiled with ~ onto the battlefield under your control with a finality counter on it."', () => {
  const CRYSTAL = card('Test Crystal', 'Artifact', '{0}: Exile target permanent you control.\n{0}: You may put a creature card exiled with this artifact onto the battlefield under your control with a finality counter on it.');
  const IDOL = card('Test Idol', 'Artifact', '', undefined, '{0}');
  it('is automated', () => expect(automated(CRYSTAL)).toBe(true));
  it('the chosen creature card (never the artifact card) enters under your control with the counter', () => {
    let s = scenario([], { p1: { battlefield: ['Test Crystal', 'Test Ox', 'Test Idol'] }, defs: [CRYSTAL, OX, IDOL] });
    const crystal = find(s, 'Test Crystal', 'battlefield', 'p1');
    s = activate(s, crystal, 'p:0:0', { targets: [[obj(find(s, 'Test Idol', 'battlefield', 'p1'))]] });
    s = activate(s, crystal, 'p:0:0', { targets: [[obj(find(s, 'Test Ox', 'battlefield', 'p1'))]] });
    s = activate(s, crystal, 'p:0:1', { answers: [{ kind: 'yesNo', yes: true } as unknown as DecisionAnswer] });
    const ox = onBattlefield(s, 'Test Ox');
    expect(ox).toBeDefined();
    expect(s.objects[ox!]!.counters['finality']).toBe(1);
    expect(exiled(s, 'Test Idol').length).toBe(1);
  });
});

describe('CR 601.2f, 607.2a, 117.7: "Legendary spells you cast cost {1} less to cast for each card exiled with ~."', () => {
  const FUNERAL = card('Test Funeral', 'Artifact', '{0}: Exile target card from your graveyard.\nLegendary spells you cast cost {1} less to cast for each card exiled with this artifact.');
  const KING = card('Test King', 'Legendary Creature — Ox', '', ['2', '2'], '{2}{W}');
  const PEON = card('Test Peon', 'Creature — Ox', '', ['2', '2'], '{2}{W}');
  it('is automated', () => expect(automated(FUNERAL)).toBe(true));
  it('each exiled card takes {1} off a legendary spell and off nothing else', () => {
    let s = scenario([], { p1: { battlefield: ['Test Funeral', 'Plains'], hand: ['Test King', 'Test Peon'], graveyard: ['Test Ox', 'Test Ox'] }, defs: [FUNERAL, KING, PEON, OX] });
    const funeral = find(s, 'Test Funeral', 'battlefield', 'p1');
    expect(castable(s)).toEqual([]); // {2}{W} with one Plains
    s = activate(s, funeral, 'p:0:0', { targets: [[obj(s.zones.graveyard['p1']![0]!)]] });
    expect(castable(s)).toEqual([]); // {1}{W}: still two lands short of one
    s = activate(s, funeral, 'p:0:0', { targets: [[obj(s.zones.graveyard['p1']![0]!)]] });
    const king = find(s, 'Test King', 'hand', 'p1');
    expect(castable(s)).toEqual([king]); // {W}: only the legendary one
  });
});
