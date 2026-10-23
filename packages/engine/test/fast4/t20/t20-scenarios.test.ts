/**
 * T20 (FAST4 wave: tap and stun, untap, phase out and one-shot keyword-action shapes): the cards the T20 templates, renderer, lowering and engine changes
 * automate, played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10). Each test is
 * named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, passBoth, scenario } from '../../m3/scenario';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';
import { capabilitiesOf, missingCapabilities } from '../../../src/model/capabilities';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };

/** Answer the decisions of casting, activating or putting a trigger on the stack: X, targets, then automatic payment. */
function settle(s0: GameState, targets: TargetChoice[], x?: number): GameState {
  let s = s0;
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseNumber' && x !== undefined) s = answer(s, { kind: 'chooseNumber', n: x });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], x?: number): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, x);
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = []): GameState {
  const a = legal(s0, 'p1', 'activate').find((y) => y.object === source && !y.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  return settle(act(s0, a.action), targets);
}
const stun = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['stun'] ?? 0;
const power = (s: GameState, id: ObjectId): number | null => ptNumbers(getChars(s, id)).power;
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);

describe('CR 122.1d: stun counters are a ruled counter the engine runs (counter:stun)', () => {
  it('the capability exists, so "put a stun counter" is no longer a missing rule', () => {
    expect(ENGINE_CAPABILITIES.has('counter:stun')).toBe(true);
  });
});

