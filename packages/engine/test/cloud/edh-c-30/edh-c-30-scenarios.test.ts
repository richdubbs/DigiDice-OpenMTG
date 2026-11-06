/**
 * Commander lane edh-c, round edh-c-30: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.23a, 201.2, 701.20a   "Search your library for a card named A or B ..." / "... a card named A and/or a card named B, reveal them ..." / "Search your library and/or graveyard for a card named A, reveal it ..."
 *   CR 601.2h, 106.1, 608.2c     "~ deals 3 damage to each creature without flying if {R} was spent to cast ~ and 3 damage to each creature with flying if {G} was spent to cast ~."
 *   CR 601.2h, 305.2, 601.3      "Target player can't play lands this turn if {R} was spent to cast ~ and can't cast creature spells this turn if {W} was spent to cast ~."
 *   CR 118.9, 119.3, 601.2b      "If an opponent gained life this turn, you may pay {B} rather than pay this spell's mana cost."
 *   CR 118.9, 305.1, 102.3       "If an opponent had two or more lands enter the battlefield under their control this turn, you may pay {R} rather than pay this spell's mana cost."
 *   CR 701.21a, 122.1f, 608.2c   "sacrifice a creature unless an opponent has three or more poison counters."
 *   CR 701.9a, 701.9b, 608.2c    "That player discards that card, then discards a card at random."
 *   CR 121.1, 401.4, 608.2c      "draw two cards, then put two cards from your hand on the bottom of your library."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; pick?: string[]; log?: string[] }
/** Answer every decision but priority from the script (defaults: yes to a "may", the first `min` options, `pick` names chosen first, no blockers). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.log?.push(p.kind);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') {
      const want = (script.pick ?? []).flatMap((n) => p.options.filter((id) => s.defs[s.objects[id]!.defId]?.name === n));
      const ids = [...want, ...p.options.filter((id) => !want.includes(id))].slice(0, Math.max(p.min, Math.min(want.length, p.max)));
      s = answer(s, { kind: 'chooseObjects', ids } as DecisionAnswer);
    } else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.max).map((o) => o.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function resolveAll(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const castBy = (s: GameState, name: string, player: string, script?: Script, method?: string): GameState =>
  drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), ...(method ? { method } : {}) } as never), script);
const altOk = (s: GameState, name: string, player = 'p1'): boolean => applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player), method: 'alternative' } as never).error === undefined;
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const named = (s: GameState, name: string, zone: string, owner?: string): ObjectId[] =>
  Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner)).map((o) => o.id);
/** p2 casts `name` while p1 holds priority in p1's main phase (p1 passes first), and it resolves; p1 has priority again. */
function opponentCasts(s0: GameState, name: string, script?: Script): GameState {
  const s1 = drive(act(s0, { type: 'pass', player: s0.pending!.player }));
  return resolveAll(castBy(s1, name, 'p2', script), script);
}

describe('CR 701.23a, 201.2: "Search your library for a card named A or B, put it onto the battlefield tapped, then shuffle." (Bogbrew Witch)', () => {
  const WITCH = card('Test Bog Witch', 'Creature — Human Wizard', '{0}, {T}: Search your library for a card named Test Newt or Test Cauldron, put it onto the battlefield tapped, then shuffle.', '{0}', ['1', '1']);
  const NEWT = card('Test Newt', 'Creature — Newt', '', '{0}', ['0', '1']);
  const CAULDRON = card('Test Cauldron', 'Artifact', '');
  const OTHER = card('Test Other Newt', 'Creature — Newt', '', '{0}', ['0', '1']);
  const defs = [WITCH, NEWT, CAULDRON, OTHER];
  const board = () => scenario([], { defs, p1: { battlefield: ['Test Bog Witch'], library: ['Test Newt', 'Test Cauldron', 'Test Other Newt'] } });
  const run = (pick: string[]): GameState => {
    const s0 = board();
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Bog Witch', 'battlefield'), ability: 'p:0:0' } as never), { pick });
  };
  it('is automated', () => { expect(full(WITCH)).toBe(true); });
  it('either named card may be found and enters tapped; a card with another name is not offered', () => {
    const a = run(['Test Cauldron']);
    expect(named(a, 'Test Cauldron', 'battlefield', 'p1')).toHaveLength(1);
    expect(a.objects[named(a, 'Test Cauldron', 'battlefield')[0]!]!.tapped).toBe(true);
    expect(named(a, 'Test Newt', 'library', 'p1')).toHaveLength(1);
    const picked = run(['Test Other Newt']);
    expect(named(picked, 'Test Other Newt', 'battlefield')).toHaveLength(0);
  });
});

