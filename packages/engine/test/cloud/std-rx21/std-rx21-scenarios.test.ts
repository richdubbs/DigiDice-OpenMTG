/**
 * EDH lane rx21 (std-rx21): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 404.1, 102.3, 601.2f "This spell costs {3} less to cast if an opponent has seven or more cards in their graveyard": reduced only when one opponent alone has
 *                           seven cards in their graveyard; your own graveyard does not count
 *   CR 404.1, 602.5b        "Activate only if an opponent has eight or more cards in their graveyard": the ability is offered only then
 *   CR 601.3, 604.1         "You can't cast creature spells.": a creature card in hand is not castable, an artifact card is; the opponent is not restricted
 *   CR 305.2, 604.1         "You can't play lands.": no land play is offered to you; the opponent still plays lands
 *   CR 702.16a, 608.2d      "gains protection from colorless or from the color of your choice": the choice offers colorless and the five colors; the answer is
 *                           the protection granted, until end of turn
 *   CR 115.1, 702.11b       "can't be the target of spells or abilities your opponents control": an opponent's spell or ability can't target the object; its
 *                           controller's can; with a duration ("this turn") it ends at the cleanup step; "your opponents" are the effect's controller's
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { isTargetable } from '../../../src/rules/targets';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; options?: string[] }
/** Answer the decisions that come up (targets, listed options, costs paid automatically) until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], options: [...(script.options ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'chooseOption') {
      const want = q.options.shift();
      const o = p.options.find((x) => x.label === want) ?? p.options[0]!;
      s = answer(s, { kind: 'chooseOption', ids: [o.id] });
    } else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));
const protections = (s: GameState, id: ObjectId): string[] => getChars(s, id).keywords.filter((k) => k.keyword === 'protection').map((k) => String(k.quality));
const fill = (n: number, name = 'Test Dust Mote'): string[] => Array(n).fill(name) as string[];

describe('CR 404.1, 102.3, 601.2f: "This spell costs {3} less to cast if an opponent has seven or more cards in their graveyard."', () => {
  const READ = card('Test Borrowed Lore', 'Instant', 'This spell costs {3} less to cast if an opponent has seven or more cards in their graveyard.\nDraw two cards.', undefined, '{3}{U}');
  const MOTE = card('Test Dust Mote', 'Artifact', '');
  const defs = [READ, MOTE];
  const start = (p2gy: number, p1gy = 0): GameState => {
    const s = scenario([], { defs, p1: { hand: ['Test Borrowed Lore'], graveyard: fill(p1gy) }, p2: { graveyard: fill(p2gy) } });
    mana(s, 'U');
    return s;
  };
  it('is automated', () => expect(full(READ)).toBe(true));
  it('with seven cards in the opponent\'s graveyard it costs {U}: castable with one blue mana, and it draws two', () => {
    const s0 = start(7);
    expect(castable(s0, 'Test Borrowed Lore')).toBe(true);
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Borrowed Lore', 'hand', 'p1') })));
    expect(s.zones.hand.p1!.length).toBe(2);
  });
  it('with six cards it is not reduced (not castable with one mana); your own seven cards do not count', () => {
    expect(castable(start(6), 'Test Borrowed Lore')).toBe(false);
    expect(castable(start(0, 7), 'Test Borrowed Lore')).toBe(false);
  });
});

describe('CR 404.1, 602.5b: "Activate only if an opponent has eight or more cards in their graveyard."', () => {
  const EEL = card('Test Silt Eel', 'Creature — Fish', 'Sacrifice this creature: Draw a card. Activate only if an opponent has eight or more cards in their graveyard.', ['1', '1']);
  const MOTE = card('Test Dust Mote', 'Artifact', '');
  const offered = (p2gy: number, p1gy = 0): boolean => {
    const s = scenario([], { defs: [EEL, MOTE], p1: { battlefield: ['Test Silt Eel'], graveyard: fill(p1gy) }, p2: { graveyard: fill(p2gy) } });
    return legal(s, 'p1', 'activate').some((a) => (a.action as { source?: string }).source === find(s, 'Test Silt Eel', 'battlefield', 'p1'));
  };
  it('is automated', () => expect(full(EEL)).toBe(true));
  it('offered with eight cards in an opponent\'s graveyard, not with seven, not for eight in your own', () => {
    expect(offered(8)).toBe(true);
    expect(offered(7)).toBe(false);
    expect(offered(0, 8)).toBe(false);
  });
});

describe('CR 601.3, 604.1: "You can\'t cast creature spells." / CR 305.2: "You can\'t play lands."', () => {
  const GOLEM = card('Test Rust Sentry', 'Artifact Creature — Golem', "You can't cast creature spells.", ['3', '3']);
  const DIGGER = card('Test Pit Digger', 'Enchantment', "You can't play lands.");
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2']);
  const TOME = card('Test Small Tome', 'Artifact', '');
  const defs = [GOLEM, DIGGER, BEAR, TOME];
  it('both are automated', () => {
    expect(full(GOLEM)).toBe(true);
    expect(full(DIGGER)).toBe(true);
  });
  it('with it on the battlefield your creature card is not castable, your artifact card is', () => {
    const s = scenario(['Forest'], { defs, p1: { battlefield: ['Test Rust Sentry'], hand: ['Test Grove Bear', 'Test Small Tome'] } });
    expect(castable(s, 'Test Grove Bear')).toBe(false);
    expect(castable(s, 'Test Small Tome')).toBe(true);
  });
  it('the opponent\'s Sentry does not stop you ("you" is its controller)', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Grove Bear'] }, p2: { battlefield: ['Test Rust Sentry'] } });
    expect(castable(s, 'Test Grove Bear')).toBe(true);
  });
  it('"You can\'t play lands": no land play is offered to you; the opponent plays lands on their turn', () => {
    let s = scenario(['Forest'], { defs, p1: { battlefield: ['Test Pit Digger'], hand: ['Forest'] }, p2: { hand: ['Forest'] } });
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
    s = advanceTo(s, 2, 'main1');
    expect(legal(s, 'p2', 'playLand').length).toBeGreaterThan(0);
  });
});

describe('CR 702.16a, 608.2d, 105.2c: "gains protection from colorless or from the color of your choice until end of turn"', () => {
  const RUNES = card('Test Rune Keeper', 'Creature — Human Monk', '{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.', ['1', '2']);
  const SHIELD = card('Test Iron Ward', 'Instant', 'Target creature gains protection from artifacts or from the color of your choice until end of turn.');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [RUNES, SHIELD, BEAR];
  const activate = (pick: string): [GameState, ObjectId] => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rune Keeper', 'Test Grove Bear'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    const s1 = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Rune Keeper', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[obj(bear)]] });
    let s = passBoth(s1);
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    expect((s.pending as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(['colorless', 'white', 'blue', 'black', 'red', 'green']);
    s = resolveAll(drive(s, { options: [pick] }));
    return [s, bear];
  };
  it('both are automated', () => {
    expect(full(RUNES)).toBe(true);
    expect(full(SHIELD)).toBe(true);
  });
  it('choosing colorless grants protection from colorless (only that)', () => {
    const [s, bear] = activate('colorless');
    expect(protections(s, bear)).toEqual(['colorless']);
  });
  it('choosing red grants protection from red; it ends at the cleanup step', () => {
    const [s, bear] = activate('red');
    expect(protections(s, bear)).toEqual(['color:R']);
    expect(protections(advanceTo(s, 2, 'upkeep'), bear)).toEqual([]);
  });
  it('"from artifacts or from ..." offers artifacts and the five colors; artifacts grants protection from artifacts', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grove Bear'], hand: ['Test Iron Ward'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    let s = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Iron Ward', 'hand', 'p1') }), { targets: [[obj(bear)]] }));
    expect((s.pending as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(['artifacts', 'white', 'blue', 'black', 'red', 'green']);
    s = resolveAll(drive(s, { options: ['artifacts'] }));
    expect(protections(s, bear)).toEqual(['type:Artifact']);
  });
});

describe('CR 115.1, 702.11b: "can\'t be the target of spells or abilities your opponents control"', () => {
  const COVER = card('Test Leaf Veil', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't be the target of spells or abilities your opponents control.");
  const VINES = card('Test Thorn Screen', 'Instant', "Target creature can't be the target of spells or abilities your opponents control this turn.");
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2']);
  const ROCK = card('Test Pebble', 'Artifact', '');
  const defs = [COVER, VINES, BEAR, ROCK];
  it('both are automated', () => {
    expect(full(COVER)).toBe(true);
    expect(full(VINES)).toBe(true);
  });
  it('the Aura: an opponent\'s source can\'t target the enchanted creature, its controller\'s can; an unenchanted creature stays targetable', () => {
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Grove Bear', 'Test Pebble'], hand: ['Test Leaf Veil'] }, p2: { battlefield: ['Test Pebble'] } });
    const b1 = find(s1, 'Test Grove Bear', 'battlefield', 'p1');
    const s2 = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Leaf Veil', 'hand', 'p1') }), { targets: [[obj(b1)]] }));
    const mine = find(s2, 'Test Pebble', 'battlefield', 'p1');
    const theirs = find(s2, 'Test Pebble', 'battlefield', 'p2');
    expect(isTargetable(s2, b1, 'p2', theirs)).toBe(false);
    expect(isTargetable(s2, b1, 'p1', mine)).toBe(true);
    // a creature without the Aura stays targetable by the opponent
    const s3 = scenario([], { defs, p1: { battlefield: ['Test Grove Bear'] }, p2: { battlefield: ['Test Pebble'] } });
    expect(isTargetable(s3, find(s3, 'Test Grove Bear', 'battlefield', 'p1'), 'p2', find(s3, 'Test Pebble', 'battlefield', 'p2'))).toBe(true);
  });
  it('the instant on your creature: the opponent can\'t target it this turn, you can; next turn the opponent can again', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grove Bear', 'Test Pebble'], hand: ['Test Thorn Screen'] }, p2: { battlefield: ['Test Pebble'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p1');
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Thorn Screen', 'hand', 'p1') }), { targets: [[obj(bear)]] }));
    const theirs = find(s, 'Test Pebble', 'battlefield', 'p2');
    expect(isTargetable(s, bear, 'p2', theirs)).toBe(false);
    expect(isTargetable(s, bear, 'p1', find(s, 'Test Pebble', 'battlefield', 'p1'))).toBe(true);
    expect(isTargetable(advanceTo(s, 2, 'upkeep'), bear, 'p2', theirs)).toBe(true);
  });
  it('"your opponents" are the opponents of the instant\'s controller: cast on the opponent\'s creature, the opponent can\'t target it, you can', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pebble'], hand: ['Test Thorn Screen'] }, p2: { battlefield: ['Test Grove Bear', 'Test Pebble'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p2');
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Thorn Screen', 'hand', 'p1') }), { targets: [[obj(bear)]] }));
    expect(isTargetable(s, bear, 'p2', find(s, 'Test Pebble', 'battlefield', 'p2'))).toBe(false);
    expect(isTargetable(s, bear, 'p1', find(s, 'Test Pebble', 'battlefield', 'p1'))).toBe(true);
  });
});

describe('CR 608.2h, 611.2c, 400.7: "That creature\'s owner can\'t cast spells with the same name as that creature until your next turn." (after a bounce) fails closed', () => {
  const MAGE = card('Test Mirror Warden', 'Creature — Bird Wizard', "When this creature enters, return target creature an opponent controls to its owner's hand. That creature's owner can't cast spells with the same name as that creature until your next turn.", ['3', '2']);
  // The restriction parses, but a resolved effect fixes "that creature" to the objects still on the battlefield (effects/handlers/lasting-fix.ts): the
  // returned card is a new object (CR 400.7), so the name would compare with nothing and the ban would never apply. Until the name is read from last known
  // information (CR 608.2h) the card asks for an engine feature that is not registered and stays partial.
  it('is not automated: it needs feature:restrict.other.lastingSharesWith', () => {
    expect(full(MAGE)).toBe(false);
    expect(MAGE.automation.level).not.toBe('full');
    expect(JSON.stringify(MAGE.automation)).toContain('feature:restrict.other.lastingSharesWith');
  });
});
