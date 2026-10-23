/**
 * WP24: stub cards (contract C4), unsanctioned cards (design 12.3) and predefined token definitions
 * (CR 111.10).
 */
import { describe, expect, it } from 'vitest';
import { markUnsanctioned, STUB_ID_PREFIX, stubCardDef, tokenDefFor, UNSANCTIONED_REASON } from '../../../src/cards/pool';
import { tokenCardDef } from '../../../src/effects/handlers/token-defs';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { compiledDef } from '../../fixtures';
import { act, answer, declareAttackers, find, passUntil, scenario, toDeclareAttackers } from '../helpers';

const STUB = stubCardDef('Glimmerwing Of The New Set', 'decklist');

/** A spell the engine cannot read: its resolution is a manualResolve decision (CR 608.2, design 10.1), the way a player moves a stub by hand. */
const HAND_SPELL = compileCard({ name: 'Odd Ritual', layout: 'normal', mana_cost: '{0}', type_line: 'Instant', oracle_text: 'Zorble a card you own in an unusual way.', colors: [] } as OracleCard);

function castAndResolveByHand(s: GameState, ops: unknown[]): GameState {
  const spell = find(s, 'Odd Ritual', 'hand', 'p1');
  s = act(s, { type: 'cast', player: 'p1', card: spell });
  while (s.pending?.kind !== 'manualResolve') {
    if (s.pending?.kind !== 'priority') throw new Error(`unexpected ${s.pending?.kind}`);
    s = act(s, { type: 'pass', player: s.pending.player });
  }
  return answer(s, { kind: 'manualResolve', ops } as never);
}

describe('WP24 stubCardDef (contract C4)', () => {
  it('one face, no cost, no types, no text, manual, flagged with its origin', () => {
    expect(STUB.id).toBe(`${STUB_ID_PREFIX}Glimmerwing Of The New Set`);
    expect(STUB.name).toBe('Glimmerwing Of The New Set');
    expect(STUB.faces).toHaveLength(1);
    expect(STUB.faces[0]).toMatchObject({ manaCost: null, types: [], subtypes: [], supertypes: [], oracleText: '', abilities: [] });
    expect(STUB.automation.level).toBe('manual');
    expect(STUB.stub).toEqual({ origin: 'decklist' });
    expect(STUB.isToken).toBe(false);
  });

  it('is total: odd input never throws (an empty name becomes "Unknown card"; whitespace is collapsed)', () => {
    expect(stubCardDef('', 'manual').name).toBe('Unknown card');
    expect(stubCardDef('  Two   Spaces ', 'image').name).toBe('Two Spaces');
    expect(stubCardDef(undefined as unknown as string, 'image').name).toBe('Unknown card');
  });

  it('is deterministic and plain JSON (a game state stays serializable)', () => {
    expect(stubCardDef('X', 'image')).toEqual(stubCardDef('X', 'image'));
    expect(JSON.parse(JSON.stringify(STUB))).toEqual(STUB);
  });
});

describe('WP24 a stub is playable (contract C2/C4): drawn, offered no illegal action, moved by hand to any zone', () => {
  const start = (): GameState => scenario(['Plains'], { defs: [STUB, HAND_SPELL], p1: { library: [STUB.id], hand: ['Odd Ritual', 'Odd Ritual'] } });

  it('CR 118.6: a stub in hand can be neither cast nor played (no mana cost, no types); the game goes on', () => {
    const s = scenario(['Plains'], { defs: [STUB, HAND_SPELL], p1: { hand: [STUB.id] } });
    const stub = find(s, STUB.name, 'hand', 'p1');
    const offered = legalActions(s, 'p1');
    expect(JSON.stringify(offered)).not.toContain(`"${stub}"`);
    expect(() => act(s, { type: 'cast', player: 'p1', card: stub })).toThrow();
    expect(() => act(s, { type: 'playLand', player: 'p1', card: stub })).toThrow();
  });

  it('CR 121.1: drawn like any card; CR 608.2: put onto the battlefield and into the graveyard by manual moves', () => {
    let s = start();
    // The stub sits on top of the library: a manual "draw" puts it into the hand.
    s = castAndResolveByHand(s, [{ op: 'draw', player: 'p1', count: 1 }]);
    const inHand = find(s, STUB.name, 'hand', 'p1');
    s = castAndResolveByHand(s, [{ op: 'move', object: inHand, to: 'battlefield' }]);
    const onField = find(s, STUB.name, 'battlefield', 'p1');
    expect(s.objects[onField]!.defId).toBe(STUB.id);
    // CR 704: no state-based action applies to a permanent with no types; it stays until a player moves it.
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(() => find(s, STUB.name, 'battlefield', 'p1')).not.toThrow();
  });

  it('moved to the graveyard by hand', () => {
    let s = start();
    s = castAndResolveByHand(s, [{ op: 'draw', player: 'p1', count: 1 }]);
    const inHand = find(s, STUB.name, 'hand', 'p1');
    s = castAndResolveByHand(s, [{ op: 'move', object: inHand, to: 'graveyard' }]);
    expect(() => find(s, STUB.name, 'graveyard', 'p1')).not.toThrow();
  });
});

