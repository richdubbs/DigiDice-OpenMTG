/**
 * Commander EDHREC ranks 27,501-28,000, round edh-c-75 (second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 303.4, 115.1, 400.3                "Return target enchanted permanent to its owner's hand."
 *   CR 115.3, 611.2c, 613.4c              "Untap two target creatures. Each of them gets +1/+1 until end of turn."
 *   CR 105.3, 613.1e, 508.1d              "Target creature becomes red until end of turn and attacks this turn if able."
 *   CR 615.1a, 120.3, 112.1               "Prevent all damage that would be dealt by instant and sorcery spells."
 *   CR 202.3, 608.2h, 701.8a              "{B}, Sacrifice a creature: Destroy each creature with the same mana value as the sacrificed creature."
 *   CR 118.12a, 119.4                     "destroy that land unless that player pays {1} or 1 life."
 *   CR 611.2b, 702.18a                    "Target creature you control other than this creature has shroud for as long as this creature remains tapped."
 *   CR 614.12a, 607.2d, 122.1             "As ~ enters, choose an opponent. ~ enters with a -1/-1 counter on it for each creature that player controls."
 *   CR 603.7, 603.7c, 700.4, 120.3        "~ deals 3 damage to target creature. When a creature dealt damage this way dies this turn, create a 1/1 black Skeleton creature token ..."
 *   CR 513.1, 603.2, 508.1                "At the beginning of the end step of enchanted creature's controller, ~ deals 2 damage to that player unless that creature attacked this turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
describe('CR 614.12a, 607.2d, 122.1: "As ~ enters, choose an opponent. ~ enters with a -1/-1 counter on it for each creature that player controls."', () => {
  const GLOOM = card('Test Gloom Treefolk', 'Creature — Treefolk', 'As this creature enters, choose an opponent. This creature enters with a -1/-1 counter on it for each creature that player controls.', ['4', '4']);
  const BEAR = TWO('Test Plain Bear');
  it('is full', () => expect(full(GLOOM)).toBe(true));
  it('one counter for each creature the chosen opponent controls (3 -> a 1/1), and none for its own or the others\' creatures', () => {
    const s0 = scenario([], { defs: [GLOOM, BEAR], p1: { hand: ['Test Gloom Treefolk'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] } });
    const s1 = resolveAll(cast(s0, 'Test Gloom Treefolk'));
    const id = named(s1, 'Test Gloom Treefolk')[0]!;
    expect(counters(s1, id, '-1/-1')).toBe(3);
    expect(pt(s1, id)).toBe('1/1');
  });
  it('three players: the counters count the creatures of the opponent chosen, not of the other one', () => {
    for (const [pick, want] of [['p2', 1], ['p3', 2]] as const) {
      const s0 = mpScenario({ players: 3, seed: `c75-${pick}`, defs: [GLOOM, BEAR], zones: { p1: { hand: ['Test Gloom Treefolk'] }, p2: { battlefield: ['Test Plain Bear'] }, p3: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] } } });
      const s1 = resolveAll(cast(s0, 'Test Gloom Treefolk'), { option: pick });
      expect(counters(s1, named(s1, 'Test Gloom Treefolk')[0]!, '-1/-1'), pick).toBe(want);
    }
  });
  it('negative: an opponent with no creatures gives no counter and the 4/4 stays a 4/4 (it dies only if toughness reaches 0)', () => {
    const s0 = scenario([], { defs: [GLOOM, BEAR], p1: { hand: ['Test Gloom Treefolk'], battlefield: ['Test Plain Bear'] } });
    const s1 = resolveAll(cast(s0, 'Test Gloom Treefolk'));
    expect(counters(s1, named(s1, 'Test Gloom Treefolk')[0]!, '-1/-1')).toBe(0);
    const s2 = scenario([], { defs: [GLOOM, BEAR], p1: { hand: ['Test Gloom Treefolk'] }, p2: { battlefield: Array(4).fill('Test Plain Bear') } });
    const s3 = resolveAll(cast(s2, 'Test Gloom Treefolk'));
    expect(named(s3, 'Test Gloom Treefolk').length).toBe(0); // four counters on a 4/4: toughness 0, put into the graveyard (CR 704.5f)
  });
});

describe('CR 603.7, 603.7c, 700.4, 120.3: "~ deals 3 damage to target creature. When a creature dealt damage this way dies this turn, create a 1/1 black Skeleton creature token ..."', () => {
  const SKEL = card('Test Bone Bolt', 'Instant', '~ deals 3 damage to target creature. When a creature dealt damage this way dies this turn, create a 1/1 black Skeleton creature token with "{B}: Regenerate this token."');
  const KILL = card('Test Doom Word', 'Instant', 'Destroy target creature.');
  const BEAR = TWO('Test Plain Bear');
  const BULL = card('Test Big Bull', 'Creature — Bull', '', ['5', '5']);
  const WARD = card('Test Ward Spell', 'Instant', 'Prevent all damage that would be dealt to target creature this turn.');
  const game = (): GameState => scenario([], { defs: [SKEL, KILL, BEAR, BULL, WARD], p1: { hand: ['Test Bone Bolt', 'Test Doom Word', 'Test Ward Spell'], battlefield: ['Test Plain Bear'] }, p2: { hand: ['Test Doom Word'], battlefield: ['Test Plain Bear', 'Test Big Bull'] } });
  const bolt = (s: GameState, id: ObjectId): GameState => resolveAll(cast(s, 'Test Bone Bolt', { targets: [{ kind: 'object', id }] }));
  const skeletons = (s: GameState, p: string): number => tokens(s, p).filter((id) => s.objects[id]!.defId.includes('Skeleton') || (s.defs[s.objects[id]!.defId]?.name ?? '').includes('Skeleton')).length;
  it('is full', () => expect(full(SKEL)).toBe(true));
  it('a creature the damage kills gives its caster a Skeleton token, whoever controlled the creature (ruling 2018-03-16)', () => {
    const s0 = game();
    const s1 = bolt(s0, idOf(s0, 'Test Plain Bear', 'p2'));
    expect(named(s1, 'Test Plain Bear').length).toBe(1);
    expect(skeletons(s1, 'p1')).toBe(1);
    expect(skeletons(s1, 'p2')).toBe(0);
  });
  it('a creature that survives the damage and dies later this turn also gives the token', () => {
    const s0 = game();
    const bull = idOf(s0, 'Test Big Bull', 'p2');
    const s1 = bolt(s0, bull);
    expect(skeletons(s1, 'p1')).toBe(0);
    const s2 = resolveAll(cast(s1, 'Test Doom Word', { targets: [{ kind: 'object', id: bull }] }));
    expect(skeletons(s2, 'p1')).toBe(1);
  });
  it('negative: a creature that was not dealt damage this way (prevented) gives no token when it dies', () => {
    const s0 = game();
    const bear = idOf(s0, 'Test Plain Bear', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Ward Spell', { targets: [{ kind: 'object', id: bear }] }));
    const s2 = bolt(s1, bear);
    expect(s2.objects[bear]!.damage).toBe(0);
    const s3 = resolveAll(cast(s2, 'Test Doom Word', { targets: [{ kind: 'object', id: bear }] }));
    expect(named(s3, 'Test Plain Bear').length).toBe(1);
    expect(skeletons(s3, 'p1')).toBe(0);
  });
  it('negative: another creature dying this turn, or the damaged one dying on a later turn, gives no token', () => {
    const s0 = game();
    const s1 = bolt(s0, idOf(s0, 'Test Big Bull', 'p2'));
    const s2 = resolveAll(cast(s1, 'Test Doom Word', { targets: [{ kind: 'object', id: idOf(s1, 'Test Plain Bear', 'p2') }] }));
    expect(skeletons(s2, 'p1')).toBe(0);
    const later = toTurn(s1, 2);
    expect(later.turn.activePlayer).toBe('p2');
    const killed = resolveAll(cast(later, 'Test Doom Word', { targets: [{ kind: 'object', id: idOf(later, 'Test Big Bull', 'p2') }] }, 'p2'));
    expect(named(killed, 'Test Big Bull').length).toBe(0);
    expect(skeletons(killed, 'p1')).toBe(0);
    expect(skeletons(killed, 'p2')).toBe(0);
  });
});

describe('CR 513.1, 603.2, 508.1: "At the beginning of the end step of enchanted creature\'s controller, ~ deals 2 damage to that player unless that creature attacked this turn."', () => {
  const LASH = card('Test Slack Aura', 'Enchantment — Aura', "Enchant creature\nAt the beginning of the end step of enchanted creature's controller, this Aura deals 2 damage to that player unless that creature attacked this turn.");
  const BEAR = TWO('Test Plain Bear');
  const game = (): GameState => {
    const s0 = scenario([], { defs: [LASH, BEAR], p1: { hand: ['Test Slack Aura'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
    return resolveAll(cast(s0, 'Test Slack Aura', { targets: [{ kind: 'object', id: idOf(s0, 'Test Plain Bear', 'p2') }] }));
  };
  it('is full', () => expect(full(LASH)).toBe(true));
  it('the enchanted creature stayed home: its controller takes 2 at the end step of their turn', () => {
    const s = resolveWith(toStep(game(), 'p2', 'end'), []);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('negative: the enchanted creature attacked this turn, so nothing happens', () => {
    const s0 = game();
    const enchanted = s0.objects[find(s0, 'Test Slack Aura', 'battlefield', 'p1')]!.attachedTo ?? null;
    expect(enchanted).not.toBeNull();
    let s = toDeclareAttackers(s0);
    for (let i = 0; i < 10 && s.turn.activePlayer !== 'p2'; i++) s = toDeclareAttackers(s.pending?.kind === 'declareAttackers' ? declareAttackers(s, []) : s);
    s = declareAttackers(s, [[enchanted!]]);
    s = toStep(s, 'p2', 'end');
    s = resolveWith(s, []);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: another creature of that player attacking does not count', () => {
    const s0 = game();
    const enchanted = s0.objects[find(s0, 'Test Slack Aura', 'battlefield', 'p1')]!.attachedTo;
    const other = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p2' && id !== enchanted)!;
    let s = toDeclareAttackers(s0);
    for (let i = 0; i < 10 && s.turn.activePlayer !== 'p2'; i++) s = toDeclareAttackers(s.pending?.kind === 'declareAttackers' ? declareAttackers(s, []) : s);
    s = declareAttackers(s, [[other]]);
    s = resolveWith(toStep(s, 'p2', 'end'), []);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('negative: it triggers at the end step of the enchanted creature\'s controller only, not at the Aura controller\'s', () => {
    const s = toStep(game(), 'p1', 'end');
    expect(s.zones.stack.length).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, tweak, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { card, cast, counters, full, named, pt, resolveAll, settle, tokens } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const idOf = (s: GameState, name: string, player = 'p1'): ObjectId => find(s, name, 'battlefield', player);
const inYard = (s: GameState, name: string, player: string): boolean => (s.zones.graveyard[player] ?? []).some((id) => s.objects[id]!.defId === name);
const inHand = (s: GameState, name: string, player: string): boolean => (s.zones.hand[player] ?? []).some((id) => s.objects[id]!.defId === name);
/** A card with colors (the shared helper makes colorless ones) and a mana cost. */
function colored(name: string, type: string, text: string, colors: string[], cost: string, ptv?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(ptv ? { power: ptv[0], toughness: ptv[1] } : {}) } as OracleCard);
}
/** Pass priority (declaring no attackers) until the upkeep of turn `n`. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number >= n && s.turn.step === 'upkeep' && s.pending?.kind === 'priority'); i++) s = s.pending?.kind === 'declareAttackers' ? declareAttackers(s, []) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] } as never) : settle(pass(s));
  return s;
}
const TWO = (name: string): CardDef => card(name, 'Creature — Bear', '', ['2', '2'], '{2}');

describe('CR 303.4, 115.1, 400.3: "Return target enchanted permanent to its owner\'s hand."', () => {
  const SNAP = card('Test Hand Snap', 'Instant', "Return target enchanted permanent to its owner's hand.");
  const MOSS = card('Test Moss Aura', 'Enchantment — Aura', 'Enchant land');
  const ROCK = card('Test Plain Rock', 'Artifact', '');
  const game = (): GameState => scenario([], { defs: [SNAP, MOSS, ROCK], p1: { hand: ['Test Hand Snap', 'Test Moss Aura'] }, p2: { battlefield: ['Plains', 'Test Plain Rock'] } });
  it('is full', () => expect(full(SNAP)).toBe(true));
  it('an enchanted land (not a creature) is returned to its owner\'s hand; its Aura goes to the graveyard', () => {
    const s0 = game();
    const land = idOf(s0, 'Plains', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Moss Aura', { targets: [{ kind: 'object', id: land }] }));
    expect(s1.objects[land]!.zone).toBe('battlefield');
    const s2 = resolveAll(cast(s1, 'Test Hand Snap', { targets: [{ kind: 'object', id: land }] }));
    expect(inHand(s2, 'Plains', 'p2')).toBe(true);
    expect(inYard(s2, 'Test Moss Aura', 'p1')).toBe(true);
  });
  it('negative: with nothing enchanted there is no legal target, and a permanent that is not enchanted is not one', () => {
    const s0 = game();
    expect(reject(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hand Snap', 'hand', 'p1') }).message).toBeTruthy();
    const land = idOf(s0, 'Plains', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Moss Aura', { targets: [{ kind: 'object', id: land }] }));
    const s2 = act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Hand Snap', 'hand', 'p1') });
    const d = s2.pending as unknown as { kind: string; options?: unknown };
    expect(d.kind).not.toBe('priority');
    expect(() => answer(s2, { kind: 'chooseTargets', targets: [{ kind: 'object', id: idOf(s1, 'Test Plain Rock', 'p2') }] })).toThrow();
  });
});

describe('CR 115.3, 611.2c, 613.4c: "Untap two target creatures. Each of them gets +1/+1 until end of turn."', () => {
  const GLORY = card('Test Twin Cheer', 'Instant', 'Untap two target creatures. Each of them gets +1/+1 until end of turn.');
  const game = (n: number): GameState => scenario([], { defs: [GLORY, TWO('Test Plain Bear')], p1: { hand: ['Test Twin Cheer'], battlefield: Array.from({ length: n }, () => ({ name: 'Test Plain Bear', tapped: true })) } });
  it('is full', () => expect(full(GLORY)).toBe(true));
  it('both targets untap and get +1/+1; a third creature is unchanged', () => {
    const s0 = game(3);
    const [a, b, c] = named(s0, 'Test Plain Bear');
    const s1 = resolveAll(cast(s0, 'Test Twin Cheer', { targets: [{ kind: 'object', id: a! }, { kind: 'object', id: b! }] }));
    expect(s1.objects[a!]!.tapped).toBe(false);
    expect(s1.objects[b!]!.tapped).toBe(false);
    expect(pt(s1, a!)).toBe('3/3');
    expect(pt(s1, b!)).toBe('3/3');
    expect(s1.objects[c!]!.tapped).toBe(true);
    expect(pt(s1, c!)).toBe('2/2');
  });
  it('the pump ends at end of turn', () => {
    const s0 = game(2);
    const [a] = named(s0, 'Test Plain Bear');
    const s1 = resolveAll(cast(s0, 'Test Twin Cheer', { targets: [{ kind: 'object', id: a! }, { kind: 'object', id: named(s0, 'Test Plain Bear')[1]! }] }));
    const later = toTurn(s1, 2);
    expect(pt(later, a!)).toBe('2/2');
  });
  it('negative: it cannot be cast with one creature on the battlefield (two different targets are needed, CR 115.3)', () => {
    const s0 = game(1);
    expect(reject(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Twin Cheer', 'hand', 'p1') }).message).toBeTruthy();
  });
});

describe('CR 105.3, 613.1e, 508.1d: "Target creature becomes red until end of turn and attacks this turn if able."', () => {
  const INCITE = card('Test Rile Up', 'Instant', 'Target creature becomes red until end of turn and attacks this turn if able.');
  const BEAR = TWO('Test Plain Bear');
  const game = (): GameState => scenario([], { defs: [INCITE, BEAR], p1: { hand: ['Test Rile Up'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
  const colorsOf = (s: GameState, id: ObjectId): string => jsonColors(s, id).join('');
  it('is full', () => expect(full(INCITE)).toBe(true));
  it('the creature is red (its other colors are gone) and must attack: declaring no attackers fails, declaring it alone is fine', () => {
    const s0 = game();
    const [a, b] = named(s0, 'Test Plain Bear');
    const s1 = resolveAll(cast(s0, 'Test Rile Up', { targets: [{ kind: 'object', id: a! }] }));
    expect(colorsOf(s1, a!)).toBe('R');
    expect(colorsOf(s1, b!)).toBe('');
    const atk = toDeclareAttackers(s1);
    expect(() => declareAttackers(atk, [])).toThrow(); // the requirement: a must attack
    expect(() => declareAttackers(atk, [[b!]])).toThrow(); // only b attacks: a is still required
    const s2 = declareAttackers(atk, [[a!]]);
    expect(s2.combat?.attackers.length).toBe(1);
  });
  it('negative: the other creature need not attack', () => {
    const s0 = game();
    const [a, b] = named(s0, 'Test Plain Bear');
    const s1 = resolveAll(cast(s0, 'Test Rile Up', { targets: [{ kind: 'object', id: a! }] }));
    const s2 = declareAttackers(toDeclareAttackers(s1), [[a!]]);
    expect(s2.combat?.attackers.map((x) => x.id)).not.toContain(b!);
  });
});

describe('CR 615.1a, 120.3: "Prevent all damage that would be dealt by instant and sorcery spells."', () => {
  const CALM = card('Test Calm Ward', 'Enchantment', 'Prevent all damage that would be dealt by instant and sorcery spells.');
  const ZAP = card('Test Zap Two', 'Instant', '~ deals 2 damage to target creature.');
  const BURN = card('Test Burn Two', 'Sorcery', '~ deals 2 damage to target creature.');
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{T}: ~ deals 1 damage to target creature.', ['1', '1']);
  const BULL = card('Test Big Bull', 'Creature — Bull', '', ['4', '4']);
  const game = (ward: boolean): GameState => scenario([], { defs: [CALM, ZAP, BURN, PINGER, BULL], p1: { hand: ['Test Zap Two', 'Test Burn Two'], battlefield: ['Test Pinger', ...(ward ? ['Test Calm Ward'] : [])] }, p2: { battlefield: ['Test Big Bull'] } });
  const hit = (s: GameState, spell: string): GameState => resolveAll(cast(s, spell, { targets: [{ kind: 'object', id: idOf(s, 'Test Big Bull', 'p2') }] }));
  it('is full', () => expect(full(CALM)).toBe(true));
  it('with the enchantment out, neither an instant nor a sorcery deals its damage (the spells still resolve)', () => {
    const s0 = game(true);
    const bull = idOf(s0, 'Test Big Bull', 'p2');
    const s1 = hit(s0, 'Test Zap Two');
    expect(s1.objects[bull]!.damage).toBe(0);
    expect(inYard(s1, 'Test Zap Two', 'p1')).toBe(true);
    const s2 = hit(s1, 'Test Burn Two');
    expect(s2.objects[bull]!.damage).toBe(0);
    expect(inYard(s2, 'Test Burn Two', 'p1')).toBe(true);
  });
  it('negative: without it both deal 2; with it an ability of a permanent still deals its damage', () => {
    const s0 = game(false);
    const bull = idOf(s0, 'Test Big Bull', 'p2');
    expect(hit(s0, 'Test Zap Two').objects[bull]!.damage).toBe(2);
    expect(hit(s0, 'Test Burn Two').objects[bull]!.damage).toBe(2);
    const w = game(true);
    const pinger = idOf(w, 'Test Pinger', 'p1');
    const s1 = resolveAll(settle(act(w, { type: 'activate', player: 'p1', source: pinger, ability: 'p:0:0' }), { targets: [{ kind: 'object', id: idOf(w, 'Test Big Bull', 'p2') }] }));
    expect(s1.objects[idOf(s1, 'Test Big Bull', 'p2')]!.damage).toBe(1);
  });
});

describe('CR 202.3, 608.2h, 701.8a: "{B}, Sacrifice a creature: Destroy each creature with the same mana value as the sacrificed creature."', () => {
  const PRAETOR = card('Test Even Praetor', 'Creature — Avatar', '{B}, Sacrifice a creature: Destroy each creature with the same mana value as the sacrificed creature.', ['3', '3'], '{4}');
  const TWOS = (n: string): CardDef => card(n, 'Creature — Bear', '', ['2', '2'], '{2}');
  const THREE = card('Test Three Drop', 'Creature — Bear', '', ['3', '3'], '{3}');
  const game = (): GameState => scenario(['Swamp'], { defs: [PRAETOR, TWOS('Test Two Drop'), THREE], p1: { battlefield: ['Test Even Praetor', 'Test Two Drop', 'Test Three Drop', 'Swamp', 'Swamp'] }, p2: { battlefield: ['Test Two Drop', 'Test Three Drop'] } });
  const run = (s0: GameState, victim: ObjectId): GameState =>
    resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: idOf(s0, 'Test Even Praetor', 'p1'), ability: 'p:0:0' }), { objects: [victim] }));
  it('is full', () => expect(full(PRAETOR)).toBe(true));
  it('sacrificing a mana value 2 creature destroys every creature of mana value 2, whoever controls it, and no other', () => {
    const s0 = game();
    const mine = idOf(s0, 'Test Two Drop', 'p1');
    const s1 = run(s0, mine);
    expect(named(s1, 'Test Two Drop').length).toBe(0);
    expect(named(s1, 'Test Three Drop').length).toBe(2);
    expect(named(s1, 'Test Even Praetor').length).toBe(1); // mana value 4
  });
  it('the sacrificed creature\'s mana value is read as it last existed; sacrificing the Praetor itself (mana value 4) destroys the creatures of mana value 4 and nothing else', () => {
    const s0 = game();
    const s1 = run(s0, idOf(s0, 'Test Even Praetor', 'p1'));
    // the Praetor paid for the ability of itself; nothing else has mana value 4
    expect(named(s1, 'Test Two Drop').length).toBe(2);
    expect(named(s1, 'Test Three Drop').length).toBe(2);
  });
  it('negative: a sacrificed token has mana value 0, so a mana value 2 creature is not destroyed by it (a mana value 0 creature is)', () => {
    const SPAWN = card('Test Spirit Maker', 'Creature — Shaman', '{0}: Create a 1/1 white Spirit creature token.', ['1', '1'], '{1}');
    const FREE = card('Test Free Bear', 'Creature — Bear', '', ['1', '1'], '{0}');
    const s0 = scenario(['Swamp'], { defs: [PRAETOR, SPAWN, FREE, TWOS('Test Two Drop')], p1: { battlefield: ['Test Even Praetor', 'Test Spirit Maker', 'Swamp'] }, p2: { battlefield: ['Test Two Drop', 'Test Free Bear'] } });
    const s1 = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: idOf(s0, 'Test Spirit Maker', 'p1'), ability: 'p:0:0' })));
    const spirit = tokens(s1, 'p1')[0]!;
    const s2 = run(s1, spirit);
    expect(named(s2, 'Test Two Drop').length).toBe(1);
    expect(named(s2, 'Test Free Bear').length).toBe(0);
  });
});

/** Pass priority (no attackers) until it is `step` of `player`'s turn, with the trigger of that step on the stack (the stack is not touched). */
function toStep(s0: GameState, player: string, step: GameState['turn']['step']): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.activePlayer === player && s.turn.step === step && s.pending?.kind === 'priority'); i++) s = s.pending?.kind === 'declareAttackers' ? declareAttackers(s, []) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] } as never) : settle(pass(s));
  return s;
}
/** Resolve the stack, answering the yes/no questions in order from `yes` (then "no"), costs automatically. */
function resolveWith(s0: GameState, yes: boolean[]): GameState {
  let s = s0;
  const q = [...yes];
  for (let i = 0; i < 60 && (s.zones.stack.length > 0 || (s.pending !== null && s.pending.kind !== 'priority')); i++) {
    const d = s.pending!;
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.shift() ?? false });
    else if (d.kind === 'priority') s = pass(s);
    else s = settle(s);
  }
  return s;
}

