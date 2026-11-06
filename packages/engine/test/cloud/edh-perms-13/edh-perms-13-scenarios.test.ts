/**
 * Commander lane edh-perms, round edh-perms-13: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler, in 3-player Free-for-All games (CR 806). Alice (p1) is the active player, so APNAP order is Alice, Bob, Carol (CR 101.4). CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 109.4, 101.4   "each player who controls an artifact or enchantment": the players who control at least one such permanent as the instruction is performed
 *   CR 608.2c, 608.2h "each player other than its controller creates a token that's a copy of it": the exiled permanent's controller as it last existed
 *   CR 707.2, 707.9a-b, 613.1a "you may have it become a copy of another target Dinosaur you control, except its name is ~ and it has this ability"
 *   CR 725.1, 707.2, 707.9a "If you're the monarch, you may create a token that's a copy of it. If you're not the monarch, you may have ~ become a copy of it, except it has this ability."
 *   CR 707.2, 508.4, 110.5b "create a token that's a copy of another target attacking creature and that's tapped and attacking. Exile the token at end of combat."
 *   CR 601.2i, 603.2, 113.6k "When you cast this spell and whenever ~ attacks": one ability that functions on the stack (the cast event) and on the battlefield (the attack)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, lifeOf, mpScenario, resolveStack } from '../../m12/rules/helpers';
import { act as act2, advanceTo, answer as answer2, find as find2, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const manualOf = (d: CardDef): string[] => [...d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text), ...(JSON.stringify(d.faces).includes('"op":"manual"') ? ['a manual step'] : [])];

const DIVIDEND = card('Test Dividend', 'Sorcery', 'Each player who controls an artifact gains 3 life.');
const SPLIT = card('Test Split', 'Sorcery', 'Each player who controls an artifact or enchantment creates a 1/1 white Spirit creature token. Then destroy all artifacts and enchantments.');
const SPLINTER = card('Test Splinter', 'Sorcery', "Exile target creature. Each player other than its controller creates a token that's a copy of it.");
const ROD = card('Test Rod', 'Artifact', '');
const HALO = card('Test Halo', 'Enchantment', '');
const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['3', '3'] });
const SACK = card('Test Sack', 'Sorcery', 'Each player who controls an artifact sacrifices an artifact.');
const TITHE = card('Test Tithe', 'Sorcery', 'Exile target creature. Each player other than its controller discards a card.');
const DEFS = [DIVIDEND, SPLIT, SPLINTER, SACK, TITHE, ROD, HALO, GIANT];

type Z = Partial<Record<'hand' | 'battlefield' | 'graveyard', string[]>>;
const game = (spell: string, zones: Partial<Record<PlayerId, Z>>): GameState =>
  mpScenario({ players: 3, defs: DEFS, zones: { ...zones, p1: { ...(zones.p1 ?? {}), hand: [spell, ...(zones.p1?.hand ?? [])] } } });

/** Alice casts `name` (at `target` when given); mana is paid automatically. */
function cast(s0: GameState, name: string, target?: string): GameState {
  let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let i = 0; i < 100 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
    if (t.pending?.kind === 'priority') { t = act(t, { type: 'pass', player: t.pending.player }); continue; }
    const p = t.pending!;
    if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: target === undefined ? [] : [{ kind: 'object', id: target }] });
    else if (p.kind === 'chooseObjects') t = answer(t, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return resolveStack(t);
}
const onField = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const lifeGain = (s: GameState, s0: GameState): number[] => (['p1', 'p2', 'p3'] as const).map((p) => lifeOf(s, p) - lifeOf(s0, p));

describe('design 6.9: the round\'s test cards compile to data, nothing manual', () => {
  it('no manual ability or step', () => { for (const d of [DIVIDEND, SPLIT, SPLINTER]) expect(manualOf(d), d.name).toEqual([]); });
});

