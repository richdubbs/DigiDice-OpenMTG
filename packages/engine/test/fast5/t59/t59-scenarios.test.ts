/**
 * FAST5 T59 (R6-A removal and counterspell target filters): the cards the T59 grammar, templates, renderer and engine changes automate, played through
 * applyAction with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 601.2c, 115.1   a target phrase with a disjunction of descriptions: the options offered are exactly the objects that match one of them
 *   CR 118.12a         "counter target spell unless its controller pays {2} plus an additional {1} for each Faerie you control"
 *   CR 122.1d, 608.2c  "put a stun counter on each of those creatures you don't control"
 *   CR 603.2, 701.8a   "when enchanted creature becomes tapped or is dealt damage, destroy it"
 *   CR 607.2a, 607.2q  "put each card exiled with it into its owner's hand", including the card exiled to pay for the spell
 *   CR 701.24a, 400.3  "shuffle ~ and target creature ... into their owners' libraries"
 *   CR 115.3           "target creature you control other than that creature"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; supertypes?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', type_line: opts.supertypes ? `${opts.supertypes} ${type}` : type, oracle_text: text, mana_cost: opts.cost ?? '{0}', colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id));
const onField = (s: GameState, name: string): boolean => findAll(s, name, 'battlefield').length > 0;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes = { kind: 'yesNo' as const, yes: true };

/** Run the decisions of casting a card of `player` until it is on the stack, answering targets with `pick` (given the offered objects) and paying automatically. */
function castWith(s0: GameState, name: string, player: 'p1' | 'p2', pick: (offered: ObjectId[]) => TargetChoice[]): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: pick(s.pending.objects) });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

/** The names of the objects the first target decision of casting `name` offers (the cast is then abandoned: only the offer is read). */
function offered(s0: GameState, name: string, player: 'p1' | 'p2' = 'p1'): string[] {
  const s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  const d = s.pending;
  if (d?.kind !== 'chooseTargets') throw new Error(`no target decision: ${JSON.stringify(d?.kind)}`);
  return d.objects.map((id) => nameOf(s, id)).sort();
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });

describe('CR 601.2c, 115.1: "destroy target land creature or nonbasic land" offers a creature that is also a land, or a land that is not basic', () => {
  const BASH = card('Test Land Smash', 'Sorcery', 'Destroy target land creature or nonbasic land.');
  const DRYAD = card('Test Dryad Grove', 'Land Creature — Dryad', '', { pt: ['1', '1'] });
  const CAVERN = card('Test Cavern', 'Land', '');
  it('the card is automated', () => expect(manualParts(BASH)).toEqual([]));
  it('offers the land creature and the nonbasic land; not a basic land, not a creature that is not a land', () => {
    const s = scenario(['Plains'], { p1: { hand: ['Test Land Smash'] }, p2: { battlefield: ['Test Dryad Grove', 'Test Cavern', 'Plains', 'Test Bear'] }, defs: [BASH, DRYAD, CAVERN, BEAR] });
    expect(offered(s, 'Test Land Smash')).toEqual(['Test Cavern', 'Test Dryad Grove']);
  });
  it('resolves: the chosen object is destroyed (CR 701.8a)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Land Smash'] }, p2: { battlefield: ['Test Cavern', 'Plains'] }, defs: [BASH, CAVERN] });
    const s = passBoth(castWith(s0, 'Test Land Smash', 'p1', (o) => [obj(o[0]!)]));
    expect(onField(s, 'Test Cavern')).toBe(false);
    expect(onField(s, 'Plains')).toBe(true);
  });
});

