/**
 * FAST5 T66 (T7-D removal, control change and library/graveyard to battlefield): the shapes of parser/templates/zz-fast5/t66.json and the engine support they
 * need, played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 400.3, 404.1      an object goes to its owner's hand, library or graveyard, whoever controls it
 *   CR 701.24a, 303.4    "shuffle enchanted creature into its owner's library": the permanent an Aura is attached to
 *   CR 701.62a           manifest dread: look at the top two cards, manifest one, the other goes to the graveyard (the player the text names does it)
 *   CR 607.2a, 400.7     "the exiled card's owner ...": the card a linked ability exiled
 *   CR 701.23a, 110.4    searches for a permanent card or a card with a type, with a mana value
 *   CR 508.4             a creature put onto the battlefield attacking never "attacked"
 *   CR 122.1h            a finality counter: exiled instead of going to the graveyard
 *   CR 115.1, 601.2c     targets chosen together keep their total / share a card type / are one for each opponent
 *   CR 608.2d            "up to two creature cards with total mana value 4 or less": a choice that keeps the total
 *   CR 118.12a           "unless its controller has ~ deal damage to them"
 *   CR 510.2             "whose controller was dealt combat damage by ~ this turn"
 *   CR 110.4, 608.2e     "chooses a permanent of each permanent type and sacrifices the rest"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, charsOfObject, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, put, reject, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const inHand = (s: GameState, p: string): string[] => names(s, s.zones.hand[p]!);
const onBattlefield = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Answer the decisions that come up: costs automatically, each target choice from the queue in order, object choices by `pick`, yes/no with `yes`; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], pick: (ids: ObjectId[], d: { prompt: string; min: number; max: number }) => ObjectId[] = (ids, d) => ids.slice(0, d.min), yes = true): GameState {
  let s = s0;
  const queue = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(d.options, d) });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [d.options[0]!.id] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else break;
  }
  return s;
}
type Pick = Parameters<typeof settle>[2];
/** Both players pass until the stack is empty; decisions on the way are answered by `settle`. */
function resolveAll(s0: GameState, targets: TargetChoice[][] = [], pick?: Pick, yes = true): GameState {
  let s = settle(s0, targets, pick, yes);
  const queue = [...targets];
  for (let guard = 0; guard < 60; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, queue, pick, yes);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)} ${s.zones.stack.length} ${s.log.slice(-4).map((l) => l.text).join(' / ')}`);
}
/** Cast the first card of that name from p1's hand (targets in order) and let everything resolve. */
const castFirst = (s0: GameState, name: string, targets: TargetChoice[][] = [], pick?: Pick, yes = true): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.slice(0, 1), pick, yes), targets.slice(1), pick, yes);

const BEAR = 'Grizzly Bears';

describe('CR 400.3: "Return each creature that isn\'t a Dog, Cat, Rat, Bat, or Bird to its owner\'s hand."', () => {
  const FLOOD = card('Test Flood', 'Sorcery', "Return each creature that isn't a Dog, Cat, Rat, Bat, or Bird to its owner's hand.");
  const HOUND = card('Test Hound', 'Creature — Dog', '', '{0}', ['1', '1']);
  const CROW = card('Test Crow', 'Creature — Bird Scout', '', '{0}', ['1', '1']);
  it('is automated (no manual part)', () => expect(manualParts(FLOOD)).toEqual([]));
  it('returns the creatures of any type but those, whoever controls them, to their owners\' hands; the listed types stay', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Flood'], battlefield: [BEAR, 'Test Hound'] }, p2: { battlefield: [BEAR, 'Test Crow', 'Test Hound'] }, defs: [FLOOD, HOUND, CROW] });
    const s = castFirst(s0, 'Test Flood');
    expect(names(s, onBattlefield(s, 'p1'))).toEqual(['Test Hound']);
    expect(names(s, onBattlefield(s, 'p2'))).toEqual(['Test Crow', 'Test Hound']);
    expect(inHand(s, 'p1')).toEqual([BEAR]); // p1's own Bears
    expect(inHand(s, 'p2')).toEqual([BEAR]); // p2's Bears went to p2's hand (its owner)
  });
});

describe('CR 701.24a, 303.4, 400.3: "Shuffle enchanted creature into its owner\'s library." (an Aura\'s activated ability)', () => {
  const CURSE = card('Test Curse', 'Enchantment — Aura', 'Enchant creature\n{0}: Shuffle enchanted creature into its owner\'s library.');
  const CURSE2 = card('Test Hex', 'Enchantment — Aura', 'Enchant creature\n{0}: Shuffle enchanted creature into its owner\'s library, then manifest dread. Activate only as a sorcery.');
  /** An Aura of p1 on the battlefield attached to `to` (placed after the scenario starts, so state-based actions have not removed it as unattached). */
  const enchant = (s: GameState, aura: string, to: ObjectId): ObjectId => { const id = put(s, 'p1', 'battlefield', aura); s.objects[id]!.attachedTo = to; return id; };
  it('are automated (no manual part)', () => {
    expect(manualParts(CURSE)).toEqual([]);
    expect(manualParts(CURSE2)).toEqual([]);
  });
  it('moves the enchanted creature of another player into ITS OWNER\'s library (the Aura falls off and goes to the graveyard)', () => {
    let s = scenario([BEAR], { p2: { battlefield: [BEAR] }, defs: [CURSE] });
    const bear = find(s, BEAR, 'battlefield', 'p2');
    const aura = enchant(s, 'Test Curse', bear);
    const library = s.zones.library['p2']!.length;
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: aura, ability: 'p:0:1' }));
    expect(zoneOf(s, bear)).not.toBe('battlefield');
    expect(s.zones.library['p2']!.length).toBe(library + 1);
    expect(names(s, s.zones.library['p2']!).filter((n) => n === BEAR)).toEqual([BEAR]);
    expect(s.zones.library['p1']!.every((id) => s.defs[s.objects[id]!.defId]!.name !== BEAR)).toBe(true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Curse')).toBe(false); // state-based action: an Aura attached to nothing (CR 704.5m)
  });
  it('"then manifest dread": the ability\'s controller looks at the top two cards, manifests one (a face-down 2/2) and the other goes to the graveyard (CR 701.62a)', () => {
    let s = scenario([BEAR, 'Forest'], { p1: { library: [BEAR, 'Forest'] }, p2: { battlefield: [BEAR] }, defs: [CURSE2] });
    const aura = enchant(s, 'Test Hex', find(s, BEAR, 'battlefield', 'p2'));
    const before = onBattlefield(s, 'p1').length;
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: aura, ability: 'p:0:1' }), [], (ids) => [ids[0]!]);
    const gy = s.zones.graveyard['p1']!;
    expect(gy.length).toBe(2); // the other card of the two, and the Aura
    const faceDown = onBattlefield(s, 'p1').filter((id) => s.objects[id]!.faceDown);
    expect(faceDown.length).toBe(1);
    expect(charsOfObject(s, s.objects[faceDown[0]!]!).power).toBe('2');
    expect(onBattlefield(s, 'p1').length).toBe(before - 1 + 1); // the Aura left, the manifested card came
  });
});

/** Declare `ids` as attackers (no blocks) and go to the end of combat, answering the decisions on the way with `settle`. Stops at the end of combat step. */
function attack(s0: GameState, ids: ObjectId[], targets: TargetChoice[][] = [], pick?: Pick, yes = true): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), ids.map((i) => [i] as [ObjectId]));
  const queue = [...targets];
  for (let i = 0; i < 120; i++) {
    const d = s.pending;
    if (!d || s.result) throw new Error('the game ended in combat');
    if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'priority') {
      if (s.turn.step === 'endCombat' && s.zones.stack.length === 0) return s;
      s = pass(s);
    } else s = settle(s, queue, pick, yes);
  }
  throw new Error('combat did not finish');
}
const BOLT_HOLDER = card('Test Mage', 'Creature — Wizard', '', '{0}', ['1', '1']);

describe('CR 400.3, 701.62a: "Destroy target creature. Its controller manifests dread." (the player who lost the creature, not the caster)', () => {
  const REMAKE = card('Test Remake', 'Instant', 'Destroy target creature. Its controller manifests dread.');
  it('is automated (no manual part)', () => expect(manualParts(REMAKE)).toEqual([]));
  it("the creature's controller looks at the top two cards of THEIR library, manifests one (a face-down 2/2) and puts the other into THEIR graveyard", () => {
    const s0 = scenario([BEAR, 'Forest'], { p1: { hand: ['Test Remake'] }, p2: { battlefield: [BEAR], library: ['Forest', BEAR] }, defs: [REMAKE] });
    const bear = find(s0, BEAR, 'battlefield', 'p2');
    const p1Library = s0.zones.library['p1']!.length;
    const s = castFirst(s0, 'Test Remake', [[obj(bear)]], (ids) => [ids[0]!]);
    expect(names(s, s.zones.graveyard['p2']!)).toContain(BEAR); // the destroyed Bears (a new object in its owner's graveyard, CR 400.7)
    const faceDown = onBattlefield(s, 'p2').filter((id) => s.objects[id]!.faceDown);
    expect(faceDown).toHaveLength(1);
    expect(s.zones.graveyard['p2']!).toHaveLength(2); // the destroyed Bears and the card of the two that was not manifested
    expect(s.zones.library['p1']!.length).toBe(p1Library); // the caster's library is untouched
    expect(onBattlefield(s, 'p1').filter((id) => s.objects[id]!.faceDown)).toHaveLength(0);
  });
});

describe("CR 607.2a, 400.7, 701.62a, 111.1: \"the exiled card's owner ...\" (the card a linked ability exiled, whoever its controller was)", () => {
  const HOVER = card('Test Hover', 'Artifact — Vehicle', "When ~ enters, exile up to one target creature with toughness 5 or less.\nWhen ~ leaves the battlefield, the exiled card's owner manifests dread.");
  const PRIEST = card('Test Priest', 'Creature — Djinn', "When ~ enters, exile target creature an opponent controls.\nWhen ~ leaves the battlefield, the exiled card's owner creates an X/X white Spirit creature token, where X is the mana value of the exiled card.", '{0}', ['1', '1']);
  const SMITE = card('Test Smite', 'Instant', 'Destroy target artifact.');
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('are automated (no manual part)', () => {
    expect(manualParts(HOVER)).toEqual([]);
    expect(manualParts(PRIEST)).toEqual([]);
  });
  it("the exiled card's owner manifests dread when the exiling permanent leaves the battlefield (the card stays exiled)", () => {
    let s = scenario([BEAR, 'Forest'], { p1: { hand: ['Test Hover', 'Test Smite'] }, p2: { battlefield: [BEAR], library: ['Forest', BEAR] }, defs: [HOVER, SMITE] });
    const bear = find(s, BEAR, 'battlefield', 'p2');
    s = castFirst(s, 'Test Hover', [[], [obj(bear)]]); // the cast has no target; the enters trigger's target is the second answer
    expect(names(s, s.zones.exile)).toEqual([BEAR]); // the Bears are a new object in exile (CR 400.7)
    const hover = find(s, 'Test Hover', 'battlefield', 'p1');
    s = castFirst(s, 'Test Smite', [[obj(hover)]], (ids) => [ids[0]!]);
    expect(onBattlefield(s, 'p2').filter((id) => s.objects[id]!.faceDown)).toHaveLength(1);
    expect(onBattlefield(s, 'p1').filter((id) => s.objects[id]!.faceDown)).toHaveLength(0);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === BEAR)).toBe(true);
  });
  it("the exiled card's OWNER creates an X/X token, X the mana value of the exiled card (Grizzly Bears: 2)", () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Priest', 'Test Kill'] }, p2: { battlefield: [BEAR] }, defs: [PRIEST, KILL] });
    const bear = find(s, BEAR, 'battlefield', 'p2');
    s = castFirst(s, 'Test Priest', [[], [obj(bear)]]);
    expect(names(s, s.zones.exile)).toEqual([BEAR]); // the Bears are a new object in exile (CR 400.7)
    const priest = find(s, 'Test Priest', 'battlefield', 'p1');
    s = castFirst(s, 'Test Kill', [[obj(priest)]]);
    const spirits = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Spirit Token');
    expect(spirits).toHaveLength(1);
    expect(s.objects[spirits[0]!]!.controller).toBe('p2'); // the exiled card's owner, not the caster
    expect(charsOfObject(s, s.objects[spirits[0]!]!)).toMatchObject({ power: '2', toughness: '2' });
  });
});

/** Cast the first card of that name from p1's hand (costs paid automatically, targets in order) and pass priority until a decision other than priority is pending (or the stack is empty). */
function castUntilDecision(s0: GameState, name: string, targets: TargetChoice[][] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  const queue = [...targets];
  for (let i = 0; i < 40; i++) {
    const d = s.pending;
    if (!d) break;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets' && queue.length > 0) s = answer(s, { kind: 'chooseTargets', targets: queue.shift()! }); // (a target decision with no answer left is the caller's)
    else if (d.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const chosen = (s: GameState): { options: ObjectId[]; min: number; max: number; limit?: unknown } => {
  const d = s.pending;
  if (d?.kind !== 'chooseObjects') throw new Error(`expected an object choice, got ${d?.kind}`);
  return d;
};

describe('CR 701.23a, 110.4, 202.3: the library searches', () => {
  const GATE = card('Test Gate', 'Land — Gate', '');
  const BLOOM = card('Test Bloom', 'Sorcery', 'Search your library for a basic land card or a Gate card, put it onto the battlefield, then shuffle.');
  const CALL = card('Test Call', 'Sorcery', 'Search your library for a nonland permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.');
  const FETCH = card('Test Fetch', 'Sorcery', 'You may search your library for an artifact card with mana value 4 or 5, reveal it, put it into your hand, then shuffle.');
  const GEAR = (name: string, cost: string): CardDef => card(name, 'Artifact', '', cost);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}{R}', ['3', '3']);
  it('are automated (no manual part)', () => {
    for (const d of [BLOOM, CALL, FETCH]) expect(manualParts(d), d.name).toEqual([]);
  });
  it('"a basic land card or a Gate card": only a basic land or a Gate can be found, and it enters untapped under your control', () => {
    const s0 = scenario(['Forest', BEAR], { p1: { hand: ['Test Bloom'], library: [BEAR, 'Test Gate', 'Forest'] }, defs: [BLOOM, GATE] });
    let s = castUntilDecision(s0, 'Test Bloom');
    const d = chosen(s);
    expect([...new Set(names(s, d.options))]).toEqual(['Forest', 'Plains', 'Test Gate']); // not the Grizzly Bears
    const gate = d.options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gate')!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [gate] }));
    const entered = onBattlefield(s, 'p1').find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gate');
    expect(entered).toBeDefined();
    expect(s.objects[entered!]!.tapped).toBe(false);
  });
  it('"a nonland permanent card with mana value 3 or less": a land, a spell and a card of mana value 4 cannot be found', () => {
    const s0 = scenario([BEAR, 'Forest'], { p1: { hand: ['Test Call'], library: [BEAR, 'Test Ogre', 'Forest', 'Test Gear3', 'Test Gear4'] }, defs: [CALL, OGRE, GEAR('Test Gear3', '{3}'), GEAR('Test Gear4', '{4}')] });
    let s = castUntilDecision(s0, 'Test Call');
    const d = chosen(s);
    expect(names(s, d.options)).toEqual([BEAR, 'Test Gear3']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [d.options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gear3')!] }));
    expect(names(s, onBattlefield(s, 'p1'))).toContain('Test Gear3');
    expect(s.zones.library['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gear3')).toBe(false);
  });
  it('"an artifact card with mana value 4 or 5, reveal it, put it into your hand": mana value 3 and 6 and a creature of mana value 4 are not found', () => {
    const s0 = scenario(['Forest'], {
      p1: { hand: ['Test Fetch'], library: ['Test Gear3', 'Test Gear4', 'Test Gear5', 'Test Gear6', 'Test Ogre'] },
      defs: [FETCH, OGRE, GEAR('Test Gear3', '{3}'), GEAR('Test Gear4', '{4}'), GEAR('Test Gear5', '{5}'), GEAR('Test Gear6', '{6}')],
    });
    let s = castUntilDecision(s0, 'Test Fetch');
    if (s.pending!.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    const d = chosen(s);
    expect(names(s, d.options)).toEqual(['Test Gear4', 'Test Gear5']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [d.options[0]!] }));
    expect(inHand(s, 'p1').filter((n) => n.startsWith('Test Gear'))).toHaveLength(1);
  });
});

describe('CR 508.4, 608.2h: "you may put a creature card with mana value X or less from your hand onto the battlefield tapped and attacking, where X is the number of attacking creatures you control."', () => {
  const SENTRY = card('Test Sentry', 'Creature — Soldier', 'Whenever ~ attacks, you may put a creature card with mana value X or less from your hand onto the battlefield tapped and attacking, where X is the number of attacking creatures you control.', '{0}', ['2', '2']);
  const WATCHER = card('Test Watcher', 'Creature — Spirit', 'Whenever a creature you control attacks, you gain 1 life.', '{0}', ['1', '1']);
  const BIG = card('Test Big', 'Creature — Giant', '', '{3}{G}', ['4', '4']);
  it('is automated (no manual part)', () => expect(manualParts(SENTRY)).toEqual([]));
  it('puts a creature card of mana value up to the number of attackers into play tapped and attacking: it was never declared as an attacker (no "attacks" trigger), and it deals combat damage', () => {
    let s0 = scenario([BEAR], { p1: { hand: [BEAR, 'Test Big'], battlefield: ['Test Sentry', 'Test Watcher'] }, defs: [SENTRY, WATCHER, BIG] });
    const sentry = find(s0, 'Test Sentry', 'battlefield', 'p1');
    const life = lifeOf(s0, 'p1');
    const oppLife = lifeOf(s0, 'p2');
    // one attacker: X = 1, the Bears (mana value 2) cannot be put; with the Watcher attacking too X = 2
    s0 = attack(s0, [sentry, find(s0, 'Test Watcher', 'battlefield', 'p1')], [], (ids) => ids.slice(0, 1));
    expect(inHand(s0, 'p1')).toEqual(['Test Big']); // the Bears were put onto the battlefield (mana value 2 <= X = 2), the big creature (mana value 4) could not be
    const bear = find(s0, BEAR, 'battlefield', 'p1');
    expect(s0.objects[bear]!.tapped).toBe(true);
    expect(lifeOf(s0, 'p1')).toBe(life + 2); // Test Watcher triggered for the two declared attackers only (CR 508.4: the Bears never "attacked")
    expect(lifeOf(s0, 'p2')).toBe(oppLife - (2 + 1 + 2)); // all three attacked unblocked: Sentry 2, Watcher 1, the Bears 2
  });
});

describe('CR 122.1h, 400.3, 608.2d: "you may put a Bird creature card from your hand or graveyard onto the battlefield with a finality counter on it."', () => {
  const FLOCK = card('Test Flock', 'Creature — Bird', 'Whenever ~ attacks, you may put a Bird creature card from your hand or graveyard onto the battlefield with a finality counter on it.', '{0}', ['1', '1']);
  const CROW = card('Test Crow', 'Creature — Bird Scout', '', '{0}', ['1', '1']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('is automated (no manual part)', () => expect(manualParts(FLOCK)).toEqual([]));
  it('offers the Bird cards of the hand AND the graveyard (not another type, not an opponent\'s graveyard); the Bird comes in with a finality counter and is exiled instead of dying', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Crow', BEAR, 'Test Kill'], battlefield: ['Test Flock'], graveyard: ['Test Crow', BEAR] }, p2: { graveyard: ['Test Crow'] }, defs: [FLOCK, CROW, KILL] });
    const flock = find(s, 'Test Flock', 'battlefield', 'p1');
    let seen: ObjectId[] = [];
    s = attack(s, [flock], [], (ids, d) => {
      if (/Bird|choose/i.test(d.prompt)) seen = ids;
      return ids.filter((id) => s.objects[id]!.zone === 'graveyard').slice(0, 1);
    });
    expect(seen).toHaveLength(2); // the Crow in the hand and the Crow in p1's graveyard
    const crow = onBattlefield(s, 'p1').find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Crow');
    expect(crow).toBeDefined();
    expect(s.objects[crow!]!.counters['finality']).toBe(1);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Crow')).toBe(false); // it came from the graveyard
    s = castFirst(s, 'Test Kill', [[obj(crow!)]]);
    expect(names(s, s.zones.exile)).toEqual(['Test Crow']); // CR 122.1h: exiled instead of put into the graveyard
  });
});

describe('CR 115.1, 601.2c: targets chosen together keep their total / share a card type', () => {
  const MIND = card('Test Mind', 'Enchantment', 'When ~ enters, gain control of up to two target creatures with total mana value 4 or less for as long as ~ remains on the battlefield.');
  const SWAP = card('Test Swap', 'Sorcery', 'Exchange control of two target nonland permanents that share a card type.');
  const RELIC = card('Test Relic', 'Artifact', '', '{1}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}{R}', ['3', '3']);
  const SMASH = card('Test Smash', 'Instant', 'Destroy target enchantment.');
  it('are automated (no manual part)', () => {
    expect(manualParts(MIND)).toEqual([]);
    expect(manualParts(SWAP)).toEqual([]);
  });
  it('"up to two target creatures with total mana value 4 or less": a set of mana value 6 is refused, a set of 4 is taken, and control lasts as long as the enchantment remains', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Mind', 'Test Smash'] }, p2: { battlefield: [BEAR, BEAR, 'Test Ogre'] }, defs: [MIND, OGRE, SMASH] });
    const bears = findAll(s, BEAR, 'battlefield', 'p2');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = castUntilDecision(s, 'Test Mind'); // the enchantment resolves; its trigger is put on the stack and asks for targets
    expect(s.pending?.kind).toBe('chooseTargets');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(bears[0]!), obj(ogre)] } });
    s = answer(s, { kind: 'chooseTargets', targets: [obj(bears[0]!), obj(bears[1]!)] });
    s = resolveAll(s);
    expect(bears.every((b) => s.objects[b]!.controller === 'p1')).toBe(true);
    expect(s.objects[ogre]!.controller).toBe('p2');
    const mind = find(s, 'Test Mind', 'battlefield', 'p1');
    s = castFirst(s, 'Test Smash', [[obj(mind)]]);
    expect(bears.every((b) => s.objects[b]!.controller === 'p2')).toBe(true); // the enchantment left: control returns
  });
  it('"two target nonland permanents that share a card type": an artifact and a creature are refused, two creatures exchange controllers', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Swap'], battlefield: [BEAR, 'Test Relic'] }, p2: { battlefield: [BEAR, 'Test Relic'] }, defs: [SWAP, RELIC] });
    const mine = find(s, BEAR, 'battlefield', 'p1');
    const theirs = find(s, BEAR, 'battlefield', 'p2');
    const theirRelic = find(s, 'Test Relic', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Swap', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(mine), obj(theirRelic)] } }); // no card type in common
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [obj(mine), obj(theirs)] }));
    expect(s.objects[mine]!.controller).toBe('p2');
    expect(s.objects[theirs]!.controller).toBe('p1');
  });
});

describe('CR 608.2d, 115.1: "Return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield."', () => {
  const DIRGE = card('Test Dirge', 'Sorcery', 'Return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield.');
  const MEN = (n: number): CardDef => card(`Test Man${n}`, 'Creature — Human', '', `{${n}}`, ['1', '1']);
  it('is automated (no manual part)', () => expect(manualParts(DIRGE)).toEqual([]));
  it('the choice keeps the total: mana value 3 and 2 is refused, 3 and 1 is taken; the cards come back untapped under your control', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dirge'], graveyard: ['Test Man3', 'Test Man2', 'Test Man1', 'Test Man4'] }, defs: [DIRGE, MEN(1), MEN(2), MEN(3), MEN(4)] });
    let s = castUntilDecision(s0, 'Test Dirge');
    const d = chosen(s);
    expect(d.limit).toMatchObject({ stat: 'manaValue', op: '<=', value: 4 });
    expect(d.max).toBe(2);
    const by = (n: string): ObjectId => d.options.find((id) => s.defs[s.objects[id]!.defId]!.name === n)!;
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseObjects', ids: [by('Test Man3'), by('Test Man2')] } });
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [by('Test Man3'), by('Test Man1')] }));
    expect(names(s, onBattlefield(s, 'p1'))).toEqual(['Test Man1', 'Test Man3']);
    expect(names(s, s.zones.graveyard['p1']!)).toEqual(['Test Dirge', 'Test Man2', 'Test Man4']);
  });
  it('a single card above the total can never be chosen, and nothing is chosen with none to choose from', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dirge'], graveyard: ['Test Man5'] }, defs: [DIRGE, MEN(5)] });
    const s = castUntilDecision(s0, 'Test Dirge');
    const d = chosen(s);
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseObjects', ids: d.options.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Man5') } });
    expect(answer(s, { kind: 'chooseObjects', ids: [] }).pending?.kind).toBe('priority');
  });
});

describe('CR 510.2, 120.1: "{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by ~ this turn."', () => {
  const DRAKE = card('Test Drake', 'Creature — Drake', '{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by ~ this turn. Activate only once each turn.', '{0}', ['2', '2']);
  const RELIC = card('Test Relic', 'Artifact', '', '{1}');
  const OTHER = card('Test Other', 'Creature — Drake', '', '{0}', ['1', '1']);
  const activateX = (s0: GameState, x: number): GameState => {
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Drake', 'battlefield', 'p1'), ability: 'p:0:0' });
    s = answer(s, { kind: 'chooseNumber', n: x });
    s = answer(s, { kind: 'payCost', auto: true });
    return resolveAll(s);
  };
  it('is automated (no manual part)', () => expect(manualParts(DRAKE)).toEqual([]));
  it('destroys the permanents of mana value X of the player this creature dealt combat damage to this turn, and no one else\'s (the controller of the creature, other players, other mana values)', () => {
    const s0 = scenario([BEAR, 'Forest'], { p1: { battlefield: ['Test Drake', 'Test Relic', 'Forest'] }, p2: { battlefield: ['Test Relic', BEAR, 'Test Relic'] }, defs: [DRAKE, RELIC] });
    const drake = find(s0, 'Test Drake', 'battlefield', 'p1');
    let s = attack(s0, [drake]);
    s = activateX(s, 1);
    expect(names(s, onBattlefield(s, 'p2'))).toEqual([BEAR]); // both Relics (mana value 1) of the player who was dealt damage; the Bears (2) stay
    expect(names(s, onBattlefield(s, 'p1'))).toEqual(['Forest', 'Test Drake', 'Test Relic']); // p1's own Relic stays
  });
  it('destroys nothing when the damage was dealt by another creature, or when no combat damage was dealt this turn', () => {
    const s0 = scenario([BEAR, 'Forest'], { p1: { battlefield: ['Test Drake', 'Test Other', 'Forest'] }, p2: { battlefield: ['Test Relic'] }, defs: [DRAKE, RELIC, OTHER] });
    let s = attack(s0, [find(s0, 'Test Other', 'battlefield', 'p1')]);
    s = activateX(s, 1);
    expect(names(s, onBattlefield(s, 'p2'))).toEqual(['Test Relic']);
    const t0 = scenario([BEAR, 'Forest'], { p1: { battlefield: ['Test Drake', 'Forest'] }, p2: { battlefield: ['Test Relic'] }, defs: [DRAKE, RELIC] });
    expect(names(activateX(t0, 1), onBattlefield(activateX(t0, 1), 'p2'))).toEqual(['Test Relic']);
  });
});

describe('CR 118.12a, 608.2d: "Whenever ~ attacks, destroy target permanent unless its controller has ~ deal damage to them equal to ~\'s power."', () => {
  const BRUTE = card('Test Brute', 'Creature — Human Assassin', "Whenever ~ attacks, destroy target permanent unless its controller has ~ deal damage to them equal to ~'s power.", '{0}', ['3', '3']);
  it('is automated (no manual part)', () => expect(manualParts(BRUTE)).toEqual([]));
  it('the permanent\'s controller chooses: take damage equal to the power and keep the permanent, or lose it', () => {
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Brute'] }, p2: { battlefield: [BEAR] }, defs: [BRUTE] });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    const bear = find(s0, BEAR, 'battlefield', 'p2');
    const take = attack(s0, [brute], [[obj(bear)]], undefined, true);
    expect(names(take, onBattlefield(take, 'p2'))).toEqual([BEAR]);
    expect(lifeOf(take, 'p2')).toBe(lifeOf(s0, 'p2') - 3 - 3); // the damage of the choice and the combat damage
    const lose = attack(s0, [brute], [[obj(bear)]], undefined, false);
    expect(onBattlefield(lose, 'p2')).toHaveLength(0);
    expect(lifeOf(lose, 'p2')).toBe(lifeOf(s0, 'p2') - 3); // only the combat damage
  });
});

describe('CR 115.1, 601.2c, 610.3: "When ~ enters, for each opponent, exile up to one target nonland permanent that player controls until ~ leaves the battlefield."', () => {
  const BANNER = card('Test Banner', 'Enchantment', 'When ~ enters, for each opponent, exile up to one target nonland permanent that player controls until ~ leaves the battlefield.');
  const SMASH = card('Test Smash', 'Instant', 'Destroy target enchantment.');
  it('is automated (no manual part)', () => expect(manualParts(BANNER)).toEqual([]));
  it('only a nonland permanent an opponent controls can be the target, at most one; it returns when the enchantment leaves the battlefield', () => {
    let s = scenario([BEAR, 'Forest'], { p1: { hand: ['Test Banner', 'Test Smash'], battlefield: [BEAR] }, p2: { battlefield: [BEAR, 'Forest'] }, defs: [BANNER, SMASH] });
    s = castUntilDecision(s, 'Test Banner');
    const d = s.pending!;
    if (d.kind !== 'chooseTargets') throw new Error(`expected targets, got ${d.kind}`);
    expect(d.objects.map((id) => `${s.objects[id]!.controller}:${s.defs[s.objects[id]!.defId]!.name}`)).toEqual(['p2:Grizzly Bears']); // no land, none of p1's own
    expect(d.max).toBe(1);
    const bear = find(s, BEAR, 'battlefield', 'p2');
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [obj(bear)] }));
    expect(onBattlefield(s, 'p2').map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Forest']);
    s = castFirst(s, 'Test Smash', [[obj(find(s, 'Test Banner', 'battlefield', 'p1'))]]);
    expect(names(s, onBattlefield(s, 'p2'))).toEqual(['Forest', BEAR]);
  });
  it('"up to one": it may target nothing', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Banner'] }, p2: { battlefield: [BEAR] }, defs: [BANNER] });
    s = castUntilDecision(s, 'Test Banner');
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [] }));
    expect(names(s, onBattlefield(s, 'p2'))).toEqual([BEAR]);
  });
});

describe('CR 401.1, 608.2d: "The owner of target spell or nonland permanent puts it on their choice of the top or bottom of their library."', () => {
  const SETBACK = card('Test Setback', 'Instant', 'The owner of target spell or nonland permanent puts it on their choice of the top or bottom of their library.');
  const GAIN = card('Test Gain', 'Sorcery', 'You gain 5 life.');
  const chooseEnd = (s: GameState, which: 'top' | 'bottom'): GameState => {
    const d = s.pending!;
    if (d.kind !== 'chooseOption') throw new Error(`expected an option choice, got ${d.kind}`);
    return answer(s, { kind: 'chooseOption', ids: [d.options.find((o) => o.label === which)!.id] });
  };
  it('is automated (no manual part)', () => expect(manualParts(SETBACK)).toEqual([]));
  it('a permanent: its OWNER chooses (a creature of p2 controlled by p1 goes to p2\'s library); land permanents and the Aura\'s own kind are not targets', () => {
    for (const end of ['top', 'bottom'] as const) {
      let s = scenario([BEAR, 'Forest'], { p1: { hand: ['Test Setback'], battlefield: ['Forest'] }, p2: { battlefield: [BEAR, 'Forest'] }, defs: [SETBACK] });
      const bear = find(s, BEAR, 'battlefield', 'p2');
      s = castUntilDecision(s, 'Test Setback', [[obj(bear)]]);
      expect(s.pending!.player).toBe('p2'); // the owner chooses
      s = resolveAll(chooseEnd(s, end));
      const lib = s.zones.library['p2']!;
      expect(s.defs[s.objects[end === 'top' ? lib[0]! : lib[lib.length - 1]!]!.defId]!.name).toBe(BEAR);
      expect(onBattlefield(s, 'p2').map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Forest']);
    }
  });
  it('a spell: it is not countered, it never resolves, and goes to its owner\'s library', () => {
    let s = scenario([BEAR], { p1: { hand: ['Test Gain', 'Test Setback'] }, defs: [GAIN, SETBACK] });
    const life = lifeOf(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain', 'hand', 'p1') }));
    const spell = s.zones.stack[0]!;
    s = castUntilDecision(s, 'Test Setback', [[obj(spell)]]);
    expect(s.pending!.player).toBe('p1');
    s = resolveAll(chooseEnd(s, 'bottom'));
    expect(lifeOf(s, 'p1')).toBe(life);
    const lib = s.zones.library['p1']!;
    expect(s.defs[s.objects[lib[lib.length - 1]!]!.defId]!.name).toBe('Test Gain');
  });
});

describe('CR 110.4, 608.2d-e, 701.21a: "Each opponent chooses a permanent they control of each permanent type and sacrifices the rest."', () => {
  const FINALE = card('Test Finale', 'Sorcery', 'Each opponent chooses a permanent they control of each permanent type and sacrifices the rest.');
  const RELIC = card('Test Relic', 'Artifact', '', '{1}');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{2}', ['2', '2']);
  const SHRINE = card('Test Shrine', 'Enchantment', '');
  const setup = (): GameState => scenario([BEAR, 'Forest'], {
    p1: { hand: ['Test Finale'], battlefield: [BEAR, 'Test Relic', 'Forest'] },
    p2: { battlefield: [BEAR, BEAR, 'Test Relic', 'Test Relic', 'Test Golem', 'Forest', 'Forest', 'Test Shrine'] },
    defs: [FINALE, RELIC, GOLEM, SHRINE],
  });
  const kinds = (s: GameState, p: string): string[] => names(s, onBattlefield(s, p));
  it('is automated (no manual part)', () => expect(manualParts(FINALE)).toEqual([]));
  it('keeps one permanent of each type and sacrifices the rest; a permanent of two types (an artifact creature) may be the one kept for both', () => {
    const s0 = setup();
    const golem = find(s0, 'Test Golem', 'battlefield', 'p2');
    const asked: string[] = [];
    const s = castFirst(s0, 'Test Finale', [], (ids, d) => {
      asked.push(d.prompt);
      return [ids.includes(golem) ? golem : ids[0]!];
    });
    expect(asked.map((p) => /(artifact|creature|land|enchantment|battle|planeswalker)/i.exec(p)![1]!.toLowerCase())).toEqual(['artifact', 'creature', 'land']); // the enchantment: only one, no choice
    expect(kinds(s, 'p2')).toEqual(['Forest', 'Test Golem', 'Test Shrine']); // the Golem is the artifact AND the creature; everything else of p2 was sacrificed
    expect(kinds(s, 'p1')).toEqual(['Forest', BEAR, 'Test Relic'].sort()); // the caster's permanents are not touched
  });
  it('a different permanent for each type keeps those permanents (the artifact creature, chosen for neither, is sacrificed)', () => {
    const s0 = setup();
    const s = castFirst(s0, 'Test Finale', [], (ids, d) => {
      const own = ids.filter((id) => s0.defs[s0.objects[id]!.defId]!.name !== 'Test Golem');
      return [own[0] ?? ids[0]!];
    });
    expect(kinds(s, 'p2')).toEqual([BEAR, 'Forest', 'Test Relic', 'Test Shrine'].sort());
  });
});

describe('CR 603.10a, 400.3: "Whenever one or more land cards are put into your graveyard from your library, put them onto the battlefield tapped."', () => {
  const SHREDDER = card('Test Shredder', 'Artifact — Vehicle', 'Whenever one or more land cards are put into your graveyard from your library, put them onto the battlefield tapped.');
  const MILL = card('Test Mill', 'Sorcery', 'Target player mills three cards.');
  it('is automated (no manual part)', () => expect(manualParts(SHREDDER)).toEqual([]));
  it('the lands your mill put into YOUR graveyard come back tapped; the other cards stay; a mill of the opponent\'s library triggers nothing', () => {
    let s = scenario([BEAR, 'Forest'], { p1: { hand: ['Test Mill', 'Test Mill'], battlefield: ['Test Shredder'], library: ['Forest', BEAR, 'Forest'] }, p2: { library: ['Forest', 'Forest', 'Forest'] }, defs: [SHREDDER, MILL] });
    s = castFirst(s, 'Test Mill', [[{ kind: 'player', id: 'p2' } as TargetChoice]]);
    expect(onBattlefield(s, 'p1').filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Forest')).toHaveLength(0);
    s = castFirst(s, 'Test Mill', [[{ kind: 'player', id: 'p1' } as TargetChoice]]);
    const forests = onBattlefield(s, 'p1').filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Forest');
    expect(forests).toHaveLength(2);
    expect(forests.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(names(s, s.zones.graveyard['p1']!)).toEqual([BEAR, 'Test Mill', 'Test Mill'].sort());
  });
});
