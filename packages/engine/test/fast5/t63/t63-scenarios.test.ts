/**
 * FAST5 T63: the shapes of parser/templates/zz-fast5/t63.json (and the render support they needed) played through the engine with synthetic cards compiled by
 * the game's default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2g, 118.9d, 107.3b   "You may cast a noncreature spell from your hand without paying its mana cost.": a free cast during a resolution, additional costs paid, X is 0
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ManaSymbol, type ObjectId, type OracleCard } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { act, advanceTo, answer, find, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** No ability of the card is manual, at any depth. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));
const mine = (s: GameState, player = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player);
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const handOf = (s: GameState, player = 'p1'): string[] => names(s, s.zones.hand[player]!);

/** Answer the decisions in order (mana is paid automatically); stops at priority. */
function drive(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost' && queue[0]?.kind !== 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
    const a = queue.shift();
    if (!a) break;
    s = answer(s, a);
  }
  return s;
}
/** Both players pass until the stack is empty. */
function resolveAll(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = drive(s.pending?.kind === 'priority' ? pass(s) : s, answers);
  return s;
}
const activateFirst = (s: GameState, source: ObjectId, answers: DecisionAnswer[] = []): GameState => {
  const la = legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && !a.isMana && a.object === source);
  if (!la) throw new Error('no activation');
  return drive(act(s, la.action), answers);
};
const pick = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}', ['G']);

