/**
 * Coordinator D, round edh-d-15 (EDHREC ranks 12,501-13,750, fourth pass): the round's readings and engine changes played through the engine with synthetic cards (invented
 * names and wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative
 * case. CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-02).
 *
 *   CR 602.2b, 605.1a, 601.2f   "Activated abilities cost {2} more to activate unless they're mana abilities" (Suppression Field)
 *   CR 615.7, 615.8, 614.5      "The next time that creature would deal damage this turn, prevent that damage": damage dealt at the same moment is one time (Dazzling Reflection)
 *   CR 118.12a, 101.4           "Unless any player pays {2}, search your library for a card, put that card into your hand, then shuffle." (Rhystic Tutor)
 *   CR 601.3, 602.5, 101.2      "Players can cast spells and activate abilities only during their own turns" (City of Solitude)
 *   CR 101.3, 119.3, 608.2c     "Each opponent who can't loses half their life, rounded up" (Skull Storm)
 *   CR 608.2c, 111.1            "If C, create three tokens. They have \"...\". Otherwise, create one of those tokens." (Brood Birthing)
 *   CR 701.20a, 119.3, 121.1    "Each player reveals the top card of their library, loses life equal to that card's mana value, then puts it into their hand" (Duskmantle Seer)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: opts.cost ?? '{0}', colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id));
const onBf = (s: GameState, name: string, p?: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[]; yes?: Record<string, boolean> }
/** Answer the decisions of the state until priority comes back: payments automatic, targets and other answers from the queues, yes/no by the asked player. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'yesNo' && o.yes !== undefined) s = answer(s, { kind: 'yesNo', yes: o.yes[p.player] ?? false });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: (o.targets ?? []).map((t) => [...t]), answers: [...(o.answers ?? [])], ...(o.yes ? { yes: o.yes } : {}) });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player: 'p1' | 'p2' = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
const abilityKey = (s: GameState, id: ObjectId, pred: (a: { kind: string }) => boolean = (a) => a.kind === 'activated'): string => `p:0:${s.defs[s.objects[id]!.defId]!.faces[0]!.abilities.findIndex(pred)}`;

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '6'] });

// ---- Suppression Field ---------------------------------------------------------------------------------------------------------------------------------------------
const FIELD = card('Test Field', 'Enchantment', "Activated abilities cost {2} more to activate unless they're mana abilities.");
const PINGER = card('Test Pinger', 'Creature — Wizard', '{1}, {T}: You gain 1 life.', { pt: ['1', '1'] });
describe('CR 601.2f, 602.2b, 605.1a: "Activated abilities cost {2} more to activate unless they\'re mana abilities" (Suppression Field)', () => {
  it('is automated', () => { expect(full(FIELD)).toBe(true); });
  const game = (lands: number, withField = true) => scenario([], { p1: { battlefield: [...(withField ? ['Test Field'] : []), 'Test Pinger', ...Array(lands).fill('Plains') as string[]] }, defs: [FIELD, PINGER] });
  const ping = (s: GameState) => { const id = find(s, 'Test Pinger', 'battlefield', 'p1'); return { type: 'activate', player: 'p1', source: id, ability: abilityKey(s, id) } as never; };
  it('the {1} ability costs {3} with the enchantment: three lands pay it (the lands\' own mana abilities cost nothing extra)', () => {
    let s = game(3);
    s = settle(act(s, ping(s)), {});
    s = drain(s, {});
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(findAll(s, 'Plains', 'battlefield', 'p1').every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('negative: two lands cannot pay the taxed ability', () => {
    const s = game(2);
    const r = (() => { try { const t = settle(act(s, ping(s)), {}); return lifeOf(drain(t, {}), 'p1'); } catch { return 'rejected'; } })();
    expect(r === 'rejected' || r === 20).toBe(true);
    expect(r).not.toBe(21);
  });
  it('negative: without the enchantment two lands pay the {1} ability and so does one', () => {
    let s = game(1, false);
    s = drain(settle(act(s, ping(s)), {}), {});
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});

// ---- Dazzling Reflection -------------------------------------------------------------------------------------------------------------------------------------------
const REFLECT = card('Test Reflection', 'Instant', "You gain life equal to target creature's power. The next time that creature would deal damage this turn, prevent that damage.");
const DUEL = card('Test Duel', 'Sorcery', "Target creature you control fights target creature you don't control.");
describe('CR 615.1a, 615.7, 615.8, 614.5: "The next time that creature would deal damage this turn, prevent that damage." (Dazzling Reflection)', () => {
  it('is automated', () => { expect(full(REFLECT)).toBe(true); });
  const game = () => scenario([], { p1: { hand: ['Test Reflection'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [REFLECT, OGRE, BEAR, DUEL] });
  const combat = (s0: GameState, reflectOn: 'ogre' | 'none'): GameState => {
    let s = s0;
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    if (reflectOn === 'ogre') { s = cast(s, 'Test Reflection', { targets: [[obj(ogre)]] }); expect(lifeOf(s, 'p1')).toBe(24); }
    s = declareAttackers(toDeclareAttackers(s), [[ogre]]);
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p2');
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareBlockers'; i++) s = pass(s);
    s = declareBlockers(s, [[bears[0]!, ogre], [bears[1]!, ogre]]);
    for (let i = 0; i < 40 && s.turn.step !== 'endCombat'; i++) {
      if (s.pending?.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: [{ id: bears[0]!, amount: 2 }, { id: bears[1]!, amount: 2 }] } as never);
      else s = pass(s);
    }
    return s;
  };
  it('a creature that deals damage to two blockers at the same moment has ALL of that damage prevented: one time (CR 615.8, 614.5)', () => {
    const s = combat(game(), 'ogre');
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(2); // neither blocker was dealt damage
    expect(onBf(s, 'Test Ogre', 'p1').length).toBe(1); // the Ogre is dealt 4 damage by the two Bears (toughness 6) and is not prevented
    expect(s.objects[onBf(s, 'Test Ogre', 'p1')[0]!]!.damage).toBe(4);
  });
  it('negative: without the spell the two blockers die', () => {
    const s = combat(game(), 'none');
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(0);
  });
  it('negative: the shield is used up by the first time; the creature\'s next damage later in the turn is dealt', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reflection', 'Test Duel', 'Test Duel'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [REFLECT, OGRE, BEAR, DUEL] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const [b1, b2] = findAll(s0, 'Test Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Reflection', { targets: [[obj(ogre)]] });
    s = cast(s, 'Test Duel', { targets: [[obj(ogre)], [obj(b1!)]] });
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(2); // the Ogre's damage was prevented, the Bear's damage to the Ogre was not
    expect(s.objects[ogre]!.damage).toBe(2);
    s = cast(s, 'Test Duel', { targets: [[obj(ogre)], [obj(b2!)]] });
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(1); // the second fight: the shield is gone, the Ogre deals its damage
    expect(s.objects[ogre]!.damage).toBe(4);
  });
  it('negative: a Reflection on another creature does not stop the Ogre', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reflection', 'Test Duel'], battlefield: ['Test Ogre', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [REFLECT, OGRE, BEAR, DUEL] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const mine = findAll(s0, 'Test Bear', 'battlefield', 'p1')[0]!;
    const theirs = findAll(s0, 'Test Bear', 'battlefield', 'p2')[0]!;
    let s = cast(s0, 'Test Reflection', { targets: [[obj(mine)]] });
    s = cast(s, 'Test Duel', { targets: [[obj(ogre)], [obj(theirs)]] });
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(0);
  });
});

function passUntil2(s0: GameState): GameState { let s = s0; for (let i = 0; i < 60 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : s; return s; }
describe('CR 615.8: the batch rule is for one named source only; two shields of one wording are one time (review of edh-d-15)', () => {
  const WARD = card('Test Ward', 'Instant', 'The next time a creature would deal damage to you this turn, prevent that damage.');
  it('negative: a shield for "a creature" (no one source) prevents the damage of the first creature only, not of two attackers hitting at once', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Ward'] }, defs: [WARD, BEAR] });
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), bears.map((b) => [b] as [ObjectId]));
    for (let i = 0; i < 20 && !(s.turn.step === 'declareAttackers' && s.pending?.kind === 'priority' && s.pending.player === 'p2'); i++) s = pass(s); // (no blockers: no block decision)
    s = cast(s, 'Test Ward', {}, 'p2');
    for (let i = 0; i < 40 && s.turn.step !== 'endCombat'; i++) s = pass(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('two Reflections on one creature: one applies to the double block, the other is kept for its next damage (ruling 2016-01-22)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reflection', 'Test Reflection', 'Test Duel'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [REFLECT, OGRE, BEAR, DUEL] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    let s = cast(s0, 'Test Reflection', { targets: [[obj(ogre)]] });
    s = cast(s, 'Test Reflection', { targets: [[obj(ogre)]] });
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[ogre]]);
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareBlockers'; i++) s = pass(s);
    s = declareBlockers(s, [[bears[0]!, ogre], [bears[1]!, ogre]]);
    for (let i = 0; i < 60 && s.turn.step !== 'endCombat'; i++) {
      if (s.pending?.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: [{ id: bears[0]!, amount: 2 }, { id: bears[1]!, amount: 2 }] } as never);
      else if (s.pending?.kind === 'chooseReplacement') { const o = (s.pending as unknown as { options: { id: string }[] }).options; s = answer(s, { kind: 'chooseReplacement', id: o[o.length - 1]!.id }); } // the opponent picks the OTHER Reflection for the second event
      else s = pass(s);
    }
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(2);
    expect(s.objects[ogre]!.damage).toBe(4);
    s = passUntil2(s);
    s = cast(s, 'Test Duel', { targets: [[obj(ogre)], [obj(bears[0]!)]] });
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(2); // the second Reflection was kept and prevents the Ogre's next damage
  });
});

// ---- Rhystic Tutor -------------------------------------------------------------------------------------------------------------------------------------------------
const TUTOR = card('Test Tutor', 'Sorcery', 'Unless any player pays {2}, search your library for a card, put that card into your hand, then shuffle.');
const PRIZE = card('Test Prize', 'Artifact', '');
describe('CR 118.12a, 101.4: "Unless any player pays {2}, search your library for a card, put that card into your hand, then shuffle." (Rhystic Tutor)', () => {
  it('is automated', () => { expect(full(TUTOR)).toBe(true); });
  const game = (p1Lands: number, p2Lands: number) => scenario([], {
    p1: { hand: ['Test Tutor'], library: ['Test Prize'], battlefield: Array(p1Lands).fill('Plains') as string[] },
    p2: { battlefield: Array(p2Lands).fill('Plains') as string[] }, defs: [TUTOR, PRIZE],
  });
  const run = (s: GameState, yes: Record<string, boolean>): GameState => {
    const q: Opts = { yes };
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tutor', 'hand', 'p1') } as never);
    for (let g = 0; g < 80 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); g++) {
      if (t.pending && t.pending.kind !== 'priority') {
        const p = t.pending as { kind: string; player: string; options?: ObjectId[] };
        if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
        else if (p.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes: q.yes![p.player] ?? false });
        else {
          const offered = p.options ?? [];
          const prize = offered.find((id) => nameOf(t, id) === 'Test Prize');
          t = answer(t, { kind: 'chooseObjects', ids: prize ? [prize] : [] } as never);
        }
      } else t = pass(t);
    }
    return t;
  };
  it('nobody pays: the card goes to your hand', () => {
    const s = run(game(0, 2), {});
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Prize');
  });
  it('an opponent pays {2}: you search for nothing, the library keeps the card', () => {
    const s = run(game(0, 2), { p2: true });
    expect(zoneNames(s, 'hand', 'p1')).not.toContain('Test Prize');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.tapped).length).toBe(2);
  });
  it('you may pay it yourself too: any player, including the caster', () => {
    const s = run(game(2, 0), { p1: true });
    expect(zoneNames(s, 'hand', 'p1')).not.toContain('Test Prize');
  });
  it('negative: a player who cannot pay {2} cannot stop it', () => {
    const s = run(game(0, 1), { p2: true });
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Prize');
  });
});

// ---- City of Solitude ----------------------------------------------------------------------------------------------------------------------------------------------
const CITY = card('Test City', 'Enchantment', 'Players can cast spells and activate abilities only during their own turns.');
const FLASH = card('Test Flash', 'Instant', 'You gain 2 life.');
describe('CR 601.3, 602.5, 101.2: "Players can cast spells and activate abilities only during their own turns" (City of Solitude)', () => {
  it('is automated', () => { expect(full(CITY)).toBe(true); });
  const game = () => scenario([], { p1: { hand: ['Test Flash'], battlefield: ['Test City', 'Test Pinger', 'Plains'] }, p2: { hand: ['Test Flash'], battlefield: ['Test Pinger', 'Plains'] }, defs: [CITY, FLASH, PINGER] });
  it('on your own turn you can cast spells and activate abilities (mana abilities too)', () => {
    const s = game();
    const id = find(s, 'Test Pinger', 'battlefield', 'p1');
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flash', 'hand', 'p1') } as never)).not.toThrow();
    expect(() => act(s, { type: 'activate', player: 'p1', source: id, ability: abilityKey(s, id) } as never)).not.toThrow();
  });
  it('negative: on another player\'s turn you can neither cast a spell nor activate an ability', () => {
    let s = game();
    s = pass(s); // Alice passes with an empty stack: Bob gets priority in turn 1 (still Alice's turn)
    expect(s.pending?.player).toBe('p2');
    const id = find(s, 'Test Pinger', 'battlefield', 'p2');
    expect(reject(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash', 'hand', 'p2') } as never).message.length).toBeGreaterThan(0);
    expect(reject(s, { type: 'activate', player: 'p2', source: id, ability: abilityKey(s, id) } as never).message.length).toBeGreaterThan(0);
  });
  it('negative: it does nothing without the enchantment', () => {
    const s0 = scenario([], { p2: { hand: ['Test Flash'], battlefield: ['Test Pinger', 'Plains'] }, defs: [FLASH, PINGER] });
    const s = pass(s0);
    expect(() => act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash', 'hand', 'p2') } as never)).not.toThrow();
  });
});

// ---- Skull Storm ---------------------------------------------------------------------------------------------------------------------------------------------------
const STORM = card('Test Storm', 'Sorcery', "Each opponent sacrifices a creature of their choice. Each opponent who can't loses half their life, rounded up.");
describe('CR 101.3, 119.3, 608.2c: "Each opponent who can\'t loses half their life, rounded up" (Skull Storm)', () => {
  it('is automated', () => { expect(full(STORM)).toBe(true); });
  it('an opponent without a creature loses half their life, rounded up (21 life: 11)', () => {
    const s0 = scenario([], { life: 21, p1: { hand: ['Test Storm'] }, defs: [STORM] });
    const s = cast(s0, 'Test Storm');
    expect(lifeOf(s, 'p2')).toBe(10);
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('negative: an opponent with a creature sacrifices it and loses no life', () => {
    const s0 = scenario([], { life: 21, p1: { hand: ['Test Storm'] }, p2: { battlefield: ['Test Bear'] }, defs: [STORM, BEAR] });
    const s = cast(s0, 'Test Storm', { answers: [{ kind: 'chooseObjects', ids: [] } as never] });
    expect(lifeOf(s, 'p2')).toBe(21);
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(0);
  });
});

// ---- Brood Birthing ------------------------------------------------------------------------------------------------------------------------------------------------
const BIRTH = card('Test Birthing', 'Sorcery', 'If you control an Eldrazi Spawn, create three 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this token: Add {C}." Otherwise, create one of those tokens.');
const SPAWN = card('Test Spawn', 'Creature — Eldrazi Spawn', '', { pt: ['0', '1'] });
describe('CR 608.2c, 111.1: "If you control an Eldrazi Spawn, create three tokens. They have ... Otherwise, create one of those tokens." (Brood Birthing)', () => {
  it('is automated', () => { expect(full(BIRTH)).toBe(true); });
  it('without an Eldrazi Spawn: ONE token, with the sacrifice-for-mana ability', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Birthing'] }, defs: [BIRTH, SPAWN] }), 'Test Birthing');
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(toks.length).toBe(1);
    expect(s.objects[toks[0]!]!.controller).toBe('p1');
  });
  it('with an Eldrazi Spawn (checked as it resolves): THREE tokens', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Birthing'], battlefield: ['Test Spawn'] }, defs: [BIRTH, SPAWN] }), 'Test Birthing');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(3);
  });
  it('negative: an Eldrazi Spawn an opponent controls does not count', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Birthing'] }, p2: { battlefield: ['Test Spawn'] }, defs: [BIRTH, SPAWN] }), 'Test Birthing');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
  });
});

// ---- Duskmantle Seer -----------------------------------------------------------------------------------------------------------------------------------------------
const SEER = card('Test Seer', 'Creature — Vampire Wizard', "At the beginning of your upkeep, each player reveals the top card of their library, loses life equal to that card's mana value, then puts it into their hand.", { pt: ['3', '3'] });
const COSTLY = card('Test Costly', 'Sorcery', '', { cost: '{3}' });
const CHEAP = card('Test Cheap', 'Sorcery', '', { cost: '{1}' });
describe('CR 701.20a, 119.3, 121.1: "Each player reveals the top card of their library, loses life equal to that card\'s mana value, then puts it into their hand" (Duskmantle Seer)', () => {
  it('is automated', () => { expect(full(SEER)).toBe(true); });
  it('at your upkeep every player loses life equal to the mana value of their own top card and puts it into their hand (not drawn)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Seer'], library: ['Test Costly'] }, p2: { library: ['Plains', 'Test Cheap'] }, defs: [SEER, COSTLY, CHEAP] }); // (Bob draws the first card of his library in turn 2)
    // turn 2 is Bob's: his upkeep does not trigger it; turn 3 is Alice's
    let s = s0;
    for (let i = 0; i < 400 && !(s.turn.number === 3 && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = declareAttackers(s, []);
      else if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
      else s = pass(s);
    }
    expect(s.turn.number).toBe(3);
    const lifeDiff = (p: 'p1' | 'p2') => 20 - lifeOf(s, p);
    expect(lifeDiff('p1')).toBe(3); // Alice's top card, mana value 3
    expect(lifeDiff('p2')).toBe(1); // Bob's top card, mana value 1
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Costly');
    expect(zoneNames(s, 'hand', 'p2')).toContain('Test Cheap');
  });
});