describe('CR 701.23a, 701.20a: "... search your library for a card named A and/or a card named B, reveal them, put them into your hand, then shuffle." (Alpine Houndmaster)', () => {
  const HOUND = card('Test Hound Master', 'Creature — Human Warrior', 'When ~ enters, you may search your library for a card named Test Watchdog and/or a card named Test Cur, reveal them, put them into your hand, then shuffle.', '{0}', ['2', '2']);
  const DOG = card('Test Watchdog', 'Creature — Dog', '', '{0}', ['1', '1']);
  const CUR = card('Test Cur', 'Creature — Dog', '', '{0}', ['1', '1']);
  const STRAY = card('Test Stray', 'Creature — Dog', '', '{0}', ['1', '1']);
  const defs = [HOUND, DOG, CUR, STRAY];
  const play = (script: Script): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Hound Master'], library: ['Test Watchdog', 'Test Cur', 'Test Stray'] } });
    return resolveAll(castBy(s0, 'Test Hound Master', 'p1', script), script);
  };
  it('is automated', () => { expect(full(HOUND)).toBe(true); });
  it('both named cards go to the hand; the other card stays in the library', () => {
    const s = play({ pick: ['Test Watchdog', 'Test Cur'] });
    expect(named(s, 'Test Watchdog', 'hand', 'p1')).toHaveLength(1);
    expect(named(s, 'Test Cur', 'hand', 'p1')).toHaveLength(1);
    expect(named(s, 'Test Stray', 'library', 'p1')).toHaveLength(1);
  });
  it('negative: declining the "may" finds nothing', () => {
    const s = play({ yes: [false] });
    expect(named(s, 'Test Watchdog', 'hand', 'p1')).toHaveLength(0);
    expect(named(s, 'Test Watchdog', 'library', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.23a, 701.23d: "... search your library and/or graveyard for a card named A, reveal it, then put it into your hand. If you search your library this way, shuffle." (Sun-Blessed Mount)', () => {
  const MOUNT = card('Test Sun Mount', 'Creature — Dinosaur', 'When ~ enters, you may search your library and/or graveyard for a card named Test Knight, reveal it, then put it into your hand. If you search your library this way, shuffle.', '{0}', ['3', '3']);
  const KNIGHT = card('Test Knight', 'Legendary Creature — Dinosaur Knight', '', '{0}', ['2', '2']);
  const defs = [MOUNT, KNIGHT];
  it('is automated', () => { expect(full(MOUNT)).toBe(true); });
  it('finds the named card in the graveyard', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Sun Mount'], graveyard: ['Test Knight'] } });
    const s = resolveAll(castBy(s0, 'Test Sun Mount', 'p1', { pick: ['Test Knight'] }), { pick: ['Test Knight'] });
    expect(named(s, 'Test Knight', 'hand', 'p1')).toHaveLength(1);
  });
  it('finds the named card in the library', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Sun Mount'], library: ['Test Knight'] } });
    const s = resolveAll(castBy(s0, 'Test Sun Mount', 'p1', { pick: ['Test Knight'] }), { pick: ['Test Knight'] });
    expect(named(s, 'Test Knight', 'hand', 'p1')).toHaveLength(1);
  });
  it('negative: with no such card anywhere, nothing is put into the hand', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Sun Mount'] } });
    const s = resolveAll(castBy(s0, 'Test Sun Mount', 'p1', { pick: ['Test Knight'] }), { pick: ['Test Knight'] });
    expect(named(s, 'Test Knight', 'hand', 'p1')).toHaveLength(0);
  });
});

