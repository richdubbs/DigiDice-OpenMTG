/**
 * opp-port-1 (2026-10-24): OPP2 of the old project (2026-10-17, never merged there), ported onto std-rx12's `countPlayers.controlsIs`, the same
 * per-player count the old `countPlayers.controls` added.
 *
 * OPP2 (OPP1 follow-up; the Cond hole, parser/holes/cond.ts#control): "an opponent controls ..." is ONE opponent (CR 102.3), in the last two shapes that still
 * read every opponent together. The readings agree in a two-player game (CR 102.2) and differ in Free-for-All (CR 806).
 *
 *   "an opponent controls no creatures"           some opponent controls none (`countPlayers.controlsIs`, count 0); it was read as no opponent controlling one,
 *                                                 which is "your opponents control no creatures" (Rankle, Pitiless Trickster; Hagra Mauling).
 *   "an opponent controls more lands than you"    some opponent, alone, controls more than you (`countPlayers.controlsVs`, std-sos review, unchanged here):
 *                                                 the renderer no longer says it of the count of every opponent's lands together (FAST5 T62/T70's earlier
 *                                                 reading), so the gate cannot accept that reading again (Land Tax, Knight of the White Orchid, Gift of Estates ...).
 *
 * Played in 4-player games with invented wordings (design 6.10), one per evaluator of the condition: an intervening "if" (effects/eval.ts, CR 603.4), a static
 * ability's condition (statics/match.ts, CR 604.1), an activation restriction (actions/announce-cond.ts, CR 602.5b) and a cost reduction's condition
 * (statics/costmods.ts through statics/match.ts, CR 601.2f).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type AbilityDef, type CardDef, type Condition, type GameState, type ManaSymbol, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';
import { capabilitiesOf, ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { bare, card as oracle, fullyAutomated } from '../../m5/templates/support';
import { accepts, rejects, trig } from '../../m5/render/build';
import { legal } from '../../m3/scenario';
import { act, concede, drive, find, lifeOf, mpScenario, resolveStack } from '../../m12/rules/helpers';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const EACH_OPPONENT = { ref: 'each', who: 'opponent' } as const;

/** "an opponent controls no creatures", as the Cond hole now reads it. */
const ONE_OPPONENT_NO_CREATURES: Condition = {
  cond: 'compare', left: { q: 'countPlayers', of: EACH_OPPONENT, controlsIs: { filter: { types: ['Creature'] }, op: '==', n: 0 } }, op: '>=', right: 1,
};
/** The earlier reading: no opponent controls a creature ("your opponents control no creatures"). */
const NO_OPPONENT_CREATURES: Condition = { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } } };
/** "an opponent controls more lands than you" (std-sos review). */
const ONE_OPPONENT_MORE_LANDS: Condition = {
  cond: 'compare', left: { q: 'countPlayers', of: EACH_OPPONENT, controlsVs: { filter: { types: ['Land'] }, op: '>', than: { ref: 'you' } } }, op: '>=', right: 1,
};
/** The earlier reading (FAST5 T62): every opponent's lands together against yours. */
const ALL_OPPONENTS_MORE_LANDS: Condition = {
  cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'opponent' } } }, op: '>',
  right: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } },
};
/** The same with the description as an `anyOf` beside the controller (FAST5 T70). */
const ALL_OPPONENTS_MORE_LANDS_T70: Condition = {
  cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], controller: 'opponent' } } }, op: '>',
  right: { q: 'count', of: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], controller: 'you' } } },
};

