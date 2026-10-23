/**
 * std-typechange-1 (lane std-typechange: type and ability changes): the round's readings played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c           "tap enchanted creature and remove all counters from it": "it" is the creature the instruction before it (joined by "and") tapped, not
 *                       the Aura that is the trigger's subject (parser/lower/anaphora.ts#focusWithin)
 *   CR 205.1b, 613.1d,  "loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types": the creature keeps
 *   613.1f, 613.4b      its types and subtypes, adds Artifact and Toy, has no abilities and is 0/2 before other changes
 *   CR 708.7, 708.2     "As long as enchanted creature is face down, it can't be turned face up": neither the special action nor an effect turns it face up; a
 *                       face-down creature the Aura doesn't enchant still can
 *   CR 201.2, 205.3m,   "loses all abilities and is a Citizen with base power and toughness 1/1 and "{T}: Add {C}" named <name>": its creature types are only
 *   613.1d, 613.1f      Citizen, its name is the new one, and the granted mana ability is its only ability
 *   CR 611.3a, 613.1d,  "Creatures you control are the chosen type in addition to their other types. The same is true for creature spells you control and creature
 *   108.3, 109.4        cards you own that aren't on the battlefield.": creature cards in your hand and graveyard have the type, an opponent's do not, nor does a
 *                       noncreature card
 *   CR 702.49c, 508.4,  ninjutsu: the card enters tapped and attacking what the returned creature attacked (a planeswalker too); when that is gone, it enters
 *   508.4a              tapped and is not attacking
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, runCombat, scenario } from '../../m5/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { putFaceDown, turnUpActions } from '../../m6/face-down/support';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs automatically, targets, then the queued answers, yes to a may) until a player has priority again. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((i) => i.id) });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** p1 casts the named card from hand (with its targets) and everything on the stack resolves. */
function castWith(s0: GameState, name: string, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), [], targets);
  for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), answers, targets);
  return s;
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

const MARE = card('Test Sky Mare', 'Creature — Horse Spirit', 'Flying', { pt: ['3', '3'] });

describe('CR 608.2c: "When this Aura enters, tap enchanted creature and remove all counters from it." (the creature, never the Aura)', () => {
  const BIND = card('Test Binding Hush', 'Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, tap enchanted creature and remove all counters from it.');
  it('is automated, and the pronoun names the enchanted creature', () => {
    expect(full(BIND)).toBe(true);
    const json = JSON.stringify(BIND.faces[0]!.abilities);
    expect(json).toContain('{"op":"removeCounters","from":{"ref":"attachedTo"},"kind":"any","count":"all"}');
    expect(json).not.toContain('"from":{"ref":"self"}');
  });
  it('the enchanted creature is tapped and loses every counter; another creature keeps its counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Binding Hush'] }, p2: { battlefield: ['Test Sky Mare', 'Test Sky Mare'] }, defs: [BIND, MARE] });
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Sky Mare');
    s0.objects[a!]!.counters = { '+1/+1': 2, stun: 1 };
    s0.objects[b!]!.counters = { '+1/+1': 1 };
    const s = castWith(s0, 'Test Binding Hush', [], [a!]);
    expect(s.objects[find(s, 'Test Binding Hush', 'battlefield', 'p1')]!.attachedTo).toBe(a);
    expect(s.objects[a!]!.tapped).toBe(true);
    expect(Object.values(s.objects[a!]!.counters).reduce((n, x) => n + x, 0)).toBe(0);
    expect(s.objects[b!]!.counters['+1/+1']).toBe(1);
    expect(s.objects[b!]!.tapped).toBe(false);
  });
});