describe('CR 601.2c, 205.4: "destroy target noncreature artifact or noncreature enchantment"', () => {
  const CLEAR = card('Test Clearing', 'Sorcery', 'Destroy target noncreature artifact or noncreature enchantment.');
  const ANVIL = card('Test Anvil', 'Artifact', '');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] });
  const WARD = card('Test Ward', 'Enchantment', '');
  const SPIRIT = card('Test Spirit', 'Enchantment Creature — Spirit', '', { pt: ['1', '1'] });
  it('is automated and offers the noncreature artifact and the noncreature enchantment only', () => {
    expect(manualParts(CLEAR)).toEqual([]);
    const s = scenario(['Plains'], { p1: { hand: ['Test Clearing'] }, p2: { battlefield: ['Test Anvil', 'Test Golem', 'Test Ward', 'Test Spirit', 'Plains'] }, defs: [CLEAR, ANVIL, GOLEM, WARD, SPIRIT] });
    expect(offered(s, 'Test Clearing')).toEqual(['Test Anvil', 'Test Ward']);
  });
});

describe('CR 122.1, 601.2c: "destroy target creature with no counters on it" offers only creatures with no counter of any kind', () => {
  const SNUFF = card('Test Snuff', 'Instant', 'Destroy target creature with no counters on it.');
  it('is automated; a creature with a +1/+1 counter, or with a stun counter, is not offered', () => {
    expect(manualParts(SNUFF)).toEqual([]);
    const s = scenario([], {
      p1: { hand: ['Test Snuff'] },
      p2: { battlefield: ['Test Bear', { name: 'Test Ogre', counters: { '+1/+1': 1 } }, { name: 'Test Bear', counters: { stun: 1 } }] }, defs: [SNUFF, BEAR, OGRE],
    });
    const ids = (() => {
      const after = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Snuff', 'hand', 'p1') });
      return after.pending!.kind === 'chooseTargets' ? after.pending.objects : [];
    })();
    // one Bear with no counters: it is the only legal target, so the whole offer is that one object
    expect(ids).toHaveLength(1);
    expect(s.objects[ids[0]!]!.counters).toEqual({});
  });
});

describe('CR 601.2c, 205.2a, 700.6: "counter target creature or legendary spell unless its controller pays {3}"', () => {
  const REBUFF = card('Test Rebuff', 'Instant', 'Counter target creature or legendary spell unless its controller pays {3}.');
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const RELIC = card('Test Relic', 'Artifact', 'Flash', { supertypes: 'Legendary' });
  const PLAIN_RELIC = card('Test Trinket', 'Artifact', 'Flash');
  const FLASH_BEAR = card('Test Flash Bear', 'Creature — Bear', 'Flash', { pt: ['2', '2'] });
  it('is automated; the target is a spell that is a creature spell or a legendary spell, any other spell is not offered', () => {
    expect(manualParts(REBUFF)).toEqual([]);
    const ab = JSON.stringify(REBUFF.faces[0]!.abilities[0]);
    expect(ab).toContain('"kind":"spell"');
    expect(ab).toContain('"anyOf":[{"types":["Creature"]},{"supertypes":["Legendary"]}]');
  });
  const stackWith = (names: string[]): GameState => {
    let s = scenario([], { p1: { hand: names }, p2: { hand: ['Test Rebuff'] }, defs: [REBUFF, SPARK, RELIC, PLAIN_RELIC, FLASH_BEAR] });
    for (const n of names) s = castWith(s, n, 'p1', () => []);
    return s;
  };
  it('offers a creature spell and a legendary spell, not an instant or a plain artifact spell', () => {
    const s = pass(stackWith(['Test Flash Bear', 'Test Relic', 'Test Trinket', 'Test Spark']));
    expect(s.pending?.player).toBe('p2');
    expect(offered(s, 'Test Rebuff', 'p2')).toEqual(['Test Flash Bear', 'Test Relic']);
  });
});