describe('CR 109.4, 101.4: "Each player who controls an artifact gains 3 life."', () => {
  it('only the players who control an artifact gain life; an enchantment or a graveyard artifact does not count', () => {
    const s0 = game('Test Dividend', { p1: { battlefield: ['Test Rod'] }, p2: { battlefield: ['Test Halo'], graveyard: ['Test Rod'] }, p3: { battlefield: ['Test Rod', 'Test Rod'] } });
    expect(lifeGain(cast(s0, 'Test Dividend'), s0)).toEqual([3, 0, 3]);
  });
  it('a player who controls two of them gains once (the group is players, not permanents)', () => {
    const s0 = game('Test Dividend', { p3: { battlefield: ['Test Rod', 'Test Rod'] } });
    expect(lifeGain(cast(s0, 'Test Dividend'), s0)).toEqual([0, 0, 3]);
  });
  it('nobody controls an artifact: nobody gains life (unlike "controls the most", which ties at zero)', () => {
    const s0 = game('Test Dividend', {});
    expect(lifeGain(cast(s0, 'Test Dividend'), s0)).toEqual([0, 0, 0]);
  });
});

describe('CR 101.4, 701.21a: a group instruction reaches every player of the group: "Each player who controls an artifact sacrifices an artifact." / "Each player other than its controller discards a card."', () => {
  it('every player with an artifact sacrifices one (not only the first), the others lose nothing', () => {
    const s0 = game('Test Sack', { p1: { battlefield: ['Test Rod', 'Test Rod'] }, p2: { battlefield: ['Test Halo'] }, p3: { battlefield: ['Test Rod'] } });
    const s = cast(s0, 'Test Sack');
    expect([onField(s, 'p1'), onField(s, 'p2'), onField(s, 'p3')]).toEqual([['Test Rod'], ['Test Halo'], []]);
  });
  it('every player other than the exiled creature\'s controller discards a card; its controller keeps their hand', () => {
    const s0 = game('Test Tithe', { p1: { hand: ['Test Rod'] }, p2: { battlefield: ['Test Giant'], hand: ['Test Rod'] }, p3: { hand: ['Test Halo'] } });
    const s = cast(s0, 'Test Tithe', find(s0, 'Test Giant', 'battlefield', 'p2'));
    const gy = (p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect([gy('p1'), gy('p2'), gy('p3')]).toEqual([['Test Rod', 'Test Tithe'], [], ['Test Halo']]); // (the resolved spell is in its caster's graveyard)
  });
});

describe('CR 109.4, 608.2c: "Each player who controls an artifact or enchantment creates a token. Then destroy all artifacts and enchantments."', () => {
  it('the players are judged before the destroy: each of them gets a token, and the artifacts and enchantments are gone', () => {
    const s0 = game('Test Split', { p1: { battlefield: ['Test Halo'] }, p2: { battlefield: ['Test Rod'] }, p3: { battlefield: ['Test Giant'] } });
    const s = cast(s0, 'Test Split');
    expect(onField(s, 'p1')).toEqual(['Spirit Token']);
    expect(onField(s, 'p2')).toEqual(['Spirit Token']);
    expect(onField(s, 'p3')).toEqual(['Test Giant']);
  });
});

describe('CR 608.2c, 608.2h: "Exile target creature. Each player other than its controller creates a token that\'s a copy of it."', () => {
  it('the other two players each get a copy; the controller gets none', () => {
    const s0 = game('Test Splinter', { p2: { battlefield: ['Test Giant'] } });
    const s = cast(s0, 'Test Splinter', find(s0, 'Test Giant', 'battlefield', 'p2'));
    expect(onField(s, 'p1')).toEqual(['Test Giant']);
    expect(onField(s, 'p2')).toEqual([]);
    expect(onField(s, 'p3')).toEqual(['Test Giant']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
  });
  it('the copies are of the permanent as it last existed, without its +1/+1 counters (copiable values only, CR 707.2)', () => {
    const s0 = game('Test Splinter', { p2: { battlefield: ['Test Giant'] } });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    s0.objects[giant]!.counters = { '+1/+1': 2 };
    const s = cast(s0, 'Test Splinter', giant);
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(copies.map((id) => `${getChars(s, id).power}/${getChars(s, id).toughness}`)).toEqual(['3/3', '3/3']);
  });
  it('exiling a token: the token ceases to exist, but the other players still get copies of it (last known information)', () => {
    const s0 = game('Test Splinter', { p2: { battlefield: ['Test Giant'] } });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    s0.objects[giant]!.kind = 'token';
    const s = cast(s0, 'Test Splinter', giant);
    expect([onField(s, 'p1'), onField(s, 'p2'), onField(s, 'p3')]).toEqual([['Test Giant'], [], ['Test Giant']]);
  });
  it('when the caster controls the exiled creature, the two opponents each get a copy', () => {
    const s0 = game('Test Splinter', { p1: { battlefield: ['Test Giant'] } });
    const s = cast(s0, 'Test Splinter', find(s0, 'Test Giant', 'battlefield', 'p1'));
    expect([onField(s, 'p1'), onField(s, 'p2'), onField(s, 'p3')]).toEqual([[], ['Test Giant'], ['Test Giant']]);
  });
});

describe('CR 601.2i, 603.2, 113.6k: "When you cast this spell and whenever this creature attacks, destroy up to one target nonland permanent. Its controller creates a tapped Powerstone token."', () => {
  const LEVELER = card('Test Leveler', 'Artifact Creature — Construct', 'Trample\nWhen you cast this spell and whenever this creature attacks, destroy up to one target nonland permanent. Its controller creates a tapped Powerstone token.', { pt: ['4', '4'] });
  const CANTRIP = card('Test Cantrip', 'Instant', 'You gain 1 life.');
  const defs = [LEVELER, CANTRIP, ROD];
  const rods = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Test Rod').length;
  const stones = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && /^Powerstone/.test(s.defs[s.objects[id]!.defId]!.name)).length;
  /** Answer the decisions of the stack until it is empty: pay mana, target `rod` for the trigger. */
  function settle(s0: GameState, target?: string): GameState {
    let t = s0;
    for (let i = 0; i < 60 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
      if (t.pending?.kind === 'priority') { t = pass(t); continue; }
      const p = t.pending!;
      if (p.kind === 'payCost') t = answer2(t, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseTargets') t = answer2(t, { kind: 'chooseTargets', targets: target === undefined ? [] : [{ kind: 'object', id: target }] });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return t;
  }
  it('is fully automated and functions on the stack and on the battlefield', () => {
    expect(manualOf(LEVELER)).toEqual([]);
    const trig = LEVELER.faces[0]!.abilities.find((a) => a.kind === 'triggered') as { zone?: string[]; trigger: { on: { ev: string }[] } };
    expect([...(trig.zone ?? [])].sort()).toEqual(['battlefield', 'stack']);
    expect(trig.trigger.on.map((e) => e.ev)).toEqual(['cast', 'attacks']);
  });
  it('casting it triggers from the stack: the target is destroyed and its controller gets a Powerstone; the spell then enters without a second trigger', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Leveler'] }, p2: { battlefield: ['Test Rod', 'Test Rod'] } });
    const rod = find2(s0, 'Test Rod', 'battlefield', 'p2');
    const s = settle(act2(s0, { type: 'cast', player: 'p1', card: find2(s0, 'Test Leveler', 'hand', 'p1') }), rod);
    expect(rods(s, 'p2')).toBe(1);
    expect(stones(s, 'p2')).toBe(1);
    expect(stones(s, 'p1')).toBe(0);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Leveler')).toBe(true);
  });
  it('on the battlefield, attacking triggers it, and casting another spell does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Leveler'], hand: ['Test Cantrip'] }, p2: { battlefield: ['Test Rod', 'Test Rod'] } });
    const cast = settle(act2(advanceTo(s0, 3, 'main1'), { type: 'cast', player: 'p1', card: find2(s0, 'Test Cantrip', 'hand', 'p1') }));
    expect(rods(cast, 'p2')).toBe(2);
    let s = toDeclareAttackers(cast);
    const rod = find2(s, 'Test Rod', 'battlefield', 'p2');
    s = declareAttackers(s, [[find2(s, 'Test Leveler', 'battlefield', 'p1')]]);
    s = settle(s, rod);
    expect(rods(s, 'p2')).toBe(1);
    expect(stones(s, 'p2')).toBe(1);
  });
});