describe('CR 601.2h, 106.1, 120.3: "~ deals 3 damage to each creature without flying if {R} was spent to cast ~ and 3 damage to each creature with flying if {G} was spent to cast ~." (Firespout)', () => {
  const SPOUT = card('Test Fire Spout', 'Sorcery', '~ deals 3 damage to each creature without flying if {R} was spent to cast ~ and 3 damage to each creature with flying if {G} was spent to cast ~.', '{R/G}{R/G}', undefined, ['R', 'G']);
  const WALKER = card('Test Ground Walker', 'Creature — Ogre', '', '{0}', ['5', '5']);
  const BIRD = card('Test Sky Bird', 'Creature — Bird', 'Flying', '{0}', ['5', '5']);
  const defs = [SPOUT, WALKER, BIRD];
  const play = (lands: string[]): GameState => {
    const s0 = scenario(['Mountain', 'Forest'], { defs, p1: { hand: ['Test Fire Spout'], battlefield: lands }, p2: { battlefield: ['Test Ground Walker', 'Test Sky Bird'] } });
    return resolveAll(castBy(s0, 'Test Fire Spout', 'p1'));
  };
  const hurt = (s: GameState, name: string): number => s.objects[named(s, name, 'battlefield')[0]!]!.damage;
  it('is automated', () => { expect(full(SPOUT)).toBe(true); });
  it('red mana only: the creature without flying takes 3, the flier takes none', () => {
    const s = play(['Mountain', 'Mountain']);
    expect(hurt(s, 'Test Ground Walker')).toBe(3);
    expect(hurt(s, 'Test Sky Bird')).toBe(0);
  });
  it('green mana only: the flier takes 3, the creature without flying takes none', () => {
    const s = play(['Forest', 'Forest']);
    expect(hurt(s, 'Test Ground Walker')).toBe(0);
    expect(hurt(s, 'Test Sky Bird')).toBe(3);
  });
  it('both colors spent: both groups take 3', () => {
    const s = play(['Mountain', 'Forest']);
    expect(hurt(s, 'Test Ground Walker')).toBe(3);
    expect(hurt(s, 'Test Sky Bird')).toBe(3);
  });
});

describe('CR 601.2h, 305.2, 601.3: "Target player can\'t play lands this turn if {R} was spent to cast ~ and can\'t cast creature spells this turn if {W} was spent to cast ~." (Moonhold)', () => {
  const HOLD = card('Test Moon Hold', 'Sorcery', "Target player can't play lands this turn if {R} was spent to cast ~ and can't cast creature spells this turn if {W} was spent to cast ~.", '{R/W}{R/W}', undefined, ['R', 'W']);
  const CUB = card('Test Cub', 'Creature — Bear', '', '{0}', ['1', '1']);
  const defs = [HOLD, CUB];
  const play = (lands: string[]): GameState => {
    const s0 = scenario(['Mountain', 'Plains'], { defs, p1: { hand: ['Test Moon Hold', 'Test Cub', 'Plains'], battlefield: lands } });
    return resolveAll(castBy(s0, 'Test Moon Hold', 'p1', { targets: [[{ kind: 'player', id: 'p1' } as TargetChoice]] }));
  };
  const landOk = (s: GameState): boolean => applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') } as never).error === undefined;
  const cubOk = (s: GameState): boolean => applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cub', 'hand', 'p1') } as never).error === undefined;
  it('is automated', () => { expect(full(HOLD)).toBe(true); });
  it('red only: no land can be played, creatures can still be cast', () => {
    const s = play(['Mountain', 'Mountain']);
    expect(landOk(s)).toBe(false);
    expect(cubOk(s)).toBe(true);
  });
  it('both colors spent: neither a land nor a creature spell is allowed', () => {
    const s = play(['Mountain', 'Plains']);
    expect(landOk(s)).toBe(false);
    expect(cubOk(s)).toBe(false);
  });
  it('white only: lands can be played, no creature spell can be cast', () => {
    const s = play(['Plains', 'Plains']);
    expect(landOk(s)).toBe(true);
    expect(cubOk(s)).toBe(false);
  });
});