describe('CR 205.1b, 613.1d, 613.1f, 613.4b; CR 708.7: a Toy artifact creature in addition to its other types, and "can\'t be turned face up" while face down', () => {
  const HUSH = card('Test Silent Doll', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types.\nAs long as enchanted creature is face down, it can\'t be turned face up.');
  it('is automated', () => expect(full(HUSH)).toBe(true));
  it('the enchanted creature keeps its types and subtypes, adds Artifact and Toy, has no abilities and is 0/2', () => {
    const s0 = scenario([], { p1: { hand: ['Test Silent Doll'] }, p2: { battlefield: ['Test Sky Mare'] }, defs: [HUSH, MARE] });
    const mare = find(s0, 'Test Sky Mare', 'battlefield', 'p2');
    const s = castWith(s0, 'Test Silent Doll', [], [mare]);
    const c = getChars(s, mare)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect([...c.subtypes].sort()).toEqual(['Horse', 'Spirit', 'Toy']);
    expect(hasKeyword(getChars(s, mare)!, 'flying')).toBe(false);
    expect(pt(s, mare)).toBe('0/2');
  });
  it('a face-down creature it enchants can\'t be turned face up by the special action; another face-down creature still can', () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { hand: ['Test Silent Doll'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [HUSH] });
    let enchanted: ObjectId;
    let other: ObjectId;
    [s, enchanted] = putFaceDown(s, 'p1', 'Exalted Angel');
    [s, other] = putFaceDown(s, 'p1', 'Exalted Angel');
    expect(turnUpActions(s, 'p1').map((a) => a.object).sort()).toEqual([enchanted, other].sort());
    s = castWith(s, 'Test Silent Doll', [], [enchanted]);
    expect(s.objects[enchanted]!.faceDown).toBe(true);
    expect(turnUpActions(s, 'p1').map((a) => a.object)).toEqual([other]);
  });
});

describe('CR 201.2, 205.3m, 613.1d, 613.1f, 613.4b: "is a Citizen with base power and toughness 1/1 and "{T}: Add {C}" named <name>"', () => {
  const LABOR = card('Test Plain Labor', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a Citizen with base power and toughness 1/1 and "{T}: Add {C}" named Dull Clerk.');
  it('is automated', () => expect(full(LABOR)).toBe(true));
  it('the enchanted creature is named Dull Clerk, is a Citizen only (its other creature types are gone), 1/1, and its one ability makes {C}', () => {
    const s0 = scenario([], { p1: { hand: ['Test Plain Labor'] }, p2: { battlefield: ['Test Sky Mare'] }, defs: [LABOR, MARE] });
    const mare = find(s0, 'Test Sky Mare', 'battlefield', 'p2');
    const s = castWith(s0, 'Test Plain Labor', [], [mare]);
    const c = getChars(s, mare)!;
    expect(c.names).toEqual(['Dull Clerk']);
    expect(c.types).toEqual(['Creature']);
    expect(c.subtypes).toEqual(['Citizen']);
    expect(pt(s, mare)).toBe('1/1');
    expect(hasKeyword(getChars(s, mare)!, 'flying')).toBe(false);
    expect(c.abilities.length).toBe(1);
    expect(JSON.stringify(c.abilities[0])).toContain('"op":"addMana"');
  });
});

describe('CR 611.3a, 613.1d, 108.3, 109.4: "... The same is true for creature spells you control and creature cards you own that aren\'t on the battlefield."', () => {
  const BLOOM = card('Test Shifting Bloom', 'Enchantment', 'As this enchantment enters, choose a creature type.\nCreatures you control are the chosen type in addition to their other types. The same is true for creature spells you control and creature cards you own that aren\'t on the battlefield.');
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.');
  it('is automated', () => expect(full(BLOOM)).toBe(true));
  it('your creatures, the creature cards in your hand and graveyard have the chosen type; an opponent\'s creature cards and your noncreature cards do not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shifting Bloom', 'Test Elf', 'Test Spark'], battlefield: ['Test Elf'], graveyard: ['Test Elf'] }, p2: { hand: ['Test Elf'], battlefield: ['Test Elf'] }, defs: [BLOOM, ELF, BOLT] });
    const s = castWith(s0, 'Test Shifting Bloom', [{ kind: 'chooseName', name: 'Goblin' }]);
    const sub = (id: ObjectId): string[] => [...getChars(s, id)!.subtypes].sort();
    expect(sub(find(s, 'Test Elf', 'battlefield', 'p1'))).toEqual(['Elf', 'Goblin']);
    expect(sub(find(s, 'Test Elf', 'hand', 'p1'))).toEqual(['Elf', 'Goblin']);
    expect(sub(find(s, 'Test Elf', 'graveyard', 'p1'))).toEqual(['Elf', 'Goblin']);
    expect(sub(find(s, 'Test Elf', 'hand', 'p2'))).toEqual(['Elf']);
    expect(sub(find(s, 'Test Elf', 'battlefield', 'p2'))).toEqual(['Elf']);
    expect(sub(find(s, 'Test Spark', 'hand', 'p1'))).toEqual([]);
  });
  it('a creature spell you control on the stack has the chosen type', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shifting Bloom', 'Test Elf'] }, defs: [BLOOM, ELF, BOLT] });
    let s = castWith(s0, 'Test Shifting Bloom', [{ kind: 'chooseName', name: 'Goblin' }]);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Elf', 'hand', 'p1') }));
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    expect([...getChars(s, spell)!.subtypes].sort()).toEqual(['Elf', 'Goblin']);
  });
});

