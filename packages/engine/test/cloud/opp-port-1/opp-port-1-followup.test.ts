/**
 * opp-port-1, the follow-up OPP2 left (2026-10-17: "your opponents control no X" and "no opponent controls a X" have no template and stay manual): both say that
 * no opponent controls one such permanent, a negated existence over every opponent's permanents (CR 102.3, 603.4). Erebos's Titan and Kezzerdrix print the first,
 * Vexing Beetle, Kavu Runner and Skittish Kavu the second. "an opponent controls no creatures" is the other reading, one opponent who controls none (opp2.test.ts).
 *
 * Played in a 4-player game with invented wordings (design 6.10) through a static ability's condition (statics/match.ts, CR 604.1) and an intervening "if"
 * (effects/eval.ts, CR 603.4).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type Condition, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { bare, card as oracle, fullyAutomated } from '../../m5/templates/support';
import { accepts, rejects, trig } from '../../m5/render/build';
import { act, drive, find, lifeOf, mpScenario, resolveStack } from '../../m12/rules/helpers';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** No opponent controls a creature. */
const NO_OPPONENT_CREATURES: Condition = { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } } };

type Ab = { kind: string; interveningIf?: unknown; condition?: unknown };
function parsed(type: string, text: string): Ab[] {
  const f = parseCard(oracle('Example Card', type, text), OPTS).faces[0]!;
  expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics.filter((d) => d.level === 'manual'))} ${JSON.stringify(f.gate.filter((g) => !g.ok))}`).toBe(true);
  return bare(f.abilities) as Ab[];
}
const upkeepIf = (cond: string): unknown => parsed('Creature — Spirit', `At the beginning of your upkeep, if ${cond}, you gain 3 life.`)[0]!.interveningIf;

describe('opp-port-1 parse: "your opponents control no <permanents>" and "no opponent controls a <permanent>" are no opponent controlling one (CR 102.3)', () => {
  it('"your opponents control no creatures" (Erebos\'s Titan, Kezzerdrix): a negated existence over every opponent\'s creatures', () => {
    expect(upkeepIf('your opponents control no creatures')).toEqual(NO_OPPONENT_CREATURES);
  });

  it('"no opponent controls a creature" (Vexing Beetle) and "a white or blue creature" (Kavu Runner, Skittish Kavu): the same', () => {
    expect(upkeepIf('no opponent controls a creature')).toEqual(NO_OPPONENT_CREATURES);
    expect(upkeepIf('no opponent controls a white or blue creature')).toEqual({
      cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], colors: ['W', 'U'], controller: 'opponent' } } },
    });
  });

  it('near misses stay unread: "your opponents control no creature" (singular), "no opponent controls creatures" (no article)', () => {
    for (const text of ['your opponents control no creature', 'no opponent controls creatures']) {
      const f = parseCard(oracle('Example Card', 'Creature — Spirit', `At the beginning of your upkeep, if ${text}, you gain 3 life.`), OPTS).faces[0]!;
      expect(fullyAutomated(f), text).toBe(false);
    }
  });
});

describe('opp-port-1 render (G6, family no-opponent-controls-a): both wordings, never "an opponent controls no creatures"', () => {
  const upkeep = (c: Condition): AbilityDef => trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }], { interveningIf: c });
  const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
  const at = (cond: string): string => `At the beginning of your upkeep, if ${cond}, you gain 3 life.`;

  it('accepts "your opponents control no creatures" and "no opponent controls a creature"; rejects the one-opponent wording', () => {
    accepts(upkeep(NO_OPPONENT_CREATURES), at('your opponents control no creatures'), ctx);
    accepts(upkeep(NO_OPPONENT_CREATURES), at('no opponent controls a creature'), ctx);
    rejects(upkeep(NO_OPPONENT_CREATURES), at('an opponent controls no creatures'), ctx);
  });
});

function synthetic(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

const BEAR = synthetic('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WARDEN = synthetic('Test Warden', 'Creature — Spirit', 'As long as no opponent controls a creature, ~ gets +2/+2.', ['1', '1']);
const HERALD = synthetic('Test Herald', 'Creature — Spirit', 'When ~ enters, if your opponents control no creatures, you gain 3 life.', ['1', '1']);
const DEFS = [BEAR, WARDEN, HERALD];
type Board = Partial<Record<PlayerId, string[]>>;

/** A 4-player Free-for-All game (CR 806) at Alice's first main phase. */
function game(opponents: Board, mine: string[] = [], hand: string[] = []): GameState {
  return mpScenario({
    defs: DEFS,
    zones: { p1: { battlefield: mine, hand }, p2: { battlefield: opponents.p2 ?? [] }, p3: { battlefield: opponents.p3 ?? [] }, p4: { battlefield: opponents.p4 ?? [] } },
  });
}
const power = (opponents: Board): number | null => {
  const s = game(opponents, ['Test Warden']);
  return ptNumbers(getChars(s, find(s, 'Test Warden', 'battlefield', 'p1'))!).power;
};
const enters = (opponents: Board): number => {
  const s = game(opponents, [], ['Test Herald']);
  return lifeOf(resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Herald', 'hand', 'p1') }))), 'p1');
};

describe('opp-port-1 in a 4-player game (CR 806): no opponent controls a creature only when none of the three does', () => {
  /** Dan alone controls a creature. */
  const ONE_WITH: Board = { p2: [], p3: [], p4: ['Test Bear'] };
  const NONE: Board = { p2: [], p3: [], p4: [] };

  it('the invented cards are automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });

  it('a static ability\'s condition (statics/match.ts, CR 604.1, 613.4c): +2/+2 only while no opponent controls a creature', () => {
    expect(power(NONE)).toBe(3);
    expect(power(ONE_WITH)).toBe(1);
  });

  it('an intervening "if" (effects/eval.ts, CR 603.4): the enters trigger gains life only when no opponent controls a creature', () => {
    expect(enters(NONE)).toBe(23);
    expect(enters(ONE_WITH)).toBe(20);
  });

  it('your own creatures do not count (CR 102.3: you are not your own opponent)', () => {
    const s = game(NONE, ['Test Warden', 'Test Bear']);
    expect(ptNumbers(getChars(s, find(s, 'Test Warden', 'battlefield', 'p1'))!).power).toBe(3);
  });
});