describe('CR 118.12a: "counter target spell unless its controller pays {2} plus an additional {1} for each Faerie you control"', () => {
  const HUSH = card('Test Hush', 'Instant', 'Counter target spell unless its controller pays {2} plus an additional {1} for each Faerie you control.');
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const FAE = card('Test Faerie', 'Creature — Faerie', '', { pt: ['1', '1'] });
  /** p1 casts a free instant, p2 (two Faeries) responds with the counterspell; p1 has `lands` Mountains. Returns the state when the counterspell has resolved up to the payment. */
  const toPayment = (lands: number): GameState => {
    let s = scenario(['Mountain'], {
      p1: { hand: ['Test Spark'], battlefield: Array(lands).fill('Mountain') as string[] }, p2: { hand: ['Test Hush'], battlefield: ['Test Faerie', 'Test Faerie', 'Test Bear'] }, defs: [HUSH, SPARK, FAE, BEAR],
    });
    s = castWith(s, 'Test Spark', 'p1', () => []);
    s = pass(s);
    s = castWith(s, 'Test Hush', 'p2', (o) => [obj(o[0]!)]);
    return passBoth(s);
  };
  it('the card is automated, one payment of {1} made 2 + (the Faeries) times', () => {
    expect(manualParts(HUSH)).toEqual([]);
    expect(JSON.stringify(HUSH.faces[0]!.abilities[0])).toContain('"times":{"q":"math","op":"+","args":[2,{"q":"count","of":{"ref":"each","filter":{"subtypes":["Faerie"],"controller":"you"}}}]}');
  });
  it('with two Faeries the payment is {4}: a player with four lands is asked, and paying keeps the spell', () => {
    let s = toPayment(4);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect((s.pending as { prompt: string }).prompt).toContain('{1}{1}{1}{1}'); // four generic mana (2 + the two Faeries)
    s = answer(s, yes);
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, s.pending.kind === 'payCost' ? { kind: 'payCost', auto: true } : yes);
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = pass(s);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Spark'); // it resolved (CR 608.2), it was not countered
  });
  it('a player with only three lands cannot pay {4} (CR 118.3): nobody is asked and the spell is countered', () => {
    const s = toPayment(3);
    expect(s.pending?.kind).toBe('priority');
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Spark');
    const log = s.log.map((l) => l.text).join('\n');
    expect(log).toMatch(/can't pay/);
  });
});

describe('CR 608.2c, 122.1d: "put a stun counter on each of those creatures you don\'t control"', () => {
  const MAZE = card('Test Maze', 'Enchantment', "When ~ enters, tap two target creatures. Put a stun counter on each of those creatures you don't control.");
  it('is automated; the counters go on the tapped creatures the controller does not control only', () => {
    expect(manualParts(MAZE)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Maze'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: [MAZE, BEAR, OGRE] });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = castWith(s, 'Test Maze', 'p1', () => []);
    s = passBoth(s); // the Enchantment resolves; its enters trigger asks for two targets
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [obj(mine), obj(theirs)] });
    s = passBoth(s); // its enters trigger resolves
    expect(s.objects[mine]!.tapped).toBe(true);
    expect(s.objects[theirs]!.tapped).toBe(true);
    expect(s.objects[theirs]!.counters['stun']).toBe(1);
    expect(s.objects[mine]!.counters['stun'] ?? 0).toBe(0);
  });
});

describe('CR 603.2, 701.8a: "when enchanted creature becomes tapped or is dealt damage, destroy it"', () => {
  const FREEZE = card('Test Deep Freeze', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -5/-0.\nWhen enchanted creature becomes tapped or is dealt damage, destroy it.');
  const POKE = card('Test Poke', 'Instant', '~ deals 1 damage to target creature.');
  it('is automated and destroys the enchanted creature when it taps (it attacks)', () => {
    expect(manualParts(FREEZE)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Deep Freeze'], battlefield: ['Test Ogre'] }, defs: [FREEZE, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = passBoth(castWith(s, 'Test Deep Freeze', 'p1', () => [obj(ogre)]));
    expect(s.objects[ogre]!.attachedTo).toBeUndefined(); // (the Aura is attached to the creature it enchants; see the next lines)
    expect(onField(s, 'Test Deep Freeze')).toBe(true);
    while (s.turn.step !== 'declareAttackers') s = pass(s);
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: ogre, defender: 'p2' }] });
    for (let i = 0; i < 10 && s.zones.stack.length === 0 && s.pending?.kind !== 'priority'; i++) s = pass(s);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(onField(s, 'Test Ogre')).toBe(false);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Ogre');
  });
  it('destroys the enchanted creature when it is dealt damage', () => {
    let s = scenario([], { p1: { hand: ['Test Deep Freeze'], battlefield: ['Test Ogre'] }, p2: { hand: ['Test Poke'] }, defs: [FREEZE, OGRE, POKE] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = passBoth(castWith(s, 'Test Deep Freeze', 'p1', () => [obj(ogre)]));
    s = pass(s); // p2 has priority in p1's main phase
    s = castWith(s, 'Test Poke', 'p2', () => [obj(ogre)]);
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) s = passBoth(s);
    expect(onField(s, 'Test Ogre')).toBe(false);
  });
});

