/**
 * p2-trigger-events-1 (Phase 2 lane p2-trigger-events): the round's trigger events played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.17a, 603.2c   "a player mills a nonland card" (each card), "a player mills one or more creature cards" (once per player's mill), "one or more ... are milled"
 *   CR 603.6a, 110.5b    "a land you control enters tapped" (an untapped one does not)
 *   CR 603.6c, 603.10a   "a creature is exiled from the battlefield" (a card exiled from a graveyard is not); "a permanent you control is put into a graveyard"
 *                        (the move from the battlefield; a discarded card is not one)
 *   CR 305.1, 109.1      "you play another land" (the object itself played is not another land); "an opponent plays a Forest"
 *   CR 400.3, 603.6a     "a creature enters from your graveyard" (a creature cast from the hand does not)
 *   CR 700.4, 603.6c     "~ or another nontoken Elf you control dies": the object itself and the others, a token Elf not
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, battlefieldNames, find, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { castCard } from '../../m5/announce/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Answer the decisions of what is being done (payment automatic, targets: the given ones, objects: the first ones offered, yes/no: yes); stop at the next priority. */
function settle(s0: GameState, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending as unknown as { kind: string; options: string[]; min: number };
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 0)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what the resolving spells and abilities ask. */
function resolveAll(s0: GameState): GameState {
  let s = settle(s0);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
  return s;
}
const cast = (s: GameState, name: string, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState => resolveAll(settle(castCard(s, name), targets));
const playLand = (s: GameState, name: string): GameState => resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, name, 'hand', 'p1') }));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const FIELD = card('Test Field', 'Land', '{T}: Add {C}.');
const GROVE = card('Test Grove', 'Land — Forest', '({T}: Add {G}.)');

describe('CR 701.17a, 603.2c: mill trigger events', () => {
  const ROT = card('Test Rot Watcher', 'Creature — Zombie', 'Whenever a player mills a nonland card, you gain 1 life.', ['1', '1']);
  const HOARD = card('Test Hoard Watcher', 'Creature — Zombie', 'Whenever a player mills one or more creature cards, you gain 3 life.', ['1', '1']);
  const HEAP = card('Test Heap Watcher', 'Creature — Zombie', 'Whenever one or more nonland cards are milled, you gain 5 life.', ['1', '1']);
  const SELF_MILL = card('Test Self Mill', 'Sorcery', 'You mill three cards.');
  const ALL_MILL = card('Test All Mill', 'Sorcery', 'Each player mills two cards.');
  const defs = [ROT, HOARD, HEAP, SELF_MILL, ALL_MILL, BEAR, FIELD];
  it('compiles fully automated', () => {
    for (const d of [ROT, HOARD, HEAP]) expect(full(d), d.name).toBe(true);
  });
  it('"a player mills a nonland card": once for each nonland card milled; a milled land does not trigger it', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rot Watcher'], hand: ['Test Self Mill'], library: ['Test Bear', 'Test Field', 'Test Bear'] } });
    const s = cast(s0, 'Test Self Mill');
    expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n !== 'Test Self Mill').sort()).toEqual(['Test Bear', 'Test Bear', 'Test Field']);
    expect(life(s, 'p1')).toBe(22);
  });
  it('"a player mills one or more creature cards": once for each player whose mill had one; a player who milled none does not trigger it', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Hoard Watcher'], hand: ['Test All Mill'], library: ['Test Bear', 'Test Bear'] }, p2: { library: ['Test Field', 'Test Field'] } });
    expect(life(cast(s0, 'Test All Mill'), 'p1')).toBe(23);
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Hoard Watcher'], hand: ['Test All Mill'], library: ['Test Bear', 'Test Field'] }, p2: { library: ['Test Bear', 'Test Field'] } });
    expect(life(cast(s1, 'Test All Mill'), 'p1')).toBe(26);
  });
  it('"one or more nonland cards are milled": a mill of lands only does not trigger it', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Heap Watcher'], hand: ['Test Self Mill'], library: ['Test Field', 'Test Field', 'Test Field'] } });
    expect(life(cast(s0, 'Test Self Mill'), 'p1')).toBe(20);
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Heap Watcher'], hand: ['Test Self Mill'], library: ['Test Field', 'Test Bear', 'Test Field'] } });
    expect(life(cast(s1, 'Test Self Mill'), 'p1')).toBe(25);
  });
});