describe('CR 702.49c, 508.4, 508.4a: ninjutsu attacks what the returned creature attacked', () => {
  const NINJA = card('Test Shade Runner', 'Creature — Human Ninja', 'Ninjutsu {0}', { pt: ['2', '2'], cost: '{3}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  /** p1 attacks with the bear (at `defender`), then activates ninjutsu returning it; the ability resolves. */
  const ninjutsu = (s0: GameState, bear: ObjectId, defender?: ObjectId): GameState => {
    let s = runCombat(s0, { attack: [defender !== undefined ? [bear, defender] : [bear]], until: 'declareBlockers' } as never);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Shade Runner', 'hand', 'p1'));
    expect(a).toBeDefined();
    s = act(s, a!.action);
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [bear] });
      else throw new Error(`unexpected ${s.pending.kind}`);
    }
    return pass(pass(s));
  };
  it('the keyword is automated', () => expect(full(NINJA)).toBe(true));
  it('the bear attacked a planeswalker: the ninja enters tapped and attacking that planeswalker, unblocked', () => {
    const s0 = scenario(['Garruk Wildspeaker'], { p1: { hand: ['Test Shade Runner'], battlefield: ['Test Bear'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] }, defs: [NINJA, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const garruk = find(s0, 'Garruk Wildspeaker', 'battlefield', 'p2');
    const s = ninjutsu(s0, bear, garruk);
    const ninja = find(s, 'Test Shade Runner', 'battlefield', 'p1');
    expect(s.objects[ninja]!.tapped).toBe(true);
    expect(s.combat?.attackers.find((x) => x.id === ninja)).toMatchObject({ defender: garruk, defendingPlayer: 'p2', blocked: false });
  });
  it('CR 508.4a: the planeswalker the bear attacked left before ninjutsu resolved: the ninja enters tapped and is not attacking', () => {
    const s0 = scenario(['Garruk Wildspeaker'], { p1: { hand: ['Test Shade Runner'], battlefield: ['Test Bear'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] }, defs: [NINJA, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const garruk = find(s0, 'Garruk Wildspeaker', 'battlefield', 'p2');
    let s = runCombat(s0, { attack: [[bear, garruk]], until: 'declareBlockers' } as never);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Shade Runner', 'hand', 'p1'));
    s = act(s, a!.action);
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [bear] });
    }
    // the planeswalker leaves while the ability is on the stack
    s.zones.battlefield = s.zones.battlefield.filter((id) => id !== garruk);
    s.objects[garruk]!.zone = 'graveyard';
    s.zones.graveyard['p2'] = [...(s.zones.graveyard['p2'] ?? []), garruk];
    s = pass(pass(s));
    const ninja = find(s, 'Test Shade Runner', 'battlefield', 'p1');
    expect(s.objects[ninja]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((x) => x.id === ninja)).toBe(false);
  });
});