describe('CR 607.2a, 607.2q, 400.3: "put each card exiled with it into its owner\'s hand"', () => {
  const ABDUCTOR = card('Test Abductor', 'Creature — Nightmare', "As an additional cost to cast this spell, exile a creature you control.\nWhen ~ enters, exile target creature an opponent controls.\nWhen ~ leaves the battlefield, put each card exiled with it into its owner's hand.", { pt: ['3', '3'] });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  it('is automated, and both exile instructions carry the link', () => {
    expect(manualParts(ABDUCTOR)).toEqual([]);
    const text = JSON.stringify(ABDUCTOR.faces[0]!.abilities);
    expect(text).toContain('"kind":"exileFrom"');
    expect(text.match(/"link":"exiled"/g)).toHaveLength(3); // the cost part, the exile step and the card the leaves trigger reads
  });
  it('when it leaves the battlefield, the creature exiled to pay for it and the one it exiled both return to their owners\' hands', () => {
    let s = scenario([], { p1: { hand: ['Test Abductor', 'Test Smite'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: [ABDUCTOR, SMITE, BEAR, OGRE] });
    const theirs = find(s, 'Test Ogre', 'battlefield', 'p2');
    // cast it, exiling the Bear as the additional cost
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Abductor', 'hand', 'p1') });
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending;
      if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    expect(onField(s, 'Test Bear')).toBe(false);
    s = passBoth(s); // the creature spell resolves
    // its enters trigger: target the opponent's Ogre
    for (let i = 0; i < 6 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [obj(theirs)] });
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(onField(s, 'Test Ogre')).toBe(false);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Ogre']);
    // destroy it: its leaves-the-battlefield trigger returns what it exiled
    const abductor = find(s, 'Test Abductor', 'battlefield', 'p1');
    s = castWith(s, 'Test Smite', 'p1', () => [obj(abductor)]);
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) s = passBoth(s);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Bear');
    expect(zoneNames(s, 'hand', 'p2')).toContain('Test Ogre');
    expect(s.zones.exile).toHaveLength(0);
  });
});

describe('CR 701.24a, 400.3: "shuffle ~ and target creature with a stun counter on it into their owners\' libraries"', () => {
  const DROWNER = card('Test Drowner', 'Creature — Merfolk', "{T}: Shuffle ~ and target creature with a stun counter on it into their owners' libraries.", { pt: ['2', '2'] });
  it('is automated; only a creature with a stun counter is offered, and each object goes into the library of its owner', () => {
    expect(manualParts(DROWNER)).toEqual([]);
    let s = scenario([], { p1: { battlefield: ['Test Drowner'] }, p2: { battlefield: ['Test Bear', { name: 'Test Ogre', counters: { stun: 1 } }] }, defs: [DROWNER, BEAR, OGRE] });
    const a = legal(s, 'p1', 'activate').find((x) => !x.isMana)!;
    s = act(s, a.action);
    let offeredNames: string[] = [];
    while (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'chooseTargets') {
        offeredNames = s.pending.objects.map((id) => nameOf(s, id));
        s = answer(s, { kind: 'chooseTargets', targets: [obj(s.pending.objects[0]!)] });
      } else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    expect(offeredNames).toEqual(['Test Ogre']);
    s = passBoth(s);
    expect(onField(s, 'Test Drowner')).toBe(false);
    expect(onField(s, 'Test Ogre')).toBe(false);
    expect(zoneNames(s, 'library', 'p1')).toContain('Test Drowner');
    expect(zoneNames(s, 'library', 'p2')).toContain('Test Ogre');
    expect(onField(s, 'Test Bear')).toBe(true);
  });
});