describe('CR 707.2, 707.9a-b, 613.1a: "Whenever this creature attacks, you may have it become a copy of another target Dinosaur you control, except its name is ~ and it has this ability."', () => {
  const IMITATOR = card('Test Imitator', 'Creature — Dinosaur', 'Whenever this creature attacks, you may have it become a copy of another target Dinosaur you control, except its name is Test Imitator and it has this ability.', { pt: ['2', '2'] });
  const REX = card('Test Rex', 'Creature — Dinosaur', 'Trample', { pt: ['6', '5'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
  const defs = [IMITATOR, REX, BEAR];
  const stat = (s: GameState, id: string): string => `${getChars(s, id).name} ${getChars(s, id).power}/${getChars(s, id).toughness}`;
  function attack(rex: boolean, yes: boolean, other: string): { s: GameState; id: string } {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Imitator', ...(rex ? ['Test Rex'] : []), other] } });
    let s = toDeclareAttackers(advanceTo(s0, 3, 'main1'));
    const id = find2(s, 'Test Imitator', 'battlefield', 'p1');
    s = declareAttackers(s, [[id]]);
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      if (s.pending?.kind === 'priority') { s = pass(s); continue; }
      const p = s.pending!;
      if (p.kind === 'chooseTargets') s = answer2(s, { kind: 'chooseTargets', targets: rex ? [{ kind: 'object', id: find2(s, 'Test Rex', 'battlefield', 'p1') }] : [] });
      else if (p.kind === 'yesNo') s = answer2(s, { kind: 'yesNo', yes });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return { s, id };
  }
  it('is fully automated', () => expect(manualOf(IMITATOR)).toEqual([]));
  it('attacking: it becomes a copy of the other Dinosaur (6/5 with trample) but keeps its own name and the ability', () => {
    const { s, id } = attack(true, true, 'Test Bear');
    expect(stat(s, id)).toBe('Test Imitator 6/5');
    expect(getChars(s, id).keywords.some((k) => k.keyword === 'trample')).toBe(true);
    expect(s.zones.battlefield.some((x) => x === id)).toBe(true);
  });
  it('declining the "may" leaves it a 2/2', () => {
    const { s, id } = attack(true, false, 'Test Bear');
    expect(stat(s, id)).toBe('Test Imitator 2/2');
  });
  it('a Bear is no Dinosaur, and the Imitator is not "another" Dinosaur than itself: with no other Dinosaur nothing happens', () => {
    const { s, id } = attack(false, true, 'Test Bear');
    expect(stat(s, id)).toBe('Test Imitator 2/2');
  });
});

describe('CR 725.1, 707.2, 707.9a: the monarch makes a token copy; anyone else makes the enchantment itself a copy, with this ability', () => {
  const COURT = card('Test Court', 'Enchantment', "At the beginning of your upkeep, choose up to one other target enchantment or artifact. If you're the monarch, you may create a token that's a copy of it. If you're not the monarch, you may have this enchantment become a copy of it, except it has this ability.");
  const IDOL = card('Test Idol', 'Artifact', 'Flying');
  const defs = [COURT, IDOL];
  function upkeep(monarch: boolean, target: boolean): GameState {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Court', 'Test Idol'] } });
    if (monarch) s0.designations.monarch = 'p1';
    let s = advanceTo(s0, 3, 'upkeep');
    const idol = find2(s0, 'Test Idol', 'battlefield', 'p1');
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      if (s.pending?.kind === 'priority') { s = pass(s); continue; }
      const p = s.pending!;
      if (p.kind === 'chooseTargets') s = answer2(s, { kind: 'chooseTargets', targets: target ? [{ kind: 'object', id: idol }] : [] });
      else if (p.kind === 'yesNo') s = answer2(s, { kind: 'yesNo', yes: true });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return s;
  }
  const names2 = (s: GameState): string[] => s.zones.battlefield.map((id) => getChars(s, id).name).sort();
  it('is fully automated', () => expect(manualOf(COURT)).toEqual([]));
  it('the monarch gets a token copy of the artifact; the Court stays an enchantment', () => {
    const s = upkeep(true, true);
    expect(names2(s)).toEqual(['Test Court', 'Test Idol', 'Test Idol']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(1);
  });
  it('not the monarch: the Court itself becomes a copy of the artifact (and has this ability); no token is made', () => {
    const s = upkeep(false, true);
    expect(names2(s)).toEqual(['Test Idol', 'Test Idol']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
    const court = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'card' && s.defs[s.objects[id]!.defId]!.name === 'Test Court')!;
    expect(getChars(s, court).abilities).toHaveLength(2); // Flying, and the triggered ability that made it a copy (CR 707.9a)
    const idol = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Idol')!;
    expect(getChars(s, idol).abilities).toHaveLength(1);
  });
  it('no target chosen: nothing happens either way', () => {
    expect(names2(upkeep(true, false))).toEqual(['Test Court', 'Test Idol']);
    expect(names2(upkeep(false, false))).toEqual(['Test Court', 'Test Idol']);
  });
});

describe("CR 707.2, 508.4, 110.5b: \"create a token that's a copy of another target attacking creature and that's tapped and attacking. Exile the token at end of combat.\"", () => {
  const RIDER = card('Test Rider', 'Creature — Human Warrior', "Whenever this creature attacks, create a token that's a copy of another target attacking creature and that's tapped and attacking. Exile the token at end of combat.", { pt: ['3', '3'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '4'] });
  const defs = [RIDER, OGRE];
  const tokens = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => getChars(s, id).name);
  function attack(second: boolean): GameState {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rider', 'Test Ogre'] } });
    let s = toDeclareAttackers(advanceTo(s0, 3, 'main1'));
    const rider = find2(s, 'Test Rider', 'battlefield', 'p1');
    const ogre = find2(s, 'Test Ogre', 'battlefield', 'p1');
    s = declareAttackers(s, second ? [[rider], [ogre]] : [[rider]]);
    for (let i = 0; i < 40 && (s.pending && s.pending.kind !== 'priority'); i++) {
      const p = s.pending!;
      if (p.kind === 'chooseTargets') s = answer2(s, { kind: 'chooseTargets', targets: second ? [{ kind: 'object', id: ogre }] : [] });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return s;
  }
  it('is fully automated', () => expect(manualOf(RIDER)).toEqual([]));
  it('the copy of the other attacker enters tapped and attacking; it is exiled at end of combat', () => {
    let s = attack(true);
    s = (() => { let t = s; for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(t); return t; })();
    const tok = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tok.map((id) => getChars(s, id).name)).toEqual(['Test Ogre']);
    expect(s.objects[tok[0]!]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === tok[0]!)).toBe(true);
    for (let i = 0; i < 40 && tokens(s).length > 0 && s.turn.step !== 'main2'; i++) s = s.pending && s.pending.kind !== 'priority' ? (s.pending.kind === 'declareBlockers' ? answer2(s, { kind: 'declareBlockers', blocks: [] }) : s) : pass(s);
    expect(tokens(s)).toEqual([]);
  });
  it('with no other attacker there is no target and no token', () => {
    const s = attack(false);
    expect(tokens(s)).toEqual([]);
  });
});
