/**
 * FAST5X E23: mana spending restrictions as general filters (CR 106.6), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). The payment code is the single place a restriction is read (rules/sources.ts#spendAllows): the listing of legal actions, the
 * automatic payment and the pay-by-hand decision all go through it.
 *
 *   CR 106.6           "Spend this mana only to ..." allows the listed payments only; "This mana can't be spent to cast ..." allows every payment but those
 *   CR 601.2a, 601.2g-h the spell being cast is on the stack while its cost is paid: its characteristics, the zone it was cast from and X are read there
 *   CR 202.3e, 107.3   on the stack, X is the announced value; "spells with {X} in their mana costs"
 *   CR 602.2b, 702.6a  the cost of an activated ability; an equip ability is the ability the keyword equip makes
 *   CR 116.2b, 702.37e turning a face-down permanent face up is a special action: neither a spell nor an ability
 *   CR 116.2k          plotting is a special action too
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ManaRestriction, type OracleCard } from '../../../src/index';
import { spendAllows } from '../../../src/rules/sources';
import { act, answer, castAuto, find, labels, legal, reject, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { castCard, drive } from '../../m5/announce/support';
import { putFaceDown, turnUp, turnUpActions } from '../../m6/face-down/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const restrictionOf = (d: CardDef, i = 0): ManaRestriction => {
  const steps = (d.faces[0]!.abilities[i] as unknown as { effect: { steps: { restriction?: ManaRestriction }[] } }).effect.steps;
  return steps.find((x) => x.restriction)!.restriction!;
};
const noManual = (d: CardDef): boolean => d.faces[0]!.abilities.every((a) => a.kind !== 'manual');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const TRINKET = card('Test Trinket', 'Artifact', '', undefined, '{2}');
const IDOL = card('Test Idol', 'Enchantment', '{1}, {T}: You gain 1 life.', undefined, '{1}');

describe('the restrictions compile into the model (parser/templates/zz-fast5x/e23.json)', () => {
  it('"can\'t be spent to cast", equip, face up, {X} and cast zones are data on the addMana step, never manual', () => {
    const cases: [string, ManaRestriction][] = [
      ["{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.", { notSpells: { notTypes: ['Artifact'] } }],
      ["{T}: Add {C}. This mana can't be spent to cast spells from your hand.", { notSpells: { castFrom: 'hand', owner: 'you' } }],
      ['{T}: Add {C}. Spend this mana only to cast an Equipment spell or activate an equip ability.', { spells: { subtypes: ['Equipment'] }, abilities: {}, abilityKeyword: 'equip' }],
      ['{T}: Add {C}. Spend this mana only to turn permanents face up.', { turnFaceUp: {} }],
      ['{T}: Add {C}. Spend this mana only to cast face-down spells or to turn creatures face up.', { spells: { faceDown: true }, turnFaceUp: { types: ['Creature'] } }],
      ['{T}: Add {C}. Spend this mana only to cast spells with mana value 5 or greater or spells with {X} in their mana costs.', { spells: { anyOf: [{ manaValue: { op: '>=', value: 5 } }, { manaCostHasX: true }] } }],
      ['{T}: Add {C}. Spend this mana only to cast spells from exile.', { spells: { castFrom: 'exile' } }],
      ['{T}: Add {C}. Spend this mana only to cast an artifact spell or activate an ability.', { spells: { types: ['Artifact'] }, abilities: {} }],
      ['{T}: Add {C}. Spend this mana only to cast a Goblin spell or activate an ability of a Goblin source.', { spells: { subtypes: ['Goblin'] }, abilities: { subtypes: ['Goblin'] } }],
      ['{T}: Add {C}. Spend this mana only to cast an artifact spell, unlock a door, or turn a permanent face up.', { spells: { types: ['Artifact'] }, unlock: true, turnFaceUp: {} }],
    ];
    for (const [text, r] of cases) {
      const d = card('Test Spring', 'Land', text);
      expect(noManual(d), text).toBe(true);
      expect(restrictionOf(d), text).toEqual(r);
    }
  });
});

describe('CR 106.6: "This mana can\'t be spent to cast a nonartifact spell"', () => {
  const VAULT = card('Test Vault', 'Land', "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.");
  const board = (extra: string[] = []): GameState =>
    scenario([], { p1: { hand: ['Test Bear', 'Test Trinket'], battlefield: ['Test Vault', 'Test Vault', ...extra] }, defs: [VAULT, BEAR, TRINKET, IDOL] });

  it('pays for an artifact spell, not for a nonartifact one (not listed, a cast is refused)', () => {
    const s = board();
    expect(labels(s, 'p1')).toContain('Cast Test Trinket');
    expect(labels(s, 'p1')).not.toContain('Cast Test Bear');
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand') }).message).toContain("can't pay");
    const t = drive(castCard(s, 'Test Trinket'), []);
    expect(t.zones.stack).toHaveLength(1);
    expect(t.objects[t.zones.stack[0]!]!.stack!.costsPaid.manaSpent!.every((u) => u.restriction?.notSpells !== undefined)).toBe(true);
  });

  it('pays for an activated ability (CR 602.2b): it is not a spell', () => {
    const s = board(['Test Idol']);
    const idol = find(s, 'Test Idol', 'battlefield');
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.object)).toEqual([idol]);
  });

  it('pays any cost an effect asks for, a special action and an ability; only a spell matching the filter is refused (rules/sources.ts#spendAllows)', () => {
    const s = board();
    const r: ManaRestriction = { notSpells: { notTypes: ['Artifact'] } };
    const bear = find(s, 'Test Bear', 'hand');
    expect(spendAllows(s, 'p1', undefined)(r, undefined)).toBe(true); // "unless pays", ward (CR 118.12)
    expect(spendAllows(s, 'p1', { kind: 'special', id: bear })(r, undefined)).toBe(true); // plotting (CR 116.2k)
    expect(spendAllows(s, 'p1', { kind: 'ability', id: bear })(r, undefined)).toBe(true);
    expect(spendAllows(s, 'p1', { kind: 'spell', id: bear })(r, undefined)).toBe(false);
    expect(spendAllows(s, 'p1', { kind: 'spell', id: find(s, 'Test Trinket', 'hand') })(r, undefined)).toBe(true);
  });

  it('floating in the pool, the mana keeps its restriction (CR 106.6): it still can\'t pay for the Bear', () => {
    const s = tweak(scenario([], { p1: { hand: ['Test Bear', 'Test Trinket'] }, defs: [BEAR, TRINKET] }), (x) => {
      x.players[0]!.manaPool.push({ type: 'C', restriction: { notSpells: { notTypes: ['Artifact'] } } }, { type: 'C', restriction: { notSpells: { notTypes: ['Artifact'] } } });
    });
    expect(labels(s, 'p1')).toContain('Cast Test Trinket');
    expect(labels(s, 'p1')).not.toContain('Cast Test Bear');
  });
});

describe('CR 106.6, 702.6a: "Spend this mana only to cast an Equipment spell or activate an equip ability"', () => {
  const FORGE = card('Test Forge', 'Land', '{T}: Add {C}. Spend this mana only to cast an Equipment spell or activate an equip ability.');
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\n{1}, {T}: You gain 1 life.\nEquip {1}', undefined, '{1}');

  it('pays the equip ability of an Equipment, not its other ability, and not a creature spell', () => {
    expect(noManual(FORGE)).toBe(true);
    const s = scenario([], { p1: { hand: ['Test Bear', 'Test Blade'], battlefield: ['Test Forge', 'Test Blade', 'Test Bear'] }, defs: [FORGE, BLADE, BEAR] });
    const blade = find(s, 'Test Blade', 'battlefield');
    const acts = legal(s, 'p1', 'activate').filter((a) => !a.isMana && a.object === blade);
    expect(acts).toHaveLength(1);
    expect(acts[0]!.label.toLowerCase()).toContain('equip');
    expect(labels(s, 'p1')).toContain('Cast Test Blade');
    expect(labels(s, 'p1')).not.toContain('Cast Test Bear');
  });
});

describe('CR 106.6, 116.2b: turning a permanent face up is a special action', () => {
  const GROVE = card('Test Grove', 'Land', '{T}: Add {C}{C}. Spend this mana only to turn permanents face up.');
  const WORKS = card('Test Works', 'Land', '{T}: Add {C}{C}. Spend this mana only to activate abilities.');
  const HIDDEN = card('Test Hidden Bear', 'Creature — Bear', 'Morph {2}', ['3', '3'], '{3}');

  it('mana for turning face up pays the morph cost (CR 702.37e); the permanent is face up', () => {
    const [s, id] = putFaceDown(scenario([], { p1: { battlefield: ['Test Grove'] }, defs: [GROVE, HIDDEN] }), 'p1', 'Test Hidden Bear');
    expect(turnUpActions(s).map((a) => a.object)).toEqual([id]);
    const t = turnUp(s, id);
    expect(t.objects[id]!.faceDown).toBe(false);
  });

  it('mana restricted to activating abilities does not (the special action is not an ability, CR 116.2b)', () => {
    const [s, id] = putFaceDown(scenario([], { p1: { battlefield: ['Test Works'] }, defs: [WORKS, HIDDEN] }), 'p1', 'Test Hidden Bear');
    expect(turnUpActions(s).map((a) => a.object)).not.toContain(id);
  });

  it('mana for turning face up pays for no spell and no ability', () => {
    const s = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Grove', 'Test Idol'] }, defs: [GROVE, BEAR, IDOL] });
    expect(labels(s, 'p1')).not.toContain('Cast Test Bear');
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana)).toEqual([]);
  });
});

describe('CR 106.6, 202.3e, 107.3: mana value and {X} on the stack', () => {
  const TOWER = card('Test Tower', 'Land', '{T}: Add {R}. Spend this mana only to cast spells with mana value 4 or greater.');
  const SPIRE = card('Test Spire', 'Land', '{T}: Add {R}. Spend this mana only to cast spells with mana value 5 or greater or spells with {X} in their mana costs.');
  const BLAST = card('Test Blast', 'Sorcery', '~ deals X damage to target player.', undefined, '{X}{R}');
  const SHOCK = card('Test Jolt', 'Sorcery', '~ deals 2 damage to target player.', undefined, '{1}{R}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['5', '5'], '{4}{R}');

  it('"spells with {X} in their mana costs" pays any X spell; "mana value 5 or greater" a 5-drop; neither a 2-drop', () => {
    const s = scenario([], { p1: { hand: ['Test Blast', 'Test Jolt', 'Test Ogre'], battlefield: Array(5).fill('Test Spire') as string[] }, defs: [SPIRE, BLAST, SHOCK, OGRE] });
    expect(labels(s, 'p1')).toContain('Cast Test Blast');
    expect(labels(s, 'p1')).toContain('Cast Test Ogre');
    expect(labels(s, 'p1')).not.toContain('Cast Test Jolt');
  });

  it('with X announced, the spell\'s mana value counts it (CR 202.3e): only X = 3 or more makes {X}{R} a spell of mana value 4', () => {
    const s = scenario([], { p1: { hand: ['Test Blast'], battlefield: Array(4).fill('Test Tower') as string[] }, defs: [TOWER, BLAST] });
    expect(labels(s, 'p1')).toContain('Cast Test Blast');
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blast', 'hand') });
    // the only payable X is 3 (X = 0, 1 or 2 makes a spell of mana value 1-3, which this mana can't pay for)
    for (let g = 0; t.pending && t.pending.kind !== 'priority' && g < 6; g++) {
      const p = t.pending as unknown as { kind: string; min?: number; max?: number; options?: { id: string }[] };
      if (p.kind === 'chooseNumber') { expect([p.min, p.max]).toEqual([3, 3]); t = answer(t, { kind: 'chooseNumber', n: 3 }); }
      else if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else t = answer(t, { kind: 'payCost', auto: true });
    }
    expect(t.zones.stack).toHaveLength(1);
    expect(t.objects[t.zones.stack[0]!]!.stack!.x).toBe(3);
  });
});

describe('CR 106.6, 601.2a: the zone a spell is cast from and face-down spells', () => {
  it('"spells from exile" reads the zone the spell was cast from (stack.castFrom), not where it is now', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'] }, defs: [BEAR] });
    const r: ManaRestriction = { spells: { castFrom: 'exile' } };
    const bear = find(s0, 'Test Bear', 'hand');
    const onStack = (from: 'exile' | 'hand') => tweak(s0, (x) => {
      const o = x.objects[bear]!;
      x.zones.hand.p1 = x.zones.hand.p1!.filter((i) => i !== bear);
      x.zones.stack.push(bear);
      Object.assign(o, { zone: 'stack', controller: 'p1', stack: { kind: 'spell', face: 0, targets: [], costsPaid: {}, castFrom: from, caster: 'p1' } });
    });
    expect(spendAllows(onStack('exile'), 'p1', { kind: 'spell', id: bear })(r, undefined)).toBe(true);
    expect(spendAllows(onStack('hand'), 'p1', { kind: 'spell', id: bear })(r, undefined)).toBe(false);
    const notHand: ManaRestriction = { notSpells: { castFrom: 'hand', owner: 'you' } };
    expect(spendAllows(onStack('hand'), 'p1', { kind: 'spell', id: bear })(notHand, undefined)).toBe(false);
    expect(spendAllows(onStack('exile'), 'p1', { kind: 'spell', id: bear })(notHand, undefined)).toBe(true);
  });

  it('"cast face-down spells": a morph cast face down (CR 702.37c) is paid with it, the same card cast face up is not', () => {
    const GOSSIP = card('Test Whisper Lane', 'Land', '{T}: Add {C}{C}. Spend this mana only to cast face-down spells or to turn creatures face up.');
    const HIDDEN = card('Test Hidden Bear', 'Creature — Bear', 'Morph {2}', ['3', '3'], '{3}');
    const s = scenario([], { p1: { hand: ['Test Hidden Bear'], battlefield: ['Test Whisper Lane', 'Test Whisper Lane'] }, defs: [GOSSIP, HIDDEN] });
    const casts = legal(s, 'p1', 'cast').map((a) => a.action as { method?: string });
    expect(casts.some((a) => a.method === 'morph')).toBe(true);
    expect(casts.some((a) => a.method === undefined)).toBe(false);
  });
});

describe('CR 106.6, 601.2a, 709.3, 715.3: the spell has only the characteristics of the face being cast (review E23)', () => {
  const twoFaced = (name: string, layout: 'adventure' | 'split', faces: [string, string, string?][]): CardDef =>
    compileCard({
      name, layout, type_line: faces.map((f) => f[1]).join(' // '),
      card_faces: faces.map(([n, type, pt]) => ({ name: n, type_line: type, mana_cost: '{1}{R}', oracle_text: /Creature/.test(type) ? '' : 'You gain 2 life.', ...(pt ? { power: pt, toughness: pt } : {}) })),
    } as OracleCard);
  const ADVENTURE = twoFaced('Test Giant // Test Stomp', 'adventure', [['Test Giant', 'Creature — Giant', '2'], ['Test Stomp', 'Instant — Adventure']]);
  const OMEN = twoFaced('Test Wurm // Test Portent', 'adventure', [['Test Wurm', 'Creature — Wurm', '2'], ['Test Portent', 'Sorcery — Omen']]);
  const SPLIT = twoFaced('Test Quick // Test Slow', 'split', [['Test Quick', 'Instant'], ['Test Slow', 'Sorcery']]);
  const TABLET = card('Test Tablet', 'Artifact', '{T}: Add {R}{R}. Spend this mana only to cast instant and sorcery spells.');
  const ALTAR = card('Test Altar', 'Artifact', '{T}: Add {R}{R}. Spend this mana only to cast creature spells.');
  const SHRINE = card('Test Shrine', 'Artifact', '{T}: Add {R}{R}. Spend this mana only to cast a Dragon spell or an Omen spell.');
  const SPARK = card('Test Spark', 'Artifact', '{T}: Add {R}{R}. Spend this mana only to cast instant spells.');
  const defs = [ADVENTURE, OMEN, SPLIT, TABLET, ALTAR, SHRINE, SPARK];
  const board = (source: string, hand: string): GameState => scenario([], { p1: { hand: [hand], battlefield: [source] }, defs });

  it('instant/sorcery mana pays for the Adventure (instant) half, not the creature half; the cast succeeds', () => {
    const s = board('Test Tablet', 'Test Giant // Test Stomp');
    expect(labels(s, 'p1')).toContain('Cast Test Stomp');
    expect(labels(s, 'p1')).not.toContain('Cast Test Giant');
    const t = castAuto(s, 'Test Giant // Test Stomp', { face: 1 });
    expect(t.zones.stack).toHaveLength(1);
  });

  it('creature mana pays for the creature half, not the Adventure half (listing and cast agree)', () => {
    const s = board('Test Altar', 'Test Giant // Test Stomp');
    expect(labels(s, 'p1')).toContain('Cast Test Giant');
    expect(labels(s, 'p1')).not.toContain('Cast Test Stomp');
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Giant // Test Stomp', 'hand'), face: 1 }).message).toContain("can't pay");
  });

  it('"a Dragon spell or an Omen spell" pays for the Omen half of a card whose creature half is not a Dragon, not for that creature half', () => {
    const s = board('Test Shrine', 'Test Wurm // Test Portent');
    expect(labels(s, 'p1')).toContain('Cast Test Portent');
    expect(labels(s, 'p1')).not.toContain('Cast Test Wurm');
    expect(castAuto(s, 'Test Wurm // Test Portent', { face: 1 }).zones.stack).toHaveLength(1);
  });

  it('a split card is one half on the stack (CR 709.3): instant mana pays for the instant half, not the sorcery half', () => {
    const s = board('Test Spark', 'Test Quick // Test Slow');
    expect(labels(s, 'p1')).toContain('Cast Test Quick');
    expect(labels(s, 'p1')).not.toContain('Cast Test Slow');
  });
});
