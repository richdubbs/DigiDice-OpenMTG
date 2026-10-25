/**
 * opp-port-1 (2026-10-24): OPP1 of the old project (2026-10-17, never merged there), ported onto std-rx12's `countPlayers.controlsIs`, the same
 * per-player count the old `countPlayers.controls` added.
 *
 * OPP1 (the Cond hole, parser/holes/cond.ts#control): "an opponent controls two or more creatures" is ONE opponent who controls that many permanents of their own
 * (`countPlayers.controlsIs`, CR 102.3). It was read as the permanents of every opponent added up, which is what "your opponents control two or more ..." says.
 * The two readings agree in a two-player game (CR 102.2) and differ in Free-for-All (CR 806): two opponents with one creature each are not "an opponent
 * controls two or more creatures" (Walking Dream, Defense of the Heart, Tectonic Edge, Avatar of Fury, Razorlash Transmogrant).
 *
 * Played in 4-player games with invented wordings (design 6.10), one per evaluator of the condition: a static ability's condition (statics/match.ts), an
 * intervening "if" (effects/eval.ts, CR 603.4), an activation restriction (actions/announce-cond.ts, CR 602.5b) and a restriction's "unless" (statics/hooks.ts,
 * CR 508.1c). "Your opponents control two or more lands" keeps the count of every opponent's permanents together.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type AbilityDef, type CardDef, type Condition, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';
import { capabilitiesOf, ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { bare, card as oracle, fullyAutomated } from '../../m5/templates/support';
import { accepts, rejects, trig } from '../../m5/render/build';
import { legal } from '../../m3/scenario';
import { act, drive, find, lifeOf, mpScenario, passUntil, resolveStack } from '../../m12/rules/helpers';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** "an opponent controls two or more creatures", as the Cond hole now reads it. */
const ONE_OPPONENT_TWO_CREATURES: Condition = {
  cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, controlsIs: { filter: { types: ['Creature'] }, op: '>=', n: 2 } }, op: '>=', right: 1,
};
/** The earlier reading: the creatures of every opponent together. */
const ALL_OPPONENTS_TWO_CREATURES: Condition = { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } }, atLeast: 2 };