describe('CR 608.2g, 118.9d, 107.3b: "You may cast a noncreature spell from your hand without paying its mana cost."', () => {
  const CONJURER = card('Test Conjurer', 'Creature — Wizard', '{T}: You may cast a noncreature spell from your hand without paying its mana cost.', ['1', '1']);
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, '{W}', ['W']);
  const STUDY = card('Test Study', 'Sorcery', 'You gain 3 life.', undefined, '{2}');
  const TOLL = card('Test Toll', 'Instant', 'As an additional cost to cast this spell, discard a card.\nYou gain 5 life.', undefined, '{1}{W}', ['W']);
  const VOLLEY = card('Test Volley', 'Sorcery', 'Test Volley deals X damage to target player.', undefined, '{X}{R}', ['R']);
  const defs = [CONJURER, TONIC, STUDY, TOLL, VOLLEY, BEAR];
  const board = (hand: string[]): GameState => scenario([], { p1: { hand, battlefield: ['Test Conjurer'] }, defs });

  it('is automated', () => {
    expect(automated(CONJURER)).toBe(true);
  });
  it('offers the noncreature, nonland cards of your hand (a creature card and a land card are not noncreature spells)', () => {
    const s0 = board(['Test Tonic', 'Test Study', 'Test Bear', 'Plains']);
    const s = activateFirst(s0, find(s0, 'Test Conjurer', 'battlefield'));
    const r = drive(pass(pass(s)));
    expect(r.pending!.kind).toBe('chooseObjects');
    expect(names(r, (r.pending as unknown as { options: string[] }).options).sort()).toEqual(['Test Study', 'Test Tonic']);
  });
  it('casts the chosen card without paying its mana cost, at no timing restriction: a sorcery cast during the resolution of the ability', () => {
    const s0 = board(['Test Study']);
    const before = life(s0, 'p1');
    let s = activateFirst(s0, find(s0, 'Test Conjurer', 'battlefield'));
    s = drive(pass(pass(s)), [pick(find(s, 'Test Study', 'hand'))]);
    expect(s.zones.stack.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Study']); // the spell is on the stack, free
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(before + 3);
    expect(s.players[0]!.manaPool).toEqual([]);
  });
  it('choosing no card casts nothing', () => {
    const s0 = board(['Test Study']);
    let s = activateFirst(s0, find(s0, 'Test Conjurer', 'battlefield'));
    s = drive(pass(pass(s)), [pick()]);
    expect(s.zones.stack).toEqual([]);
    expect(handOf(s)).toEqual(['Test Study']);
  });
  it('CR 118.9d: additional costs are still paid (discard a card)', () => {
    const s0 = board(['Test Toll', 'Test Bear']);
    const before = life(s0, 'p1');
    let s = activateFirst(s0, find(s0, 'Test Conjurer', 'battlefield'));
    s = drive(pass(pass(s)), [pick(find(s, 'Test Toll', 'hand'))]);
    // the discard is chosen as a cost: the only other card in hand, Test Bear
    if (s.pending && s.pending.kind !== 'priority') s = drive(s, [pick(find(s, 'Test Bear', 'hand'))]);
    expect(handOf(s)).toEqual([]);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(before + 5);
    expect(names(s, s.zones.graveyard.p1!).sort()).toEqual(['Test Bear', 'Test Toll']);
  });
  it('CR 107.3b: an X spell cast this way has X = 0', () => {
    const s0 = board(['Test Volley']);
    const before = life(s0, 'p2');
    let s = activateFirst(s0, find(s0, 'Test Conjurer', 'battlefield'));
    s = drive(pass(pass(s)), [pick(find(s, 'Test Volley', 'hand')), { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(s.pending?.kind).toBe('priority'); // no X to announce
    expect(names(s, s.zones.stack)).toEqual(['Test Volley']);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(before);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Volley']);
  });
});

describe('CR 601.3, 611.2a, 400.7: "You may cast target Elf creature card from your graveyard this turn."', () => {
  const NECRO = card('Test Necromancer', 'Creature — Zombie Wizard', '{T}: You may cast target Elf creature card from your graveyard this turn.', ['1', '1']);
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1'], '{G}', ['G']);
  const defs = [NECRO, ELF, BEAR];
  const castable = (s: GameState, name: string, from: 'graveyard' | 'hand' = 'graveyard'): boolean =>
    legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.defs[s.objects[a.object!]!.defId]!.name === name && s.objects[a.object!]!.zone === from);
  it('is automated; without the ability nothing in the graveyard can be cast', () => {
    expect(automated(NECRO)).toBe(true);
    const s = scenario(['Forest'], { p1: { graveyard: ['Test Elf'], battlefield: ['Test Necromancer', 'Forest'] }, defs });
    expect(castable(s, 'Test Elf')).toBe(false);
  });
  it('targets only an Elf creature card in your own graveyard', () => {
    const s0 = scenario(['Forest'], { p1: { graveyard: ['Test Elf', 'Test Bear'], battlefield: ['Test Necromancer', 'Forest'] }, p2: { graveyard: ['Test Elf'] }, defs });
    const s = activateFirst(s0, find(s0, 'Test Necromancer', 'battlefield'));
    expect(s.pending?.kind).toBe('chooseTargets');
    const p = s.pending as unknown as { specs?: { options?: { id: string }[] }[]; options?: string[] };
    const text = JSON.stringify(p);
    expect(text).toContain(find(s0, 'Test Elf', 'graveyard', 'p1'));
    expect(text).not.toContain(find(s0, 'Test Elf', 'graveyard', 'p2'));
    expect(text).not.toContain(find(s0, 'Test Bear', 'graveyard', 'p1'));
  });
  it('the target may be cast from the graveyard this turn (paying its cost), the other graveyard cards may not, and the permission ends with the turn', () => {
    const s0 = scenario(['Forest'], { p1: { graveyard: ['Test Elf', 'Test Bear'], battlefield: ['Test Necromancer', 'Forest'] }, defs });
    const elf = find(s0, 'Test Elf', 'graveyard', 'p1');
    let s = activateFirst(s0, find(s0, 'Test Necromancer', 'battlefield'), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: elf }] }]);
    s = resolveAll(s);
    expect(castable(s, 'Test Elf')).toBe(true);
    expect(castable(s, 'Test Bear')).toBe(false);
    const later = advanceTo(s, 3, 'main1');
    expect(castable(later, 'Test Elf')).toBe(false); // the permission lasted this turn only (CR 611.2a)
    const t = resolveAll(drive(act(s, legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === elf)!.action)));
    expect(names(t, mine(t))).toContain('Test Elf');
  });
});