describe('WP24 markUnsanctioned (design 12.3): manual-only, whatever the compiler understood', () => {
  it('every ability becomes manual; an activated ability keeps its cost (CR 602.2b) and its mana flag (CR 605.3b)', () => {
    const elves = compiledDef('Llanowar Elves');
    expect(elves.faces[0]!.abilities.some((a) => a.kind !== 'manual')).toBe(true);
    const def = markUnsanctioned(elves);
    expect(def.unsanctioned).toBe(true);
    expect(def.automation.level).toBe('manual');
    expect(def.automation.autoRatio).toBe(0);
    const [ability] = def.faces[0]!.abilities;
    expect(ability).toMatchObject({ kind: 'manual', reason: UNSANCTIONED_REASON, shape: 'activated', mana: true });
    expect((ability as { cost?: unknown }).cost).toEqual((elves.faces[0]!.abilities[0] as { cost?: unknown }).cost);
    expect(def.automation.faces![0]!.abilities.every((a) => a.level === 'manual')).toBe(true);
  });

  it('keyword abilities keep their CR meaning (CR 702.1) and stay native; the card is still manual, and so is a vanilla card', () => {
    const plain = compiledDef('Serra Angel');
    const angel = markUnsanctioned(plain);
    expect(angel.faces[0]!.abilities).toEqual(plain.faces[0]!.abilities.map((a) => (a.kind === 'keyword' ? a : expect.objectContaining({ kind: 'manual' }))));
    expect(angel.faces[0]!.abilities.some((a) => a.kind === 'keyword')).toBe(true);
    expect(angel.automation.level).toBe('manual');
    expect(markUnsanctioned(compiledDef('Grizzly Bears')).automation.level).toBe('manual');
  });

  it('idempotent, and the original definition is not changed', () => {
    const bolt = compiledDef('Lightning Bolt');
    const before = JSON.stringify(bolt);
    const once = markUnsanctioned(bolt);
    expect(markUnsanctioned(once)).toEqual(once);
    expect(JSON.stringify(bolt)).toBe(before);
  });
});

describe('WP24 review: an unsanctioned card keeps the procedure rules the engine applies to every card', () => {
  /** A silver-border Aura, flagged by the index (trimCard). */
  const SILLY_AURA: OracleCard = {
    name: 'Silly Aura', layout: 'normal', mana_cost: '{W}', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.', colors: ['W'],
    border_color: 'silver', unsanctioned: true,
  };
  const SILVER_ANGEL: OracleCard = {
    name: 'Silver Angel', layout: 'normal', mana_cost: '{3}{W}{W}', type_line: 'Creature — Angel', oracle_text: 'Flying\nVigilance', power: '4', toughness: '4', colors: ['W'],
    keywords: ['Flying', 'Vigilance'], border_color: 'silver', unsanctioned: true,
  };

  it('every compile path flags it: compileCard applies markUnsanctioned to an OracleCard flagged unsanctioned (design 12.3)', () => {
    const def = compileCard(SILVER_ANGEL);
    expect(def.unsanctioned).toBe(true);
    expect(def.automation.level).toBe('manual');
    const { unsanctioned: _u, ...sanctioned } = SILVER_ANGEL;
    expect(compileCard(sanctioned).unsanctioned).toBeUndefined();
  });

  it('CR 303.4a, 601.2c: an unsanctioned Aura still targets on cast, and resolves attached (CR 303.4f)', () => {
    let s = scenario(['Plains', 'Grizzly Bears'], { defs: [compileCard(SILLY_AURA)], p1: { hand: ['Silly Aura'], battlefield: ['Plains'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const aura = find(s, 'Silly Aura', 'hand', 'p1');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: aura });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] } as never);
    while (s.pending?.kind !== 'priority' || s.zones.stack.length > 0) {
      if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true } as never);
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else throw new Error(`unexpected ${s.pending?.kind}`);
    }
    const onField = find(s, 'Silly Aura', 'battlefield', 'p1');
    expect(s.objects[onField]!.attachedTo).toBe(bears);
  });

  it('CR 702.9b: an unsanctioned creature with flying can\'t be blocked by a creature with neither flying nor reach', () => {
    const angel = compileCard(SILVER_ANGEL);
    const s0 = scenario(['Hill Giant', 'Giant Spider'], { defs: [angel], p1: { battlefield: ['Silver Angel'] }, p2: { battlefield: ['Hill Giant', 'Giant Spider'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Silver Angel', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers', 10);
    const offered = new Set(s.pending?.kind === 'declareBlockers' ? s.pending.candidates.filter((c) => c.attackers.length > 0).map((c) => c.id) : []);
    expect(offered.has(find(s0, 'Hill Giant', 'battlefield', 'p2'))).toBe(false);
    expect(offered.has(find(s0, 'Giant Spider', 'battlefield', 'p2'))).toBe(true);
  });
});

describe('WP24 tokenDefFor (CR 111.10): the predefined token definition the interpreter creates', () => {
  it.each(['Treasure', 'Food', 'Clue', 'treasure', 'Treasure Token'])('%s', (name) => {
    const def = tokenDefFor(name) as CardDef;
    expect(def.isToken).toBe(true);
    expect(def.id.startsWith('token:')).toBe(true);
    const same = tokenCardDef({ predefined: name.replace(/ Token$/i, '') });
    expect(def).toEqual(same);
  });

  it('an unknown name is undefined, never guessed', () => {
    expect(tokenDefFor('Zorblax')).toBeUndefined();
    expect(tokenDefFor('')).toBeUndefined();
  });
});