describe('CR 118.9, 119.3, 601.2b: "If an opponent gained life this turn, you may pay {0} rather than pay this spell\'s mana cost." (Needlebite Trap)', () => {
  const TRAP = card('Test Gain Trap', 'Instant', "If an opponent gained life this turn, you may pay {0} rather than pay this spell's mana cost.\nTarget player loses 5 life and you gain 5 life.", '{5}{B}');
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const defs = [TRAP, SPARK];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Gain Trap', 'Test Spark'] }, p2: { hand: ['Test Spark'] } });
  it('is automated', () => { expect(full(TRAP)).toBe(true); });
  it('offered after an opponent gained life; not before, and not after the caster\'s own life gain', () => {
    let s = board();
    expect(altOk(s, 'Test Gain Trap')).toBe(false);
    s = resolveAll(castBy(s, 'Test Spark', 'p1'));
    expect(altOk(s, 'Test Gain Trap')).toBe(false);
    s = opponentCasts(s, 'Test Spark');
    expect(altOk(s, 'Test Gain Trap')).toBe(true);
    const before = life(s, 'p2');
    s = resolveAll(castBy(s, 'Test Gain Trap', 'p1', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] }, 'alternative'));
    expect(life(s, 'p2')).toBe(before - 5);
  });
});

describe('CR 118.9, 305.1, 102.3: "If an opponent had two or more lands enter the battlefield under their control this turn, you may pay {0} rather than pay this spell\'s mana cost." (Lavaball Trap)', () => {
  const TRAP = card('Test Land Trap', 'Instant', "If an opponent had two or more lands enter the battlefield under their control this turn, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life.", '{3}{R}{R}');
  const SOW = card('Test Sow Two', 'Instant', 'Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.');
  const SOW1 = card('Test Sow One', 'Instant', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
  const defs = [TRAP, SOW, SOW1];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Land Trap', 'Test Sow Two'] }, p2: { hand: ['Test Sow Two', 'Test Sow One'] } });
  it('is automated', () => { expect(full(TRAP)).toBe(true); });
  it('offered after an opponent put two lands onto the battlefield', () => {
    let s = board();
    expect(altOk(s, 'Test Land Trap')).toBe(false);
    s = opponentCasts(s, 'Test Sow Two', { pick: ['Plains', 'Plains'] });
    expect(altOk(s, 'Test Land Trap')).toBe(true);
    s = resolveAll(castBy(s, 'Test Land Trap', 'p1', {}, 'alternative'));
    expect(life(s, 'p1')).toBe(23);
  });
  it('negative: one land is not enough, and the caster\'s own two lands do not count', () => {
    let s = board();
    s = resolveAll(castBy(s, 'Test Sow Two', 'p1', { pick: ['Plains', 'Plains'] }), { pick: ['Plains', 'Plains'] });
    expect(altOk(s, 'Test Land Trap')).toBe(false);
    s = opponentCasts(s, 'Test Sow One', { pick: ['Plains'] });
    expect(altOk(s, 'Test Land Trap')).toBe(false);
  });
});

describe('CR 701.21a, 122.1f, 608.2c: "When ~ enters, sacrifice a creature unless an opponent has three or more poison counters." (Ravenous Necrotitan)', () => {
  const TITAN = card('Test Necro Titan', 'Creature — Horror', 'When ~ enters, sacrifice a creature unless an opponent has three or more poison counters.', '{0}', ['4', '4']);
  const FODDER = card('Test Fodder', 'Creature — Rat', '', '{0}', ['1', '1']);
  const defs = [TITAN, FODDER];
  const play = (poison: number): GameState => {
    const s0 = tweak(scenario([], { defs, p1: { hand: ['Test Necro Titan'], battlefield: ['Test Fodder'] } }), (g) => { g.players.find((p) => p.id === 'p2')!.poison = poison; });
    return resolveAll(castBy(s0, 'Test Necro Titan', 'p1', { pick: ['Test Fodder'] }), { pick: ['Test Fodder'] });
  };
  it('is automated', () => { expect(full(TITAN)).toBe(true); });
  it('no poison: a creature is sacrificed (the controller picks)', () => {
    const s = play(0);
    expect(named(s, 'Test Fodder', 'graveyard', 'p1')).toHaveLength(1);
    expect(named(s, 'Test Necro Titan', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('two poison counters: still sacrificed', () => { expect(named(play(2), 'Test Fodder', 'graveyard', 'p1')).toHaveLength(1); });
  it('three poison counters on an opponent: nothing is sacrificed', () => {
    const s = play(3);
    expect(named(s, 'Test Fodder', 'battlefield', 'p1')).toHaveLength(1);
    expect(named(s, 'Test Necro Titan', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.9a, 701.9b, 608.2c: "Target opponent reveals their hand. You choose a card from it. That player discards that card, then discards a card at random." (Tourach\'s Canticle)', () => {
  const CANT = card('Test Canticle', 'Sorcery', 'Target opponent reveals their hand. You choose a card from it. That player discards that card, then discards a card at random.');
  const A = card('Test Card A', 'Instant', 'You gain 1 life.');
  const B = card('Test Card B', 'Instant', 'You gain 1 life.');
  const C = card('Test Card C', 'Instant', 'You gain 1 life.');
  const defs = [CANT, A, B, C];
  const play = (hand: string[]): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Canticle'] }, p2: { hand } });
    return resolveAll(castBy(s0, 'Test Canticle', 'p1', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]], pick: ['Test Card A'] }), { pick: ['Test Card A'] });
  };
  it('is automated', () => { expect(full(CANT)).toBe(true); });
  it('the chosen card is discarded, then one more card at random', () => {
    const s = play(['Test Card A', 'Test Card B', 'Test Card C']);
    expect(named(s, 'Test Card A', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.hand['p2']!.filter((id) => s.defs[s.objects[id]!.defId]?.name.startsWith('Test Card'))).toHaveLength(1);
  });
  it('negative: with only the chosen card in hand, nothing more is discarded', () => {
    const s = play(['Test Card A']);
    expect(named(s, 'Test Card A', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.graveyard['p2']!.length).toBe(1);
  });
});

describe('CR 121.1, 401.4, 608.2c: "When ~ enters, draw two cards, then put two cards from your hand on the bottom of your library." (Sawtooth Loon)', () => {
  const LOON = card('Test Loon', 'Creature — Bird', 'When ~ enters, draw two cards, then put two cards from your hand on the bottom of your library.', '{0}', ['2', '2']);
  const X = card('Test Top X', 'Instant', 'You gain 1 life.');
  const Y = card('Test Top Y', 'Instant', 'You gain 1 life.');
  const defs = [LOON, X, Y];
  it('is automated', () => { expect(full(LOON)).toBe(true); });
  it('draws two, then two chosen cards of the hand go to the bottom of the library', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Loon', 'Test Top X', 'Test Top Y'], library: ['Test Top X', 'Test Top Y'] } });
    const handBefore = s0.zones.hand['p1']!.length;
    const libBefore = s0.zones.library['p1']!.length;
    const s = resolveAll(castBy(s0, 'Test Loon', 'p1', { pick: ['Test Top X', 'Test Top Y'] }), { pick: ['Test Top X', 'Test Top Y'] });
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1); // the Loon left the hand, +2 drawn, -2 put back
    expect(s.zones.library['p1']!.length).toBe(libBefore - 2 + 2);
    const lib = s.zones.library['p1']!;
    expect(lib.slice(-2).every((id) => s.defs[s.objects[id]!.defId]!.name.startsWith('Test Top'))).toBe(true);
    expect(lib.slice(-2).every((id) => s.objects[id]!.zone === 'library')).toBe(true);
  });
});