describe('CR 603.6a, 110.5b: "Whenever a land you control enters tapped"', () => {
  const VIGIL = card('Test Vigil Relic', 'Artifact', 'Whenever a land you control enters tapped, you gain 2 life.');
  const SLOW = card('Test Slow Field', 'Land', 'This land enters tapped.\n{T}: Add {C}.');
  const defs = [VIGIL, SLOW, FIELD];
  it('a land that enters tapped triggers it; one that enters untapped does not', () => {
    expect(full(VIGIL)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Vigil Relic'], hand: ['Test Slow Field', 'Test Field'] } });
    expect(life(playLand(s0, 'Test Slow Field'), 'p1')).toBe(22);
    expect(life(playLand(s0, 'Test Field'), 'p1')).toBe(20);
  });
});

describe('CR 603.6c, 603.10a: moves from the battlefield', () => {
  const EXILE_WATCH = card('Test Exile Watcher', 'Creature — Spirit', 'Whenever a creature is exiled from the battlefield, you gain 3 life.', ['1', '1']);
  const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');
  const SCOUR = card('Test Scour', 'Instant', 'Exile target card from a graveyard.');
  const SCRAP_WATCH = card('Test Scrap Engine', 'Artifact', 'Whenever an artifact you control is put into a graveyard, you gain 4 life.');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.');
  const TOSS = card('Test Toss', 'Sorcery', 'Discard a card.');
  const defs = [EXILE_WATCH, BANISH, SCOUR, SCRAP_WATCH, TRINKET, SHATTER, TOSS, BEAR];
  it('"a creature is exiled from the battlefield": a creature exiled from the battlefield triggers it, a creature card exiled from a graveyard does not', () => {
    expect(full(EXILE_WATCH)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Exile Watcher'], hand: ['Test Banish', 'Test Scour'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Bear'] } });
    expect(life(cast(s0, 'Test Banish', [{ kind: 'object', id: find(s0, 'Test Bear', 'battlefield', 'p2') }]), 'p1')).toBe(23);
    expect(life(cast(s0, 'Test Scour', [{ kind: 'object', id: find(s0, 'Test Bear', 'graveyard', 'p2') }]), 'p1')).toBe(20);
  });
  it('"an artifact you control is put into a graveyard": an artifact destroyed on the battlefield triggers it, an artifact card discarded does not', () => {
    expect(full(SCRAP_WATCH)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Scrap Engine', 'Test Trinket'], hand: ['Test Shatter', 'Test Toss', 'Test Trinket'] } });
    expect(life(cast(s0, 'Test Shatter', [{ kind: 'object', id: find(s0, 'Test Trinket', 'battlefield', 'p1') }]), 'p1')).toBe(24);
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Scrap Engine'], hand: ['Test Toss', 'Test Trinket'] } });
    expect(life(cast(s1, 'Test Toss'), 'p1')).toBe(20);
  });
});

describe('CR 305.1, 109.1: "you play another land", "an opponent plays a Forest"', () => {
  const TRAITOR = card('Test Traitor Field', 'Land', 'When you play another land, sacrifice this land.\n{T}: Add {C}{C}.');
  const GROVE_WATCH = card('Test Grove Watcher', 'Enchantment', 'Whenever an opponent plays a Forest, you gain 2 life.');
  const defs = [TRAITOR, GROVE_WATCH, FIELD, GROVE];
  it('playing the land itself does not trigger it; a later land play does, and it is sacrificed', () => {
    expect(full(TRAITOR)).toBe(true);
    const s0 = scenario([], { defs, p1: { hand: ['Test Traitor Field'] } });
    const s1 = playLand(s0, 'Test Traitor Field');
    expect(battlefieldNames(s1)).toContain('Test Traitor Field');
    const s2 = scenario([], { defs, p1: { battlefield: ['Test Traitor Field'], hand: ['Test Field'] } });
    const s3 = playLand(s2, 'Test Field');
    expect(battlefieldNames(s3)).not.toContain('Test Traitor Field');
    expect(zoneNames(s3, 'graveyard', 'p1')).toContain('Test Traitor Field');
  });
  it('"an opponent plays a Forest": your own Forest and an opponent\'s other land do not trigger it', () => {
    expect(full(GROVE_WATCH)).toBe(true);
    const s0 = scenario([], { defs, p1: { hand: ['Test Grove', 'Test Field'] }, p2: { battlefield: ['Test Grove Watcher'] } });
    expect(life(playLand(s0, 'Test Grove'), 'p2')).toBe(22);
    expect(life(playLand(s0, 'Test Field'), 'p2')).toBe(20);
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Grove Watcher'], hand: ['Test Grove'] } });
    expect(life(playLand(s1, 'Test Grove'), 'p1')).toBe(20);
  });
});

describe('CR 400.3, 603.6a: "Whenever a creature enters from your graveyard"', () => {
  const CLAW = card('Test Grave Claw', 'Artifact', 'Whenever a creature enters from your graveyard, you gain 3 life.');
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const defs = [CLAW, RAISE, BEAR];
  it('a creature returned from your graveyard triggers it; a creature cast from your hand does not', () => {
    expect(full(CLAW)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grave Claw'], hand: ['Test Raise', 'Test Bear'], graveyard: ['Test Bear'] } });
    expect(life(cast(s0, 'Test Raise', [{ kind: 'object', id: find(s0, 'Test Bear', 'graveyard', 'p1') }]), 'p1')).toBe(23);
    expect(life(cast(s0, 'Test Bear'), 'p1')).toBe(20);
  });
});

describe('CR 700.4, 603.6c, 603.10a: "Whenever ~ or another nontoken Elf you control dies"', () => {
  const MOURNER = card('Test Elf Mourner', 'Creature — Elf', 'Whenever this creature or another nontoken Elf you control dies, you gain 2 life.', ['1', '1']);
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const defs = [MOURNER, WRATH, ELF, BEAR];
  it('the object itself and another nontoken Elf dying each trigger it; a Bear does not', () => {
    expect(full(MOURNER)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Elf Mourner', 'Test Elf', 'Test Bear'], hand: ['Test Wrath'] } });
    expect(life(cast(s0, 'Test Wrath'), 'p1')).toBe(24);
  });
});