describe('CR 701.26a, 122.1d: "When ~ enters, tap target creature an opponent controls and put a stun counter on it" ("it" is the creature just tapped)', () => {
  const KRAKEN = card('Test Stun Kraken', 'Creature — Kraken', 'When this creature enters, tap target creature an opponent controls and put a stun counter on it.', '{0}', ['3', '3']);
  it('is automated with one target used twice', () => {
    expect(manualParts(KRAKEN)).toEqual([]);
    const a = KRAKEN.faces[0]!.abilities[0]!;
    expect(JSON.stringify(a)).toContain('{"op":"tap","what":{"ref":"target","id":"t0"}},{"op":"putCounters","on":{"ref":"target","id":"t0"},"kind":"stun","count":1}');
  });
  it('the creature is tapped with a stun counter; its controller\'s next untap step removes the counter instead of untapping it; the one after untaps it', () => {
    let s = scenario([], { p1: { hand: ['Test Stun Kraken'] }, p2: { battlefield: ['Test Hill Bear'] }, defs: [KRAKEN, BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Stun Kraken');
    s = settle(passBoth(s), [obj(bear)]); // the creature resolves, the trigger goes on the stack with its target
    s = passBoth(s);
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(stun(s, bear)).toBe(1);
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[bear]!.tapped).toBe(true); // CR 122.1d: a stun counter was removed instead
    expect(stun(s, bear)).toBe(0);
    expect(s.log.some((l) => l.rules?.includes('CR 122.1d'))).toBe(true);
    s = advanceTo(s, 4, 'upkeep');
    expect(s.objects[bear]!.tapped).toBe(false);
  });
});

describe('CR 122.1d: a stun counter replaces every untap, not only the untap step\'s', () => {
  const WAKE = card('Test Wake Spell', 'Instant', 'Untap target creature.');
  it('"untap target creature" removes one stun counter and leaves it tapped; a second untap untaps it', () => {
    let s = scenario([], { p1: { hand: ['Test Wake Spell', 'Test Wake Spell'], battlefield: [{ name: 'Test Hill Bear', tapped: true, counters: { stun: 1 } }] }, defs: [WAKE, BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Wake Spell', [obj(bear)]));
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(stun(s, bear)).toBe(0);
    s = passBoth(cast(s, 'Test Wake Spell', [obj(bear)]));
    expect(s.objects[bear]!.tapped).toBe(false);
  });
  it('an untapped permanent with a stun counter keeps it (only a tapped permanent can become untapped, CR 701.26b)', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Hill Bear', counters: { stun: 2 } }] }, defs: [BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    s = advanceTo(s, 3, 'upkeep');
    expect(stun(s, bear)).toBe(2);
  });
  it('several stun counters: one is removed per untap (one replacement effect, CR 122.1d)', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Hill Bear', tapped: true, counters: { stun: 2 } }] }, defs: [BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    s = advanceTo(s, 3, 'upkeep');
    expect([s.objects[bear]!.tapped, stun(s, bear)]).toEqual([true, 1]);
    s = advanceTo(s, 5, 'upkeep');
    expect([s.objects[bear]!.tapped, stun(s, bear)]).toEqual([true, 0]);
    s = advanceTo(s, 7, 'upkeep');
    expect(s.objects[bear]!.tapped).toBe(false);
  });
});

describe('CR 122.1d, 608.2c: "Tap up to two target creatures. Put a stun counter on each of them."', () => {
  const CHILL = card('Test Cold Snap', 'Instant', 'Tap up to two target creatures. Put a stun counter on each of them.');
  it('both targets are tapped and get a stun counter; another creature gets none', () => {
    expect(manualParts(CHILL)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Cold Snap'] }, p2: { battlefield: ['Test Hill Bear', 'Test Hill Bear', 'Test Hill Bear'] }, defs: [CHILL, BEAR] });
    const [a, b, c] = findAll(s, 'Test Hill Bear', 'battlefield', 'p2') as [ObjectId, ObjectId, ObjectId];
    s = passBoth(cast(s, 'Test Cold Snap', [obj(a), obj(b)]));
    expect([a, b, c].map((id) => [s.objects[id]!.tapped, stun(s, id)])).toEqual([[true, 1], [true, 1], [false, 0]]);
  });
});

describe('CR 701.26b, 608.2d: "Untap up to two lands" is a choice as it resolves, not targets', () => {
  const SNAP = card('Test Quick Thaw', 'Sorcery', 'Untap up to two lands.');
  it('no target is announced; the controller chooses up to two lands, which untap', () => {
    expect(manualParts(SNAP)).toEqual([]);
    expect(SNAP.faces[0]!.abilities[0]!.kind === 'spell' && (SNAP.faces[0]!.abilities[0] as { effect: { targets: unknown[] } }).effect.targets).toEqual([]);
    let s = scenario(['Plains'], { p1: { hand: ['Test Quick Thaw'], battlefield: [{ name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }] }, defs: [SNAP] });
    const lands = findAll(s, 'Plains', 'battlefield', 'p1') as [ObjectId, ObjectId, ObjectId];
    s = passBoth(cast(s, 'Test Quick Thaw'));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { max: number }).max).toBe(2);
    s = answer(s, { kind: 'chooseObjects', ids: [lands[0], lands[2]] } as DecisionAnswer);
    expect(lands.map((id) => s.objects[id]!.tapped)).toEqual([false, true, false]);
  });
});

describe('CR 702.26b, 502.1: "{1}: ~ phases out."', () => {
  const WYRM = card('Test Mist Wyrm', 'Creature — Dragon', '{1}: This creature phases out.', '{3}', ['4', '4']);
  it('it phases out, is treated as though it does not exist, and phases in during its controller\'s next untap step', () => {
    expect(manualParts(WYRM)).toEqual([]);
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Mist Wyrm', 'Plains'] }, defs: [WYRM] });
    const wyrm = find(s, 'Test Mist Wyrm', 'battlefield', 'p1');
    s = passBoth(activate(s, wyrm));
    expect(s.objects[wyrm]!.phasedOut).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[wyrm]!.phasedOut).toBe(true); // the opponent's untap step does not phase it in
    s = advanceTo(s, 3, 'upkeep');
    expect(s.objects[wyrm]!.phasedOut).toBe(false);
  });
});

describe('CR 701.62a, 701.3a, 301.5: "When ~ enters, manifest dread, then attach ~ to that creature."', () => {
  const TOOLS = card('Test Grim Tools', 'Artifact — Equipment', 'When this Equipment enters, manifest dread, then attach this Equipment to that creature.\nEquipped creature gets +1/+1.\nEquip {2}');
  const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.');
  it('is automated: the attach names the permanent manifest dread put onto the battlefield', () => {
    expect(manualParts(TOOLS)).toEqual([]);
    expect(JSON.stringify(TOOLS)).toContain('"action":"manifestDread","who":{"ref":"you"},"as":"dread"},{"op":"attach","what":{"ref":"self"},"to":{"ref":"bound","name":"dread"}}');
  });
  it('the Equipment is attached to the manifested 2/2, which gets +1/+1; the other card goes to the graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Grim Tools'], library: ['Test Hill Bear', 'Test Hill Bear'] }, defs: [TOOLS, BEAR] });
    s = passBoth(cast(s, 'Test Grim Tools')); // the Equipment resolves; its trigger goes on the stack
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects'); // which of the top two to manifest (CR 701.62a)
    s = answer(s, { kind: 'chooseObjects', ids: [(s.pending as { options: ObjectId[] }).options[0]!] } as DecisionAnswer);
    const tools = find(s, 'Test Grim Tools', 'battlefield', 'p1');
    const host = s.objects[tools]!.attachedTo as ObjectId;
    expect(host).toBeDefined();
    expect(s.objects[host]!.faceDown).toBe(true);
    expect(power(s, host)).toBe(3);
    expect(findAll(s, 'Test Hill Bear', 'graveyard', 'p1').length).toBe(1);
  });
  it('if the Equipment left the battlefield, the creature is still manifested and nothing is attached', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Grim Tools', 'Test Shatter'], library: ['Test Hill Bear', 'Test Hill Bear'] }, defs: [TOOLS, SHATTER, BEAR] });
    s = passBoth(cast(s, 'Test Grim Tools'));
    const tools = find(s, 'Test Grim Tools', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Shatter', [obj(tools)])); // in response to the trigger
    expect(findAll(s, 'Test Grim Tools', 'graveyard', 'p1').length).toBe(1);
    s = passBoth(s);
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [(s.pending as { options: ObjectId[] }).options[0]!] } as DecisionAnswer);
    const faceDown = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown);
    expect(faceDown.length).toBe(1);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.attachedTo !== undefined)).toBe(false);
  });
});