describe('CR 118.12a, 119.4: "At the beginning of the upkeep of enchanted land\'s controller, destroy that land unless that player pays {1} or 1 life."', () => {
  const SALT = card('Test Salt Aura', 'Enchantment — Aura', "Enchant land\nAt the beginning of the upkeep of enchanted land's controller, destroy that land unless that player pays {1} or 1 life.");
  const game = (): GameState => {
    const s0 = scenario([], { defs: [SALT], p1: { hand: ['Test Salt Aura'] }, p2: { battlefield: ['Plains', 'Plains'] } });
    return resolveAll(cast(s0, 'Test Salt Aura', { targets: [{ kind: 'object', id: find(s0, 'Plains', 'battlefield', 'p2') }] }));
  };
  const lands = (s: GameState): number => named(s, 'Plains').length;
  it('is full', () => expect(full(SALT)).toBe(true));
  it('paying {1}: the land stays and no life is lost', () => {
    const s = resolveWith(toStep(game(), 'p2', 'upkeep'), [true]);
    expect(lands(s)).toBe(2);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('declining the mana and paying 1 life: the land stays, one life is lost', () => {
    const s = resolveWith(toStep(game(), 'p2', 'upkeep'), [false, true]);
    expect(lands(s)).toBe(2);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('paying neither: the enchanted land is destroyed (its Aura with it) and no life is lost', () => {
    const s = resolveWith(toStep(game(), 'p2', 'upkeep'), [false, false]);
    expect(lands(s)).toBe(1);
    expect(inYard(s, 'Plains', 'p2')).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: it triggers on the upkeep of the land\'s controller only, not on the Aura controller\'s upkeep', () => {
    const s0 = game();
    const mine = toStep(s0, 'p1', 'upkeep');
    expect(mine.turn.number === 1 || mine.zones.stack.length === 0).toBe(true);
    const s1 = toStep(resolveWith(toStep(s0, 'p2', 'upkeep'), [true]), 'p1', 'upkeep');
    expect(s1.zones.stack.length).toBe(0);
  });
});

describe('CR 611.2b, 702.18a: "{1}{U}, {T}: Target creature you control other than this creature has shroud for as long as this creature remains tapped."', () => {
  const GUARD = card('Test Veil Keeper', 'Creature — Wizard', '{T}: Target creature you control other than this creature has shroud for as long as this creature remains tapped.', ['1', '1']);
  const BEAR = TWO('Test Plain Bear');
  const game = (): GameState => scenario([], { defs: [GUARD, BEAR], p1: { battlefield: ['Test Veil Keeper', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] } });
  const go = (s0: GameState, onto: ObjectId): GameState => resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: idOf(s0, 'Test Veil Keeper', 'p1'), ability: 'p:0:0' }), { targets: [{ kind: 'object', id: onto }] }));
  it('is full', () => expect(full(GUARD)).toBe(true));
  it('the target has shroud while the Keeper stays tapped, and loses it when the Keeper untaps', () => {
    const s0 = game();
    const mine = idOf(s0, 'Test Plain Bear', 'p1');
    const s1 = go(s0, mine);
    expect(hasKeyword(getChars(s1, mine)!, 'shroud')).toBe(true);
    expect(s1.objects[idOf(s1, 'Test Veil Keeper', 'p1')]!.tapped).toBe(true);
    expect(hasKeyword(getChars(s1, idOf(s1, 'Test Plain Bear', 'p2'))!, 'shroud')).toBe(false);
    const s2 = tweak(s1, (t) => { t.objects[idOf(t, 'Test Veil Keeper', 'p1')]!.tapped = false; });
    expect(hasKeyword(getChars(s2, mine)!, 'shroud')).toBe(false);
  });
  it('negative: the Keeper itself and the opponent\'s creature are not legal targets', () => {
    const s0 = game();
    const s1 = act(s0, { type: 'activate', player: 'p1', source: idOf(s0, 'Test Veil Keeper', 'p1'), ability: 'p:0:0' });
    for (const bad of [idOf(s0, 'Test Veil Keeper', 'p1'), idOf(s0, 'Test Plain Bear', 'p2')]) expect(() => answer(s1, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bad }] })).toThrow();
  });
});

function jsonColors(s: GameState, id: ObjectId): string[] { return [...((getChars(s, id) as unknown as { colors: string[] }).colors ?? [])]; }