const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` (a card in hand) for `player`, after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef, player = 'p1'): string {
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}
const castLabels = (s: GameState, player = 'p1'): string[] => legalActions(s, player).filter((a) => a.kind === 'cast').map((a) => a.label);
/** Cast `name` from the hand of `player` (paying automatically) and let the stack resolve. */
const castAndResolve = (s: GameState, name: string, player = 'p1'): GameState => resolveAll(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) })));

describe('CR 601.2f, 601.2i, 601.3b, 611.3a: "The first artifact spell you cast each turn costs {1} less to cast and can be cast as though it had flash."', () => {
  const QUARTERMASTER = card('Test Quartermaster', 'Creature — Human', 'The first artifact spell you cast each turn costs {1} less to cast and can be cast as though it had flash.', ['1', '1']);
  const GADGET = card('Test Gadget', 'Artifact', '', undefined, '{2}');
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, '{W}', ['W']);
  const defs = [QUARTERMASTER, GADGET, TONIC, BEAR];
  const gadget = (s: GameState, player = 'p1'): ObjectId => find(s, 'Test Gadget', 'hand', player);
  it('is automated', () => {
    expect(automated(QUARTERMASTER)).toBe(true);
  });
  it('the first artifact spell you cast costs {1} less, the second does not; the next turn the first one again does', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Gadget', 'Test Gadget', 'Test Gadget', 'Test Bear'], battlefield: ['Test Quartermaster', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs });
    expect(costOf(s, gadget(s), GADGET)).toBe('{1}');
    expect(costOf(s, find(s, 'Test Bear', 'hand'), BEAR)).toBe('{1}{G}'); // not an artifact spell
    s = castAndResolve(s, 'Test Gadget');
    expect(costOf(s, gadget(s), GADGET)).toBe('{2}');
    s = advanceTo(s, 3, 'main1');
    expect(costOf(s, gadget(s), GADGET)).toBe('{1}');
  });
  it('an opponent\'s artifact spells and an artifact cast by you after another one is cast are not discounted', () => {
    const s = scenario([], { p1: { battlefield: ['Test Quartermaster'] }, p2: { hand: ['Test Gadget'] }, defs });
    expect(costOf(s, gadget(s, 'p2'), GADGET, 'p2')).toBe('{2}');
  });
  it('the first artifact spell may be cast as though it had flash: with a spell on the stack, but not once an artifact spell was cast this turn', () => {
    const base = (withCard: boolean): GameState => scenario(['Plains'], {
      p1: { hand: ['Test Tonic', 'Test Gadget', 'Test Gadget'], battlefield: [...(withCard ? ['Test Quartermaster'] : []), 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs,
    });
    const without = drive(act(base(false), { type: 'cast', player: 'p1', card: find(base(false), 'Test Tonic', 'hand') }));
    expect(castLabels(without)).not.toContain('Cast Test Gadget'); // an artifact is a sorcery-speed spell (CR 307.1)
    const withCard = base(true);
    let s = drive(act(withCard, { type: 'cast', player: 'p1', card: find(withCard, 'Test Tonic', 'hand') }));
    expect(s.zones.stack.length).toBe(1);
    expect(castLabels(s)).toContain('Cast Test Gadget'); // as though it had flash (CR 601.3b)
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gadget', 'hand') }));
    expect(names(s, s.zones.stack)).toEqual(['Test Tonic', 'Test Gadget']);
    // an artifact spell was cast this turn: the second has no flash
    expect(castLabels(s)).not.toContain('Cast Test Gadget');
  });
});

describe('CR 601.2f, 601.2i, 611.3a, 500.1: "The first non-Elf creature spell with flying you cast during each of your turns costs {1} less to cast."', () => {
  const LEMUR = card('Test Lemur', 'Creature — Lemur', 'The first non-Elf creature spell with flying you cast during each of your turns costs {1} less to cast.', ['1', '1']);
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1'], '{2}{U}', ['U']);
  const ELF_BIRD = card('Test Elf Bird', 'Creature — Elf Bird', 'Flying', ['1', '1'], '{2}{U}', ['U']);
  const FLASH_BIRD = card('Test Flash Bird', 'Creature — Bird', 'Flash\nFlying', ['1', '1'], '{2}{U}', ['U']);
  const defs = [LEMUR, BIRD, ELF_BIRD, FLASH_BIRD, BEAR];
  const cost = (s: GameState, name: string, d: CardDef, player = 'p1'): string => costOf(s, find(s, name, 'hand', player), d, player);
  it('is automated', () => {
    expect(automated(LEMUR)).toBe(true);
  });
  it('only a creature spell with flying that is not an Elf is cheaper, and only the first one this turn', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Bird', 'Test Bird', 'Test Elf Bird', 'Test Bear'], battlefield: ['Test Lemur', 'Island', 'Island', 'Island', 'Island', 'Island', 'Island'] }, defs });
    expect(cost(s, 'Test Bird', BIRD)).toBe('{1}{U}');
    expect(cost(s, 'Test Elf Bird', ELF_BIRD)).toBe('{2}{U}'); // an Elf
    expect(cost(s, 'Test Bear', BEAR)).toBe('{1}{G}'); // no flying
    s = castAndResolve(s, 'Test Elf Bird');
    expect(cost(s, 'Test Bird', BIRD)).toBe('{1}{U}'); // an Elf Bird spell is not a non-Elf creature spell: it does not use the discount up
    s = castAndResolve(s, 'Test Bird');
    expect(cost(s, 'Test Bird', BIRD)).toBe('{2}{U}');
  });
  it('only during your own turns: on an opponent\'s turn its controller\'s spells are not cheaper', () => {
    let s = scenario(['Island'], { p2: { hand: ['Test Flash Bird'], battlefield: ['Test Lemur'] }, defs });
    expect(cost(s, 'Test Flash Bird', FLASH_BIRD, 'p2')).toBe('{2}{U}'); // turn 1 is p1's
    s = advanceTo(s, 2, 'main1');
    expect(cost(s, 'Test Flash Bird', FLASH_BIRD, 'p2')).toBe('{1}{U}');
  });
});

describe('CR 701.21a, 118.3, 601.2f, 603.4: "~ costs {3} less to cast if you\'ve sacrificed an artifact this turn."', () => {
  const DETONATION = card('Test Detonation', 'Sorcery', "This spell costs {3} less to cast if you've sacrificed an artifact this turn.\nTest Detonation deals 4 damage to target creature.", undefined, '{4}{R}', ['R']);
  const TRINKET = card('Test Trinket', 'Artifact', 'Sacrifice this artifact: You gain 1 life.', undefined, '{1}');
  const FODDER = card('Test Fodder', 'Creature — Goblin', 'Sacrifice this creature: You gain 1 life.', ['1', '1'], '{R}', ['R']);
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, '{0}', ['W']);
  const defs = [DETONATION, TRINKET, FODDER, TONIC, BEAR];
  const cost = (s: GameState): string => costOf(s, find(s, 'Test Detonation', 'hand'), DETONATION);
  const sacrifice = (s: GameState, name: string): GameState => resolveAll(activateFirst(s, find(s, name, 'battlefield')));
  it('is automated', () => {
    expect(automated(DETONATION)).toBe(true);
  });
  it('sacrificing an artifact (as the cost of its own ability) makes it cheaper by {3} that turn; sacrificing a creature does not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Detonation'], battlefield: ['Test Trinket', 'Test Fodder'] }, p2: { battlefield: ['Test Bear'] }, defs });
    expect(cost(s0)).toBe('{4}{R}');
    const afterCreature = sacrifice(s0, 'Test Fodder');
    expect(cost(afterCreature)).toBe('{4}{R}');
    const afterArtifact = sacrifice(afterCreature, 'Test Trinket');
    expect(cost(afterArtifact)).toBe('{1}{R}');
    expect(cost(advanceTo(afterArtifact, 3, 'main1'))).toBe('{4}{R}'); // this turn only
  });
  it('only your own sacrifices count: an opponent sacrificing an artifact does not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tonic', 'Test Detonation'] }, p2: { battlefield: ['Test Trinket'] }, defs });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tonic', 'hand') }));
    s = pass(s); // p2 has priority with the Tonic on the stack
    s = activateFirst(s, find(s, 'Test Trinket', 'battlefield'));
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Trinket')).toBe(false);
    s = resolveAll(s);
    expect(cost(s)).toBe('{4}{R}');
  });
});

describe('CR 509.1b, 611.3a: "~ can\'t be blocked as long as you\'ve sacrificed an artifact this turn."', () => {
  const COURIER = card('Test Courier', 'Creature — Rogue', "~ can't be blocked as long as you've sacrificed an artifact this turn.", ['2', '2']);
  const TRINKET = card('Test Trinket', 'Artifact', 'Sacrifice this artifact: You gain 1 life.', undefined, '{1}');
  const defs = [COURIER, TRINKET, BEAR];
  const toBlockers = (withSacrifice: boolean): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Courier', 'Test Trinket'] }, p2: { battlefield: ['Test Bear'] }, defs });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Courier', 'battlefield')]]);
    if (withSacrifice) s = resolveAll(activateFirst(s, find(s, 'Test Trinket', 'battlefield')));
    return passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers');
  };
  it('is automated', () => {
    expect(automated(COURIER)).toBe(true);
  });
  it('can be blocked until an artifact is sacrificed', () => {
    const s = toBlockers(false);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(JSON.stringify(s.pending)).toContain(find(s, 'Test Bear', 'battlefield'));
  });
  it('cannot be blocked after you sacrificed an artifact this turn', () => {
    const s = toBlockers(true);
    const blockers = s.pending?.kind === 'declareBlockers' ? JSON.stringify(s.pending) : '';
    expect(blockers).not.toContain(find(s, 'Test Bear', 'battlefield'));
  });
});

describe('CR 601.2f, 602.2b, 118.7: "This ability costs {2} less to activate if you control a creature with a +1/+1 counter on it."', () => {
  const TAPPER = card('Test Tapper', 'Creature — Soldier', '{3}{W}, {T}: Tap another target creature. This ability costs {2} less to activate if you control a creature with a +1/+1 counter on it.', ['1', '1']);
  const defs = [TAPPER, BEAR];
  const offered = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && !a.isMana && a.object === find(s, 'Test Tapper', 'battlefield'));
  const plains = (n: number): string[] => Array(n).fill('Plains') as string[];
  it('is automated, and the ability carries a conditional cost change (never a step)', () => {
    expect(automated(TAPPER)).toBe(true);
    const a = TAPPER.faces[0]!.abilities.find((x) => x.kind === 'activated')!;
    expect(a.kind === 'activated' && a.costChange?.kind).toBe('reduce');
    expect(JSON.stringify(a)).not.toContain('"op":"manual"');
  });
  it('without such a creature the full {3}{W} is needed (two lands are not enough); with one you control it costs {1}{W}', () => {
    const none = scenario([], { p1: { battlefield: ['Test Tapper', ...plains(2), 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs });
    expect(offered(none)).toBe(false);
    const withCounter = scenario([], { p1: { battlefield: ['Test Tapper', ...plains(2), { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, p2: { battlefield: ['Test Bear'] }, defs });
    expect(offered(withCounter)).toBe(true);
    const s = activateFirst(withCounter, find(withCounter, 'Test Tapper', 'battlefield'), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(withCounter, 'Test Bear', 'battlefield', 'p2') }] }]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(2);
    expect(resolveAll(s).objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.tapped).toBe(true);
  });
  it('an opponent\'s creature with a counter does not count (you control it), nor does a counter of another kind', () => {
    const theirs = scenario([], { p1: { battlefield: ['Test Tapper', ...plains(2)] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] }, defs });
    expect(offered(theirs)).toBe(false);
    const other = scenario([], { p1: { battlefield: ['Test Tapper', ...plains(2), { name: 'Test Bear', counters: { '-1/-1': 1 } }] }, p2: { battlefield: ['Test Bear'] }, defs });
    expect(offered(other)).toBe(false);
  });
});

describe('CR 601.2f, 602.2b, 508.1, 118.7: "This ability costs {3} less to activate if you attacked with a Spacecraft this turn."', () => {
  const TORPEDO = card('Test Torpedo', 'Artifact', '{6}, {T}, Sacrifice ~: Destroy target nonland permanent. This ability costs {3} less to activate if you attacked with a Spacecraft this turn.', undefined, '{1}');
  const PROBE = card('Test Probe', 'Artifact Creature — Spacecraft', '', ['1', '1'], '{2}');
  const defs = [TORPEDO, PROBE, BEAR];
  const plains = (n: number): string[] => Array(n).fill('Plains') as string[];
  const offered = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && !a.isMana && a.object === find(s, 'Test Torpedo', 'battlefield'));
  const attackWith = (name: string): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Torpedo', name, ...plains(3)] }, p2: { battlefield: ['Test Bear'] }, defs });
    expect(offered(s0)).toBe(false); // {6} with three lands
    return declareAttackers(toDeclareAttackers(s0), [[find(s0, name, 'battlefield')]]);
  };
  it('is automated', () => {
    expect(automated(TORPEDO)).toBe(true);
  });
  it('after attacking with a Spacecraft the ability costs {3}: three lands suffice', () => {
    const s = attackWith('Test Probe');
    expect(offered(s)).toBe(true);
    const t = activateFirst(s, find(s, 'Test Torpedo', 'battlefield'), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Bear', 'battlefield', 'p2') }] }]);
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.defId === 'Plains' && t.objects[id]!.tapped)).toHaveLength(3);
  });
  it('attacking with another kind of creature does not reduce it', () => {
    expect(offered(attackWith('Test Bear'))).toBe(false);
  });
});

describe('CR 614.1c, 614.12, 500.1: "~ enters tapped if it\'s not your turn."', () => {
  const CRAB = card('Test Crab', 'Creature — Crab', "Flash\nThis creature enters tapped if it's not your turn.", ['2', '2'], '{1}');
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, '{0}', ['W']);
  const defs = [CRAB, TONIC];
  const tappedCrab = (s: GameState, player: string): boolean => s.objects[find(s, 'Test Crab', 'battlefield', player)]!.tapped;
  it('is automated', () => {
    expect(automated(CRAB)).toBe(true);
  });
  it('enters untapped on its controller\'s own turn, tapped on the opponent\'s turn', () => {
    const mine = castAndResolve(scenario(['Plains'], { p1: { hand: ['Test Crab'], battlefield: ['Plains'] }, defs }), 'Test Crab');
    expect(tappedCrab(mine, 'p1')).toBe(false);
    // p2 flashes it in on p1's turn 1: not p2's turn
    let s = scenario(['Plains'], { p1: { hand: ['Test Tonic'] }, p2: { hand: ['Test Crab'], battlefield: ['Plains'] }, defs });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tonic', 'hand') }));
    s = pass(s);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Crab', 'hand', 'p2') })));
    expect(tappedCrab(s, 'p2')).toBe(true);
    // on its own turn 2 the same card enters untapped
    const own = castAndResolve(advanceTo(scenario(['Plains'], { p2: { hand: ['Test Crab'], battlefield: ['Plains'] }, defs }), 2, 'main1'), 'Test Crab', 'p2');
    expect(tappedCrab(own, 'p2')).toBe(false);
  });
});

describe('CR 614.1c, 614.12, 500.1: "~ enters tapped unless it\'s your first, second, or third turn of the game."', () => {
  const TOWN = card('Test Town', 'Land — Town', "This land enters tapped unless it's your first, second, or third turn of the game.\n{T}: Add {C}.");
  const defs = [TOWN];
  const play = (s: GameState, player: string): GameState => act(s, { type: 'playLand', player, card: find(s, 'Test Town', 'hand', player) });
  const tappedTown = (s: GameState, player: string): boolean => s.objects[find(s, 'Test Town', 'battlefield', player)]!.tapped;
  it('is automated', () => {
    expect(automated(TOWN)).toBe(true);
  });
  it('untapped on each of the first three turns its controller takes, tapped on the fourth (turns 1, 3, 5, 7 of the starting player)', () => {
    const base = scenario([], { p1: { hand: ['Test Town'] }, p2: { hand: ['Test Town'] }, defs });
    const result = (turn: number, player: string): boolean => tappedTown(play(advanceTo(base, turn, 'main1'), player), player);
    expect(result(1, 'p1')).toBe(false); // its first turn
    expect(result(3, 'p1')).toBe(false); // second
    expect(result(5, 'p1')).toBe(false); // third
    expect(result(7, 'p1')).toBe(true); // fourth
  });
  it('the opponent counts its own turns (turns 2, 4, 6, 8): the fourth is tapped', () => {
    const base = scenario([], { p1: { hand: ['Test Town'] }, p2: { hand: ['Test Town'] }, defs });
    const result = (turn: number): boolean => tappedTown(play(advanceTo(base, turn, 'main1'), 'p2'), 'p2');
    expect(result(2)).toBe(false);
    expect(result(6)).toBe(false);
    expect(result(8)).toBe(true);
  });
});