type Ab = { kind: string; interveningIf?: unknown; condition?: unknown };
function parsed(type: string, text: string): Ab[] {
  const f = parseCard(oracle('Example Card', type, text), OPTS).faces[0]!;
  expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics.filter((d) => d.level === 'manual'))} ${JSON.stringify(f.gate.filter((g) => !g.ok))}`).toBe(true);
  return bare(f.abilities) as Ab[];
}
const upkeepIf = (cond: string): unknown => parsed('Creature — Spirit', `At the beginning of your upkeep, if ${cond}, you gain 3 life.`)[0]!.interveningIf;

describe('OPP2 parse: "an opponent controls no <permanents>" is one opponent who controls none (CR 102.3, 806)', () => {
  it('"no creatures" (Rankle, Pitiless Trickster) and "no basic lands" (Hagra Mauling\'s cost reduction): countPlayers.controlsIs == 0, at least one opponent', () => {
    expect(upkeepIf('an opponent controls no creatures')).toEqual(ONE_OPPONENT_NO_CREATURES);
    const [cost] = parsed('Instant', 'This spell costs {1} less to cast if an opponent controls no basic lands.\nDestroy target creature.');
    expect(cost!.condition).toEqual({
      cond: 'compare', left: { q: 'countPlayers', of: EACH_OPPONENT, controlsIs: { filter: { supertypes: ['Basic'], types: ['Land'] }, op: '==', n: 0 } }, op: '>=', right: 1,
    });
  });

  it('"you control no creatures" is unchanged: you are one player, a negated existence', () => {
    expect(upkeepIf('you control no creatures')).toEqual({ cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } });
  });

  it('"an opponent controls more lands than you" stays countPlayers.controlsVs (std-sos review, FAST5 T62): one opponent alone against you', () => {
    expect(upkeepIf('an opponent controls more lands than you')).toEqual(ONE_OPPONENT_MORE_LANDS);
  });

  it('fails closed: the "no" reading needs feature:q.countPlayers.controlsIs (and its announcement form for "Activate only if ...")', () => {
    const def = trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }], { interveningIf: ONE_OPPONENT_NO_CREATURES });
    expect(capabilitiesOf(def)).toContain('feature:q.countPlayers.controlsIs');
    const restriction = parsed('Artifact', '{T}: You gain 1 life. Activate only if an opponent controls no creatures.')[0]!;
    expect(capabilitiesOf(restriction as unknown as AbilityDef)).toContain('feature:announce.qty.countPlayers.controlsIs');
  });
});

describe('OPP2 render (G6): the gate tells the readings apart', () => {
  const upkeep = (c: Condition): AbilityDef => trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }], { interveningIf: c });
  const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
  const at = (cond: string): string => `At the beginning of your upkeep, if ${cond}, you gain 3 life.`;

  it('one opponent with none: "an opponent controls no creatures", never "your opponents control no creatures"', () => {
    accepts(upkeep(ONE_OPPONENT_NO_CREATURES), at('an opponent controls no creatures'), ctx);
    rejects(upkeep(ONE_OPPONENT_NO_CREATURES), at('your opponents control no creatures'), ctx);
  });

  it('no opponent with one: "your opponents control no creatures", no longer "an opponent controls no creatures"', () => {
    accepts(upkeep(NO_OPPONENT_CREATURES), at('your opponents control no creatures'), ctx);
    rejects(upkeep(NO_OPPONENT_CREATURES), at('an opponent controls no creatures'), ctx);
  });

  it('one opponent alone with more lands: "an opponent controls more lands than you", never "your opponents control more lands than you"', () => {
    accepts(upkeep(ONE_OPPONENT_MORE_LANDS), at('an opponent controls more lands than you'), ctx);
    rejects(upkeep(ONE_OPPONENT_MORE_LANDS), at('your opponents control more lands than you'), ctx);
  });

  it('every opponent\'s lands together (both FAST5 shapes): "your opponents control more lands than you", no longer "an opponent controls more lands than you"', () => {
    for (const c of [ALL_OPPONENTS_MORE_LANDS, ALL_OPPONENTS_MORE_LANDS_T70]) {
      accepts(upkeep(c), at('your opponents control more lands than you'), ctx);
      rejects(upkeep(c), at('an opponent controls more lands than you'), ctx);
    }
  });
});

function synthetic(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` for Alice after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef): string {
  const m = modifiedPlan(s, 'p1', id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}

const BEAR = synthetic('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RUINS = synthetic('Test Ruins', 'Land', '{T}: You gain 1 life.'); // a nonbasic land

/** Rankle's condition and Hagra Mauling's, one card per evaluator. */
const LURKER = synthetic('Test Lurker', 'Creature — Faerie', 'As long as an opponent controls no creatures, ~ gets +2/+2.', { pt: ['1', '1'] });
const HERALD = synthetic('Test Herald', 'Creature — Faerie', 'When ~ enters, if an opponent controls no creatures, you gain 3 life.', { pt: ['1', '1'] });
const IDOL = synthetic('Test Idol', 'Artifact', '{T}: You gain 1 life. Activate only if an opponent controls no creatures.');
const MAULING = synthetic('Test Mauling', 'Instant', 'This spell costs {1} less to cast if an opponent controls no basic lands.\nYou gain 3 life.', { cost: '{1}{W}' });

/** The same with "an opponent controls more lands than you" (Land Tax, Weathered Wayfarer, ...). */
const SURVEYOR = synthetic('Test Surveyor', 'Creature — Human', 'As long as an opponent controls more lands than you, ~ gets +2/+2.', { pt: ['1', '1'] });
const SCOUT = synthetic('Test Scout', 'Creature — Human', 'When ~ enters, if an opponent controls more lands than you, you gain 3 life.', { pt: ['1', '1'] });
const WAYMARK = synthetic('Test Waymark', 'Artifact', '{T}: You gain 1 life. Activate only if an opponent controls more lands than you.');
const ESTATES = synthetic('Test Estates', 'Instant', 'This spell costs {2} less to cast if an opponent controls more lands than you.\nYou gain 3 life.', { cost: '{2}{W}' });

const DEFS = [BEAR, RUINS, LURKER, HERALD, IDOL, MAULING, SURVEYOR, SCOUT, WAYMARK, ESTATES];
type Board = Partial<Record<PlayerId, string[]>>;

/** A 4-player Free-for-All game (CR 806) at Alice's first main phase: the opponents' battlefields, and Alice's `mine` and `hand`. */
function game(opponents: Board, mine: string[] = [], hand: string[] = []): GameState {
  return mpScenario({
    defs: DEFS,
    zones: { p1: { battlefield: mine, hand }, p2: { battlefield: opponents.p2 ?? [] }, p3: { battlefield: opponents.p3 ?? [] }, p4: { battlefield: opponents.p4 ?? [] } },
  });
}
const plains = (n: number): string[] => Array(n).fill('Plains') as string[];

/** Through each evaluator, with Alice holding `mine` lands besides the card. */
function evaluators(opponents: Board, mine: string[], cards: { stat: string; trigger: string; restriction: string; cost: [string, CardDef] }) {
  const pt = (): number | null => {
    const s = game(opponents, [cards.stat, ...mine]);
    return ptNumbers(getChars(s, find(s, cards.stat, 'battlefield', 'p1'))!).power;
  };
  const enters = (): number => {
    const s = game(opponents, mine, [cards.trigger]);
    return lifeOf(resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, cards.trigger, 'hand', 'p1') }))), 'p1');
  };
  const offered = (): boolean => {
    const s = game(opponents, [cards.restriction, ...mine]);
    const n = legal(s, 'p1', 'activate').filter((a) => 'object' in a && a.object === find(s, cards.restriction, 'battlefield', 'p1')).length;
    const tried = applyAction(s, { type: 'activate', player: 'p1', source: find(s, cards.restriction, 'battlefield', 'p1'), ability: 'p:0:0' });
    expect(tried.error === undefined, 'offered and accepted agree').toBe(n === 1);
    return n === 1;
  };
  const cost = (): string => {
    const s = game(opponents, mine, [cards.cost[0]]);
    return costOf(s, find(s, cards.cost[0], 'hand', 'p1'), cards.cost[1]);
  };
  return { pt, enters, offered, cost };
}