type Ab = { kind: string; interveningIf?: unknown; condition?: unknown; effects?: { condition?: unknown; costChange?: unknown }[] };
function parsed(type: string, text: string): Ab[] {
  const f = parseCard(oracle('Example Card', type, text), OPTS).faces[0]!;
  expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics.filter((d) => d.level === 'manual'))} ${JSON.stringify(f.gate.filter((g) => !g.ok))}`).toBe(true);
  return bare(f.abilities) as Ab[];
}
const upkeepIf = (cond: string): unknown => parsed('Creature — Spirit', `At the beginning of your upkeep, if ${cond}, you gain 3 life.`)[0]!.interveningIf;

describe('OPP1 parse: "an opponent controls N or more <permanents>" is one opponent (CR 102.3, 806)', () => {
  it('"two or more creatures", "at least four lands", "four or more nonbasic lands": countPlayers.controlsIs, at least one opponent', () => {
    expect(upkeepIf('an opponent controls two or more creatures')).toEqual(ONE_OPPONENT_TWO_CREATURES);
    expect(upkeepIf('an opponent controls at least four lands')).toEqual({
      cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, controlsIs: { filter: { types: ['Land'] }, op: '>=', n: 4 } }, op: '>=', right: 1,
    });
    expect(upkeepIf('an opponent controls four or more nonbasic lands')).toEqual({
      cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, controlsIs: { filter: { types: ['Land'], notSupertypes: ['Basic'] }, op: '>=', n: 4 } }, op: '>=', right: 1,
    });
  });

  it('existence is the same either way: "an opponent controls a creature" and "one or more creatures" stay `exists`; "you control two or more" too', () => {
    expect(upkeepIf('an opponent controls a creature')).toEqual({ cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } });
    expect(upkeepIf('an opponent controls one or more creatures')).toEqual({ cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } }, atLeast: 1 });
    expect(upkeepIf('you control two or more creatures')).toEqual({ cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, atLeast: 2 });
  });

  it('"your opponents control two or more creatures" keeps the count of every opponent\'s creatures together (template cm.t32.self.less.opponentsControl)', () => {
    const [cost] = parsed('Creature — Spirit', '~ costs {2} less to cast if your opponents control two or more creatures.');
    expect(cost!.condition).toEqual({ cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } }, op: '>=', right: 2 });
  });

  it('fails closed: the reading needs feature:q.countPlayers.controlsIs, which the engine registers (effects/eval.ts, statics/match.ts, actions/announce-cond.ts)', () => {
    const def = trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }], { interveningIf: ONE_OPPONENT_TWO_CREATURES });
    expect(capabilitiesOf(def)).toContain('feature:q.countPlayers.controlsIs');
    expect(ENGINE_CAPABILITIES.has('feature:q.countPlayers.controlsIs')).toBe(true);
    const restriction = parsed('Artifact', '{T}: You gain 1 life. Activate only if an opponent controls two or more creatures.')[0]!;
    expect(capabilitiesOf(restriction as unknown as AbilityDef)).toContain('feature:announce.qty.countPlayers.controlsIs');
  });
});

describe('OPP1 render (G6): the gate tells the two readings apart', () => {
  const upkeep = (c: Condition): AbilityDef => trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }], { interveningIf: c });
  const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };

  it('one opponent\'s creatures: "an opponent controls two or more creatures" (also "at least two"), never "your opponents control"', () => {
    accepts(upkeep(ONE_OPPONENT_TWO_CREATURES), 'At the beginning of your upkeep, if an opponent controls two or more creatures, you gain 3 life.', ctx);
    accepts(upkeep(ONE_OPPONENT_TWO_CREATURES), 'At the beginning of your upkeep, if an opponent controls at least two creatures, you gain 3 life.', ctx);
    rejects(upkeep(ONE_OPPONENT_TWO_CREATURES), 'At the beginning of your upkeep, if your opponents control two or more creatures, you gain 3 life.', ctx);
  });

  it('every opponent\'s creatures together: "your opponents control two or more creatures", no longer "an opponent controls"', () => {
    accepts(upkeep(ALL_OPPONENTS_TWO_CREATURES), 'At the beginning of your upkeep, if your opponents control two or more creatures, you gain 3 life.', ctx);
    rejects(upkeep(ALL_OPPONENTS_TWO_CREATURES), 'At the beginning of your upkeep, if an opponent controls two or more creatures, you gain 3 life.', ctx);
  });
});

function synthetic(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

const BEAR = synthetic('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WATCHER = synthetic('Test Watcher', 'Creature — Spirit', 'As long as an opponent controls two or more creatures, ~ gets +2/+2.', ['1', '1']);
const ENVOY = synthetic('Test Envoy', 'Creature — Spirit', 'When ~ enters, if an opponent controls two or more creatures, you gain 3 life.', ['1', '1']);
const TOTEM = synthetic('Test Totem', 'Artifact', '{T}: You gain 1 life. Activate only if an opponent controls two or more creatures.');
const SENTRY = synthetic('Test Sentry', 'Creature — Soldier', "~ can't attack unless an opponent controls two or more creatures.", ['2', '2']);
const VALE = synthetic('Test Vale', 'Land', '~ enters tapped unless your opponents control two or more lands.');
const DEFS = [BEAR, WATCHER, ENVOY, TOTEM, SENTRY, VALE];

/** Bob and Carol control one creature each (Dan none): no single opponent controls two. */
const SPREAD: Partial<Record<PlayerId, string[]>> = { p2: ['Test Bear'], p3: ['Test Bear'], p4: [] };
/** Bob controls two creatures. */
const ONE_HAS_TWO: Partial<Record<PlayerId, string[]>> = { p2: ['Test Bear', 'Test Bear'], p3: [], p4: [] };

/** A 4-player Free-for-All game (CR 806) at Alice's first main phase, Alice with `mine` on the battlefield and `hand` in hand. */
function game(opponents: Partial<Record<PlayerId, string[]>>, mine: string[] = [], hand: string[] = []): GameState {
  return mpScenario({
    defs: DEFS,
    zones: { p1: { battlefield: mine, hand }, p2: { battlefield: opponents.p2 ?? [] }, p3: { battlefield: opponents.p3 ?? [] }, p4: { battlefield: opponents.p4 ?? [] } },
  });
}

describe('OPP1 in a 4-player game (CR 806): two opponents with one creature each do not satisfy "an opponent controls two or more creatures"; one opponent with two does', () => {
  it('the invented cards are automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });

  it('a static ability\'s condition (statics/match.ts, CR 604.1, 613.4c): +2/+2 only while one opponent controls two creatures', () => {
    const watcher = (s: GameState) => ptNumbers(getChars(s, find(s, 'Test Watcher', 'battlefield', 'p1'))!);
    expect(watcher(game(SPREAD, ['Test Watcher']))).toMatchObject({ power: 1, toughness: 1 });
    expect(watcher(game(ONE_HAS_TWO, ['Test Watcher']))).toMatchObject({ power: 3, toughness: 3 });
  });

  it('an intervening "if" (effects/eval.ts, CR 603.4): the enters trigger gains life only when one opponent controls two creatures', () => {
    const play = (opponents: Partial<Record<PlayerId, string[]>>): GameState => {
      const s = game(opponents, [], ['Test Envoy']);
      return resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Envoy', 'hand', 'p1') })));
    };
    const spread = play(SPREAD);
    expect(find(spread, 'Test Envoy', 'battlefield', 'p1')).toBeDefined();
    expect(lifeOf(spread, 'p1')).toBe(20);
    expect(lifeOf(play(ONE_HAS_TWO), 'p1')).toBe(23);
  });

  it('an activation restriction (actions/announce-cond.ts, CR 602.5b): "Activate only if ..." is offered only when one opponent controls two creatures', () => {
    const offered = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => 'object' in a && a.object === find(s, 'Test Totem', 'battlefield', 'p1')).length;
    const spread = game(SPREAD, ['Test Totem']);
    expect(offered(spread)).toBe(0);
    expect(applyAction(spread, { type: 'activate', player: 'p1', source: find(spread, 'Test Totem', 'battlefield', 'p1'), ability: 'p:0:0' }).error).toBeDefined();
    const one = game(ONE_HAS_TWO, ['Test Totem']);
    expect(offered(one)).toBe(1);
    const after = resolveStack(drive(act(one, { type: 'activate', player: 'p1', source: find(one, 'Test Totem', 'battlefield', 'p1'), ability: 'p:0:0' })));
    expect(lifeOf(after, 'p1')).toBe(21);
  });

  it('a restriction\'s "unless" (statics/hooks.ts, CR 508.1c): the creature can attack only when one opponent controls two creatures', () => {
    // Alice's combat on turn 1: she is asked to declare attackers only when a creature of hers can attack (CR 508.1a)
    const combat = (opponents: Partial<Record<PlayerId, string[]>>): GameState =>
      passUntil(game(opponents, ['Test Sentry']), (x) => (x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1') || x.turn.step === 'main2', "Alice's attack");
    const spread = combat(SPREAD);
    expect(spread.pending?.kind).toBe('priority');
    expect(spread.turn).toMatchObject({ number: 1, step: 'main2' });
    const one = combat(ONE_HAS_TWO);
    expect(one.pending).toMatchObject({ kind: 'declareAttackers', player: 'p1' });
    const attack = applyAction(one, { type: 'answer', player: 'p1', decisionId: one.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: find(one, 'Test Sentry', 'battlefield', 'p1'), defender: 'p2' }] } });
    expect(attack.error).toBeUndefined();
  });

  it('"your opponents control two or more lands" (plural) still counts every opponent\'s lands together: one land each for Bob and Carol is enough', () => {
    const vale = (lands: Partial<Record<PlayerId, string[]>>): boolean => {
      const s = game(lands, [], ['Test Vale']);
      const t = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Vale', 'hand', 'p1') });
      return t.objects[find(t, 'Test Vale', 'battlefield', 'p1')]!.tapped;
    };
    expect(vale({ p2: ['Plains'], p3: ['Plains'] })).toBe(false);
    expect(vale({ p2: ['Plains'] })).toBe(true);
  });
});