describe('CR 701.57a, 608.2h: "Counter target creature spell. Discover X, where X is that spell\'s mana value."', () => {
  const HURL = card('Test Time Hurl', 'Instant', "Counter target creature spell. Discover X, where X is that spell's mana value.");
  const BEAST = card('Test X Beast', 'Creature — Beast', '', '{X}{W}', ['1', '1']);
  const OGRE = card('Test Mid Ogre', 'Creature — Ogre', '', '{1}{W}{W}', ['3', '3']);
  it('is automated; X reads the countered spell', () => {
    expect(manualParts(HURL)).toEqual([]);
    expect(JSON.stringify(HURL)).toContain('"action":"discover","who":{"ref":"you"},"n":{"q":"stat","stat":"manaValue","of":{"ref":"target","id":"t0"}}');
  });
  it('X is the mana value the spell had on the stack (X included, CR 202.3e), not the card\'s in the graveyard', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test X Beast', 'Test Time Hurl'], library: ['Test Mid Ogre'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [HURL, BEAST, OGRE] });
    s = cast(s, 'Test X Beast', [], 2); // mana value 3 on the stack
    const beast = find(s, 'Test X Beast', 'stack', 'p1');
    s = passBoth(cast(s, 'Test Time Hurl', [obj(beast)]));
    expect(findAll(s, 'Test X Beast', 'graveyard', 'p1').length).toBe(1);
    // the Ogre (mana value 3) is the discovered card: the controller may cast it without paying its mana cost; declined, it goes to the hand
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(findAll(s, 'Test Mid Ogre', 'hand', 'p1').length).toBe(1);
  });
});

describe('CR 701.41a: "support N"', () => {
  const RAPTOR = card('Test Helper Hawk', 'Creature — Bird', 'When this creature enters, support 2.', '{0}', ['2', '2']);
  const RALLY = card('Test Rally Call', 'Sorcery', 'Support 2.');
  it('on a permanent: "up to two OTHER target creatures"; on a sorcery: "up to two target creatures"', () => {
    expect(manualParts(RAPTOR)).toEqual([]);
    expect(manualParts(RALLY)).toEqual([]);
    const specOf = (d: CardDef): unknown => JSON.parse(JSON.stringify(d.faces[0]!.abilities[0])).effect.targets[0];
    expect(specOf(RAPTOR)).toMatchObject({ kind: 'object', min: 0, max: 2, filter: { types: ['Creature'], other: true }, text: 'up to two other target creatures' });
    expect(specOf(RALLY)).toMatchObject({ kind: 'object', min: 0, max: 2, filter: { types: ['Creature'] }, text: 'up to two target creatures' });
    expect((specOf(RALLY) as { filter: Record<string, unknown> }).filter['other']).toBeUndefined();
  });
  it('each target gets a +1/+1 counter; the source itself can\'t be one of them', () => {
    let s = scenario([], { p1: { hand: ['Test Helper Hawk'], battlefield: ['Test Hill Bear', 'Test Hill Bear'] }, defs: [RAPTOR, BEAR] });
    const [a, b] = findAll(s, 'Test Hill Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    s = passBoth(cast(s, 'Test Helper Hawk'));
    const hawk = find(s, 'Test Helper Hawk', 'battlefield', 'p1');
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: [obj(hawk)] })).toThrow();
    s = passBoth(settle(s, [obj(a), obj(b)]));
    expect([a, b, hawk].map((id) => s.objects[id]!.counters['+1/+1'] ?? 0)).toEqual([1, 1, 0]);
  });
});