describe('OPP2 in a 4-player game (CR 806): "an opponent controls no creatures" when one opponent has none, though the others have some', () => {
  const NO = { stat: 'Test Lurker', trigger: 'Test Herald', restriction: 'Test Idol', cost: ['Test Mauling', MAULING] as [string, CardDef] };
  /** Bob and Carol control a creature each, Dan none. */
  const ONE_WITHOUT: Board = { p2: ['Test Bear'], p3: ['Test Bear'], p4: [] };
  /** Every opponent controls a creature. */
  const ALL_WITH: Board = { p2: ['Test Bear'], p3: ['Test Bear'], p4: ['Test Bear'] };

  it('the invented cards are automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });

  it('a static ability\'s condition (statics/match.ts, CR 604.1, 613.4c): +2/+2 while Dan controls no creatures; not when everyone has one', () => {
    expect(evaluators(ONE_WITHOUT, [], NO).pt()).toBe(3);
    expect(evaluators(ALL_WITH, [], NO).pt()).toBe(1);
  });

  it('an intervening "if" (effects/eval.ts, CR 603.4): the enters trigger gains life when one opponent controls no creatures', () => {
    expect(evaluators(ONE_WITHOUT, [], NO).enters()).toBe(23);
    expect(evaluators(ALL_WITH, [], NO).enters()).toBe(20);
  });

  it('an activation restriction (actions/announce-cond.ts, CR 602.5b): offered only when one opponent controls no creatures', () => {
    expect(evaluators(ONE_WITHOUT, [], NO).offered()).toBe(true);
    expect(evaluators(ALL_WITH, [], NO).offered()).toBe(false);
  });

  it('Hagra Mauling\'s cost reduction (statics/costmods.ts, CR 601.2f): {1} less when one opponent controls no basic lands (a nonbasic land or none)', () => {
    expect(evaluators({ p2: ['Plains'], p3: ['Plains'], p4: ['Test Ruins'] }, [], NO).cost()).toBe('{W}');
    expect(evaluators({ p2: ['Plains'], p3: ['Plains'], p4: [] }, [], NO).cost()).toBe('{W}');
    expect(evaluators({ p2: ['Plains'], p3: ['Plains'], p4: ['Plains', 'Test Ruins'] }, [], NO).cost()).toBe('{1}{W}');
  });

  it('a player who left the game is no longer an opponent (CR 104.3a, 800.4a): Dan concedes, Bob and Carol both control a creature', () => {
    const s = game(ONE_WITHOUT, ['Test Lurker']);
    const power = (x: GameState): number | null => ptNumbers(getChars(x, find(x, 'Test Lurker', 'battlefield', 'p1'))!).power;
    expect(power(s)).toBe(3);
    expect(power(concede(s, 'p4').state)).toBe(1);
  });
});

describe('OPP2 in a 4-player game (CR 806): "an opponent controls more lands than you" is one opponent alone (std-sos\'s controlsVs, pinned here)', () => {
  const MORE = { stat: 'Test Surveyor', trigger: 'Test Scout', restriction: 'Test Waymark', cost: ['Test Estates', ESTATES] as [string, CardDef] };
  /** Alice controls five lands. */
  const MINE = plains(5);
  /** Bob and Carol control three lands each (six together, more than Alice's five), Dan none: no single opponent controls more than Alice. */
  const SPREAD: Board = { p2: plains(3), p3: plains(3), p4: [] };
  /** Bob controls six lands. */
  const ONE_HAS_SIX: Board = { p2: plains(6), p3: [], p4: [] };

  it('a static ability\'s condition (statics/match.ts, CR 604.1, 613.4c)', () => {
    expect(evaluators(SPREAD, MINE, MORE).pt()).toBe(1);
    expect(evaluators(ONE_HAS_SIX, MINE, MORE).pt()).toBe(3);
  });

  it('an intervening "if" (effects/eval.ts, CR 603.4)', () => {
    expect(evaluators(SPREAD, MINE, MORE).enters()).toBe(20);
    expect(evaluators(ONE_HAS_SIX, MINE, MORE).enters()).toBe(23);
  });

  it('an activation restriction (actions/announce-cond.ts, CR 602.5b)', () => {
    expect(evaluators(SPREAD, MINE, MORE).offered()).toBe(false);
    expect(evaluators(ONE_HAS_SIX, MINE, MORE).offered()).toBe(true);
  });

  it('a cost reduction (statics/costmods.ts, CR 601.2f)', () => {
    expect(evaluators(SPREAD, MINE, MORE).cost()).toBe('{2}{W}');
    expect(evaluators(ONE_HAS_SIX, MINE, MORE).cost()).toBe('{W}');
  });
});