describe('CR 701.13a, 205.3: "exile all creatures and Spacecraft"', () => {
  const QUIET = card('Test Quiet', 'Sorcery', 'Exile all creatures and Spacecraft.');
  const SHIP = card('Test Skiff', 'Artifact — Spacecraft', '');
  const ANVIL = card('Test Anvil', 'Artifact', '');
  it('exiles every creature and every Spacecraft and nothing else', () => {
    expect(manualParts(QUIET)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Quiet'], battlefield: ['Test Bear', 'Test Anvil'] }, p2: { battlefield: ['Test Ogre', 'Test Skiff'] }, defs: [QUIET, BEAR, OGRE, SHIP, ANVIL] });
    s = passBoth(castWith(s, 'Test Quiet', 'p1', () => []));
    expect(s.zones.battlefield.map((id) => nameOf(s, id)).filter((n) => n.startsWith('Test'))).toEqual(['Test Anvil']);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Ogre', 'Test Skiff']);
  });
});

describe('CR 115.1, 400.3: "return target spell or creature to its owner\'s hand"', () => {
  const RECALL = card('Test Recall', 'Instant', "Return target spell or creature to its owner's hand.");
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const ANVIL = card('Test Anvil', 'Artifact', '');
  it('is automated; a spell and a creature are offered, an artifact permanent is not', () => {
    expect(manualParts(RECALL)).toEqual([]);
    const s = scenario([], { p1: { hand: ['Test Recall'], battlefield: ['Test Bear', 'Test Anvil'] }, defs: [RECALL, BEAR, ANVIL] });
    expect(offered(s, 'Test Recall')).toEqual(['Test Bear']);
  });
  it('a spell on the stack is also offered, and is returned to its owner\'s hand without resolving', () => {
    let s = scenario([], { p1: { hand: ['Test Spark'] }, p2: { hand: ['Test Recall'] }, defs: [RECALL, SPARK] });
    s = castWith(s, 'Test Spark', 'p1', () => []);
    s = pass(s);
    expect(offered(s, 'Test Recall', 'p2')).toEqual(['Test Spark']);
    const spark = s.zones.stack[0]!;
    s = castWith(s, 'Test Recall', 'p2', () => [obj(spark)]);
    s = passBoth(s);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Spark');
    expect(s.zones.stack).toHaveLength(0);
  });
});

describe('CR 115.3, 603.2: "put a +1/+1 counter on target creature you control other than that creature"', () => {
  const HERALD = card('Test Herald', 'Creature — Rabbit', 'Whenever a creature you control becomes the target of a spell or ability an opponent controls, put a +1/+1 counter on target creature you control other than that creature.', { pt: ['2', '2'] });
  const POKE = card('Test Poke', 'Instant', '~ deals 1 damage to target creature.');
  it('is automated; the creature that was targeted is not a legal target of the counter, any other creature you control is', () => {
    expect(manualParts(HERALD)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Herald', 'Test Bear', 'Test Ogre'] }, p2: { hand: ['Test Poke'] }, defs: [HERALD, BEAR, OGRE, POKE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const seen: string[][] = [];
    // p2 targets the Ogre with the Poke; the trigger's own target decision (the second one) is recorded
    const s = castWith(pass(s0), 'Test Poke', 'p2', (o) => {
      seen.push(o.map((id) => nameOf(s0, id)).sort());
      return seen.length === 1 ? [obj(ogre)] : [obj(o[0]!)];
    });
    expect(s.pending?.kind).toBe('priority');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(['Test Bear', 'Test Herald']);
  });
});