describe('CR 121.1, 115.1: "You and target opponent each draw two cards."', () => {
  const MEET = card('Test Quiet Meeting', 'Sorcery', 'You and target opponent each draw two cards.');
  it('both players draw two cards', () => {
    expect(manualParts(MEET)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Quiet Meeting'] }, defs: [MEET] });
    s = cast(s, 'Test Quiet Meeting', [p2]);
    const [h1, h2] = [handSize(s, 'p1'), handSize(s, 'p2')];
    s = passBoth(s);
    expect([handSize(s, 'p1'), handSize(s, 'p2')]).toEqual([h1 + 2, h2 + 2]);
  });
});

describe('CR 101.4, 608.2d: "Each player may discard their hand and draw three cards."', () => {
  const WHEEL = card('Test Small Wheel', 'Sorcery', 'Each player may discard their hand and draw three cards.');
  it('each player chooses (APNAP); only a player who chose to discards their hand and draws three', () => {
    expect(manualParts(WHEEL)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Small Wheel', 'Test Hill Bear'] }, p2: { hand: ['Test Hill Bear', 'Test Hill Bear', 'Test Hill Bear', 'Test Hill Bear'] }, defs: [WHEEL, BEAR] });
    s = passBoth(cast(s, 'Test Small Wheel'));
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(handSize(s, 'p1')).toBe(3);
    expect(findAll(s, 'Test Hill Bear', 'graveyard', 'p1').length).toBe(1);
    expect(handSize(s, 'p2')).toBe(4);
    expect(findAll(s, 'Test Hill Bear', 'hand', 'p2').length).toBe(4);
  });
});

describe('CR 502.3: "Untap ~ during each other player\'s untap step."', () => {
  const CHIMES = card('Test Wind Chimes', 'Artifact', "Untap this artifact during each other player's untap step.\n{T}: You gain 1 life.");
  it('is automated (rulemod:untapDuringOtherUntapSteps)', () => {
    expect(manualParts(CHIMES)).toEqual([]);
    expect(JSON.stringify(CHIMES)).toContain('{"s":"rule","rule":"untapDuringOtherUntapSteps"}');
  });
  it('tapped on its controller\'s turn, it untaps during the opponent\'s untap step; an ordinary permanent does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Wind Chimes', { name: 'Test Hill Bear', tapped: true }] }, defs: [CHIMES, BEAR] });
    const chimes = find(s, 'Test Wind Chimes', 'battlefield', 'p1');
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    s = passBoth(activate(s, chimes));
    expect(s.objects[chimes]!.tapped).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[chimes]!.tapped).toBe(false);
    expect(s.objects[bear]!.tapped).toBe(true);
  });
  it('granted by an Aura as a quoted ability, it is the enchanted land that untaps (CR 113.2c: "this land" is the object that has the ability)', () => {
    const GROWTH = card('Test Urban Growth', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "Untap this land during each other player\'s untap step."');
    expect(manualParts(GROWTH)).toEqual([]);
    let s = scenario(['Plains'], { p1: { hand: ['Test Urban Growth'], battlefield: [{ name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }] }, defs: [GROWTH] });
    const [enchanted, other] = findAll(s, 'Plains', 'battlefield', 'p1') as [ObjectId, ObjectId];
    s = passBoth(cast(s, 'Test Urban Growth', [obj(enchanted)]));
    expect(s.objects[find(s, 'Test Urban Growth', 'battlefield', 'p1')]!.attachedTo).toBe(enchanted);
    s = advanceTo(s, 2, 'upkeep');
    expect([s.objects[enchanted]!.tapped, s.objects[other]!.tapped]).toEqual([false, true]);
  });
  it('a stun counter replaces that untap too (CR 122.1d)', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Wind Chimes', tapped: true, counters: { stun: 1 } }] }, defs: [CHIMES] });
    const chimes = find(s, 'Test Wind Chimes', 'battlefield', 'p1');
    s = advanceTo(s, 2, 'upkeep');
    expect([s.objects[chimes]!.tapped, stun(s, chimes)]).toEqual([true, 0]);
    s = advanceTo(s, 3, 'upkeep');
    expect(s.objects[chimes]!.tapped).toBe(false);
  });
  it('the rule names the source; with `of` (r4-static: the permanents of a description, statics/hooks.ts) it runs too; a player or a value needs a capability nothing registers (fail closed)', () => {
    const d = card('Test Wind Chimes', 'Artifact', "Untap this artifact during each other player's untap step.");
    const a = JSON.parse(JSON.stringify(d.faces[0]!.abilities[0])) as AbilityDef & { effects: Record<string, unknown>[] };
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
    a.effects[0]!['of'] = { types: ['Creature'], controller: 'you' };
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
    a.effects[0]!['player'] = { ref: 'you' };
    expect(capabilitiesOf(a)).toContain('feature:rulemod.untapDuringOtherUntapSteps.of');
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toContain('feature:rulemod.untapDuringOtherUntapSteps.of');
  });
});
