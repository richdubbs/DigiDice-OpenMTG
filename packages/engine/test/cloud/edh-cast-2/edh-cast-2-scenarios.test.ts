/**
 * edh-cast-2 scenarios (Commander lane edh-cast; rulings-check fixes first, then new cards). Rules (Comprehensive Rules 2026-09-25):
 *   CR 115.1b, 303.4a          an Aura spell is targeted by its enchant ability: Spellskite / Mizzium Meddler can change it
 *   CR 115.7b, 115.3           "Change a target of target spell or ability to ~.": every "another target" tie must stay legal
 *   CR 604.3, 601.2f, 208.2a    a star-power creature spell's power comes from its characteristic-defining ability, in every zone (Goreclaw)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? (type.includes('Land') ? '' : '{0}'), type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const give = (s: GameState, player: 'p1' | 'p2', mana: string): void => { for (const t of mana) s.players[player === 'p1' ? 0 : 1]!.manaPool.push({ type: t } as never); };
const activations = (s: GameState, source: ObjectId, player: 'p1' | 'p2') => legalActions(s, player).filter((l) => l.kind === 'activate' && l.object === source);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage ?? 0;
const canCast = (s: GameState, id: ObjectId, player = 'p1'): boolean => {
  try { return settle(act(s, { type: 'cast', player, card: id })).zones.stack.length > 0; } catch { return false; }
};
function castTargeting(s0: GameState, name: string, targets: (ObjectId | TargetChoice | null)[], player: 'p1' | 'p2' = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  const rest = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'chooseTargets') { const t = rest.shift(); s = answer(s, { kind: 'chooseTargets', targets: t == null ? [] : [typeof t === 'string' ? obj(t) : t] }); }
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${s.pending.kind}`);
  }
  return s;
}

const SKITE = card('Test Skite', 'Artifact Creature — Horror', '{U}: Change a target of target spell or ability to ~.', { pt: ['0', '4'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SHACKLES = card('Test Shackles', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block.");

function skiteOn(s0: GameState, stackId: ObjectId, answerTargets?: TargetChoice[]): GameState {
  let s = s0;
  give(s, 'p2', 'U');
  s = pass(s);
  const a = activations(s, find(s, 'Test Skite', 'battlefield', 'p2'), 'p2')[0]!;
  s = settle(act(s, a.action), { targets: [obj(stackId)] });
  return answerTargets ? resolveAll(s, { targets: answerTargets }) : resolveAll(s);
}

describe('CR 115.1b, 303.4a, 115.7b: Spellskite takes over an Aura spell', () => {
  it('the Aura spell is attached to the creature that took it', () => {
    let s = scenario([], { p1: { hand: ['Test Shackles'] }, p2: { battlefield: ['Test Skite', 'Test Bear'] }, defs: [SKITE, SHACKLES, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = castTargeting(s, 'Test Shackles', [bear]);
    const aura = s.zones.stack[0]!;
    s = skiteOn(s, aura);
    const onBf = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Shackles')!;
    expect(s.objects[onBf]!.attachedTo).toBe(find(s, 'Test Skite', 'battlefield', 'p2'));
  });
  it('an Aura that cannot enchant the source stays on its target (Enchant land)', () => {
    const CURSE = card('Test Land Curse', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: Add {B}."');
    const FARM = card('Test Farm', 'Land', '');
    let s = scenario([], { p1: { hand: ['Test Land Curse'] }, p2: { battlefield: ['Test Skite', 'Test Farm'] }, defs: [SKITE, CURSE, FARM] });
    const farm = find(s, 'Test Farm', 'battlefield', 'p2');
    s = castTargeting(s, 'Test Land Curse', [farm]);
    s = skiteOn(s, s.zones.stack[0]!);
    const onBf = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Land Curse')!;
    expect(s.objects[onBf]!.attachedTo).toBe(farm);
  });
});

describe('CR 702.103a, 115.7b: a bestowed Aura spell can be taken over; CR 702.140a: a mutating spell keeps its target (the source is not a legal one)', () => {
  it('bestow: the Aura spell changes to the source and attaches to it', () => {
    const BESTOWER = card('Test Bestower', 'Enchantment Creature — Spirit', 'Bestow {0}\nEnchanted creature gets +1/+1.', { pt: ['1', '1'] });
    let s = scenario([], { p1: { hand: ['Test Bestower'] }, p2: { battlefield: ['Test Skite', 'Test Bear'] }, defs: [SKITE, BESTOWER, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bestower', 'hand', 'p1'), method: 'bestow' });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [obj(bear)] }) : answer(s, { kind: 'payCost', auto: true });
    }
    s = skiteOn(s, s.zones.stack[0]!);
    const onBf = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bestower')!;
    expect(s.objects[onBf]!.attachedTo).toBe(find(s, 'Test Skite', 'battlefield', 'p2'));
  });
  it('mutate: the spell has its non-Human target after the Aura-less targets; it merges as announced', () => {
    const MUTANT = card('Test Mutant', 'Creature — Beast', 'Mutate {0}', { pt: ['3', '3'] });
    let s = scenario([], { p1: { hand: ['Test Mutant'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Skite'] }, defs: [SKITE, MUTANT, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mutant', 'hand', 'p1'), method: 'mutate' });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [obj(bear)] }) : answer(s, { kind: 'payCost', auto: true });
    }
    const spell = s.zones.stack[0]!;
    s = skiteOn(s, spell);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(1); // merged into the Bear's permanent, not a separate one
    expect(dmg(s, find(s, 'Test Skite', 'battlefield', 'p2'))).toBe(0);
  });
});

describe('CR 115.7b, 115.3: "another target" ties stay legal', () => {
  const ARC = card('Test Arc', 'Sorcery', 'Test Arc deals 1 damage to target creature and 3 damage to another target creature.');
  const VICTIM = card('Test Victim', 'Creature — Bear', '', { pt: ['5', '5'] });
  const defs = [SKITE, ARC, VICTIM];
  const setup = (): { s: GameState; one: ObjectId; two: ObjectId; skite: ObjectId } => {
    let s = scenario([], { p1: { hand: ['Test Arc'], battlefield: ['Test Victim'] }, p2: { battlefield: ['Test Skite', 'Test Victim'] }, defs });
    const one = find(s, 'Test Victim', 'battlefield', 'p1');
    const two = find(s, 'Test Victim', 'battlefield', 'p2');
    s = castTargeting(s, 'Test Arc', [one, two]);
    return { s, one, two, skite: find(s, 'Test Skite', 'battlefield', 'p2') };
  };
  it('either target of a two-target spell with "another target" can become the source; the player picks which', () => {
    const a = setup();
    const r = skiteOn(a.s, a.s.zones.stack[0]!, [obj(a.two)]); // the second target ("another target", 3 damage) is the one changed
    expect(dmg(r, a.skite)).toBe(3);
    expect(dmg(r, a.one)).toBe(1);
    expect(dmg(r, a.two)).toBe(0);
    const b = setup();
    const r2 = skiteOn(b.s, b.s.zones.stack[0]!, [obj(b.one)]);
    expect(dmg(r2, b.skite)).toBe(1);
    expect(dmg(r2, b.two)).toBe(3);
  });
  it('refused when the source is already the other target', () => {
    let s = scenario([], { p1: { hand: ['Test Arc'], battlefield: ['Test Victim'] }, p2: { battlefield: ['Test Skite'] }, defs });
    const one = find(s, 'Test Victim', 'battlefield', 'p1');
    const skite = find(s, 'Test Skite', 'battlefield', 'p2');
    s = castTargeting(s, 'Test Arc', [skite, one]);
    const r = skiteOn(s, s.zones.stack[0]!, [obj(one)]);
    expect(dmg(r, skite)).toBe(1);
    expect(dmg(r, one)).toBe(3);
  });
});

describe('CR 604.3, 601.2f: Goreclaw reads a star-power creature spell\'s characteristic-defining power', () => {
  const GORECLAW = card('Test Goreclaw', 'Creature — Beast', 'Creature spells you cast with power 4 or greater cost {2} less to cast.', { pt: ['4', '3'] });
  const HYDRA = card('Test Star Hydra', 'Creature — Hydra', "Test Star Hydra's power and toughness are each equal to the number of lands you control.", { pt: ['*', '*'], cost: '{3}{G}', colors: ['G'] });
  const LAND = card('Test Land', 'Land', '');
  const defs = [GORECLAW, HYDRA, LAND];
  const mk = (lands: number, mana: string): boolean => {
    const s = scenario([], { p1: { battlefield: ['Test Goreclaw', ...Array<string>(lands).fill('Test Land')], hand: ['Test Star Hydra'] }, defs });
    give(s, 'p1', mana);
    return canCast(s, find(s, 'Test Star Hydra', 'hand', 'p1'));
  };
  it('with four lands the spell has power 4 and costs {1}{G}', () => { expect(mk(4, 'GG')).toBe(true); });
  it('with three lands the spell has power 3 and costs its full {3}{G}', () => { expect(mk(3, 'GG')).toBe(false); expect(mk(3, 'GGGG')).toBe(true); });
});

describe('CR 115.1, 109.4, 608.2b: "Return target spell or nonland permanent an opponent controls to its owner\'s hand."', () => {
  const SINK = card('Test Sink', 'Instant', "Return target spell or nonland permanent an opponent controls to its owner's hand.");
  const FARM = card('Test Farm', 'Land', '');
  const defs = [SINK, BEAR, FARM];
  const sinkCast = (s0: GameState, targets: (ObjectId | null)[]): GameState => castTargeting(s0, 'Test Sink', targets, 'p2');
  it('is automated', () => { expect(SINK.automation.level).toBe('full'); });
  const inHand = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.hand[player]!.some((id) => s.objects[id]!.defId === name);
  it("returns an opponent's spell to its owner's hand: it never resolves", () => {
    let s = scenario([], { p1: { hand: ['Test Bear'] }, p2: { hand: ['Test Sink'] }, defs });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }));
    const bear = s.zones.stack[0]!;
    s = pass(s);
    s = resolveAll(sinkCast(s, [bear]));
    expect(inHand(s, 'p1', 'Test Bear')).toBe(true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
  });
  it("returns an opponent's nonland permanent to its owner's hand", () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { hand: ['Test Sink'] }, defs });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = pass(s);
    s = resolveAll(sinkCast(s, [bear]));
    expect(inHand(s, 'p1', 'Test Bear')).toBe(true);
  });
  it('cannot take your own spell on the stack (the controller filter applies to the spell half)', () => {
    const t = scenario([], { p1: { hand: ['Test Sink', 'Test Bear'] }, defs });
    const u = settle(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Bear', 'hand', 'p1') }));
    expect(u.zones.stack.length).toBe(1);
    expect(canCast(u, find(u, 'Test Sink', 'hand', 'p1'), 'p1')).toBe(false);
  });
  it('cannot take an ability on the stack: only spells and permanents (the only candidate here is an ability of a land)', () => {
    const SPRING = card('Test Spring', 'Land', '{T}: You gain 1 life.');
    let s = scenario([], { p1: { battlefield: ['Test Spring'] }, p2: { hand: ['Test Sink'] }, defs: [...defs, SPRING] });
    const spring = find(s, 'Test Spring', 'battlefield', 'p1');
    s = settle(act(s, activations(s, spring, 'p1')[0]!.action));
    expect(s.zones.stack.length).toBe(1);
    s = pass(s);
    expect(canCast(s, find(s, 'Test Sink', 'hand', 'p2'), 'p2')).toBe(false);
  });
  it("cannot be cast with only an opponent's land, to take", () => {
    let s = scenario([], { p1: { battlefield: ['Test Farm'] }, p2: { hand: ['Test Sink'], battlefield: ['Test Bear'] }, defs });
    s = pass(s);
    expect(canCast(s, find(s, 'Test Sink', 'hand', 'p2'), 'p2')).toBe(false);
  });
});

describe('CR 601.3, 101.2, 611.2a: "{T}: Choose target nonland permanent card in your graveyard. If you haven\'t cast a spell this turn, you may cast that card. If you do, you can\'t cast additional spells this turn."', () => {
  const CONDUIT = card('Test Conduit', 'Artifact', "{T}: Choose target nonland permanent card in your graveyard. If you haven't cast a spell this turn, you may cast that card. If you do, you can't cast additional spells this turn. Activate only as a sorcery.");
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', { pt: ['2', '2'] });
  const CHARM = card('Test Charm', 'Instant', 'You gain 3 life.');
  const defs = [CONDUIT, GHOUL, CHARM];
  const use = (s: GameState, yes: boolean): GameState => {
    const a = activations(s, find(s, 'Test Conduit', 'battlefield', 'p1'), 'p1')[0]!;
    return resolveAll(settle(act(s, a.action), { targets: [obj(find(s, 'Test Ghoul', 'graveyard', 'p1'))] }), { yes });
  };
  it('is automated', () => { expect(CONDUIT.automation.level).toBe('full'); });
  it('casts the card from the graveyard, then no more spells can be cast this turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Conduit'], graveyard: ['Test Ghoul'], hand: ['Test Charm'] }, defs });
    s = use(s, true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ghoul')).toBe(true);
    expect(canCast(s, find(s, 'Test Charm', 'hand', 'p1'))).toBe(false);
  });
  it('declining the cast leaves the turn open for other spells', () => {
    let s = scenario([], { p1: { battlefield: ['Test Conduit'], graveyard: ['Test Ghoul'], hand: ['Test Charm'] }, defs });
    s = use(s, false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ghoul')).toBe(false);
    expect(canCast(s, find(s, 'Test Charm', 'hand', 'p1'))).toBe(true);
  });
  it('after a spell was cast this turn, the card is not cast', () => {
    let s = scenario([], { p1: { battlefield: ['Test Conduit'], graveyard: ['Test Ghoul'], hand: ['Test Charm'] }, defs });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand', 'p1') })));
    s = use(s, true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ghoul')).toBe(false);
  });
});

describe('CR 603.2d, 601.2i, 707.10: "If you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time."', () => {
  const WIZARD = card('Test Doubler', 'Creature — Wizard', "Whenever you cast or copy an instant or sorcery spell, you gain 1 life.\nWhenever a player casts a spell, you gain 10 life.\nIf you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.", { pt: ['2', '2'] });
  const CHARM = card('Test Charm', 'Instant', 'Draw a card.');
  const TWIN = card('Test Twin', 'Instant', 'Copy target instant spell.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [WIZARD, CHARM, TWIN, BEAR];
  const life = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => s.players[p === 'p1' ? 0 : 1]!.life;
  it('is automated', () => { expect(WIZARD.automation.level).toBe('full'); });
  it('casting an instant makes each trigger of your permanents happen twice; casting a creature spell does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Doubler'], hand: ['Test Charm', 'Test Bear'] }, defs });
    const base = life(s);
    const t = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand', 'p1') })));
    expect(life(t) - base).toBe(2 + 10 * 2); // the magecraft-like trigger twice, the cast trigger twice (every ability of a permanent you control)
    const u = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') })));
    expect(life(u) - base).toBe(10); // a creature spell is no cause: one trigger
  });
  it("copying a spell is a cause too, and an opponent's cast is not", () => {
    let s = scenario([], { p1: { battlefield: ['Test Doubler'], hand: ['Test Charm', 'Test Twin'] }, defs });
    const base = life(s);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand', 'p1') }));
    const charm = s.zones.stack[0]!;
    s = castTargeting(s, 'Test Twin', [charm]);
    s = resolveAll(s);
    // Charm cast: 2 + 20; Twin cast: 2 + 20; the copy of Charm: 2 (only the copy trigger; copying is no "casts a spell" for the 10-life trigger)
    expect(life(s) - base).toBe(2 + 20 + 2 + 20 + 2);
    const o = scenario([], { p1: { battlefield: ['Test Doubler'] }, p2: { hand: ['Test Charm'] }, defs });
    const b2 = life(o);
    const r = resolveAll(settle(act(pass(o), { type: 'cast', player: 'p2', card: find(o, 'Test Charm', 'hand', 'p2') })));
    expect(life(r) - b2).toBe(10); // the opponent's cast: "a player casts" once, not doubled, and no "you cast" trigger
  });
});

describe('CR 601.2i, 104.2b, 401.7: "If this spell was cast from your hand and you\'ve cast another spell named ~ this game, you win the game. Otherwise, put ~ into its owner\'s library seventh from the top and you gain 7 life."', () => {
  const APPROACH = card('Test Approach', 'Sorcery', "If this spell was cast from your hand and you've cast another spell named Test Approach this game, you win the game. Otherwise, put Test Approach into its owner's library seventh from the top and you gain 7 life.");
  const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  const defs = [APPROACH, FILLER];
  const lib = (s: GameState, p: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones.library[p]!;
  const cast = (s: GameState, name = 'Test Approach'): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') })));
  it('is automated', () => { expect(APPROACH.automation.level).toBe('full'); });
  it('the first cast goes seventh from the top and gains 7; the second one wins', () => {
    let s = scenario([], { p1: { hand: ['Test Approach', 'Test Approach'] }, defs });
    const base = s.players[0]!.life;
    s = cast(s);
    expect(s.players[0]!.life).toBe(base + 7);
    expect(s.result).toBeNull();
    const idx = lib(s).findIndex((id) => s.objects[id]!.defId === 'Test Approach');
    expect(idx).toBe(6); // seventh from the top
    s = cast(s);
    expect(s.result?.winner).toBe('p1');
  });
  it('with fewer than six other cards in the library the spell goes to the bottom (ruling 2017-04-18)', () => {
    let s = scenario([], { p1: { hand: ['Test Approach'] }, defs });
    s.zones.library.p1 = s.zones.library.p1!.slice(0, 3);
    s = cast(s);
    expect(lib(s).length).toBe(4);
    expect(s.objects[lib(s)[3]!]!.defId).toBe('Test Approach');
  });
  it('the same card cast again on a later turn is another spell: it wins (the first cast was a different object, rulings 2017-04-18)', () => {
    let s = scenario([], { p1: { hand: ['Test Approach'] }, defs });
    s = cast(s);
    expect(s.result).toBeNull();
    const id = lib(s).find((x) => s.objects[x]!.defId === 'Test Approach')!;
    s.zones.library.p1 = lib(s).filter((x) => x !== id);
    s.zones.hand.p1!.push(id);
    s.objects[id]!.zone = 'hand';
    s = cast(s);
    expect(s.result?.winner).toBe('p1');
  });
  it('another spell does not count: the first Approach alone only gains life', () => {
    let s = scenario([], { p1: { hand: ['Test Approach', 'Test Filler'] }, defs });
    s = cast(s, 'Test Filler');
    s = cast(s);
    expect(s.result).toBeNull();
    expect(lib(s).some((id) => s.objects[id]!.defId === 'Test Approach')).toBe(true);
  });
});

describe('CR 608.2c, 118.9, 305.9, 101.4: "each player exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs."', () => {
  const ETALI = card('Test Conqueror', 'Creature — Phyrexian', 'When ~ enters, each player exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs.', { pt: ['6', '6'] });
  const MINE = card('Test Gain Three', 'Sorcery', 'You gain 3 life.');
  const THEIRS = card('Test Gain Five', 'Sorcery', 'You gain 5 life.');
  const LAND = card('Test Land', 'Land', '');
  const defs = [ETALI, MINE, THEIRS, LAND];
  const run = (picks: (opts: ObjectId[]) => ObjectId[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Conqueror'], library: ['Test Land', 'Test Gain Three'] }, p2: { library: ['Test Land', 'Test Land', 'Test Gain Five'] }, defs });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Conqueror', 'hand', 'p1') });
    for (let guard = 0; guard < 60 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); guard++) {
      const d = s.pending;
      if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: picks((d as unknown as { options: ObjectId[] }).options) });
      else if (d?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d?.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
      else if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else s = pass(s);
    }
    return s;
  };
  it('is automated', () => { expect(ETALI.automation.level).toBe('full'); });
  it('every player exiles to their first nonland card and you may cast any number of them, theirs too', () => {
    const base = scenario([], { p1: { hand: ['Test Conqueror'] }, defs }).players[0]!.life;
    const s = run((o) => o);
    expect(s.players[0]!.life).toBe(base + 3 + 5);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Land').length).toBe(3); // the lands stay exiled
  });
  it('casting none leaves the nonland cards exiled', () => {
    const base = scenario([], { p1: { hand: ['Test Conqueror'] }, defs }).players[0]!.life;
    const s = run(() => []);
    expect(s.players[0]!.life).toBe(base);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Gain Five')).toBe(true);
  });
});
