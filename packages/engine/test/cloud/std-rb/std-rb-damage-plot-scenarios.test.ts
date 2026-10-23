/**
 * Standard round B (std-rB, second part): the Cond reading of this turn's total damage from sources you controlled and a lasting replacement's "if you do",
 * played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after
 * the rule it checks (CR cites from memory, unverified). The round's templates are played in std-rb-scenarios.test.ts.
 *
 *   CR 602.5b, 120.1, 400.7     "Activate only if red sources you controlled dealt 4 or more noncombat damage this turn." (hole Cond, `happenedCount` sum)
 *   CR 614.1a, 608.2c, 702.170  "... exile that spell instead of putting it into your graveyard as it resolves. If you do, it becomes plotted."
 *                               (lower/conditions.ts#absorbIntoReplacement, `modify.then`)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { plottedTurn } from '../../../src/core/special/plot';
import { act, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
/** Answer the decisions until priority: payments automatic, targets in order, yes/no by `yes`, other choices the first allowed. */
function drive(s0: GameState, o: { targets?: Targets; yes?: boolean } = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const player = (id: PlayerId): { kind: 'player'; id: PlayerId } => ({ kind: 'player', id });
/** The activations of `source` p1 may take now (CR 602.5b: a restriction that does not hold leaves none). */
const activations = (s: GameState, source: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.action.type === 'activate' && a.action.source === source);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 602.5b, 120.1: "{T}: Draw a card. Activate only if red sources you controlled dealt 4 or more noncombat damage this turn."', () => {
  const ALTAR = card('Test Altar', 'Land', '{T}: Draw a card. Activate only if red sources you controlled dealt 4 or more noncombat damage this turn.');
  const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.', { colors: ['R'] });
  const FROST = card('Test Frost', 'Instant', 'Test Frost deals 2 damage to any target.', { colors: ['U'] });
  const defs = [ALTAR, SHOCK, FROST, BEAR];
  it('is understood: the damage of this turn from red sources you controlled, added up, is read as the ability is activated', () => {
    expect(noManual(ALTAR)).toBe(true);
    expect(JSON.stringify(ALTAR.faces)).toContain('"left":{"q":"happenedCount","event":{"ev":"damage","source":{"colors":["R"],"controller":"you"},"combat":false},"scope":"turn","sum":"amount"},"op":">=","right":4');
  });
  it('CR 120.1: 2 damage to a player and 2 to a creature add up to 4: it may be activated; after only 2 it may not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Shock', 'Test Shock'], battlefield: ['Test Altar'] }, p2: { battlefield: ['Test Bear'] } });
    const altar = find(s0, 'Test Altar', 'battlefield', 'p1');
    expect(activations(s0, altar)).toHaveLength(0);
    let s = cast(s0, 'Test Shock', { targets: [[player('p2')]] });
    expect(life(s, 'p2')).toBe(18);
    expect(activations(s, altar)).toHaveLength(0);
    s = cast(s, 'Test Shock', { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]] });
    expect(activations(s, altar).length).toBeGreaterThan(0);
  });
  it('CR 105.2: the damage of a blue source does not count, nor does a red source an opponent controlled', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Frost', 'Test Frost', 'Test Shock'], battlefield: ['Test Altar'] }, p2: { battlefield: ['Test Bear'] } });
    const altar = find(s0, 'Test Altar', 'battlefield', 'p1');
    let s = cast(s0, 'Test Frost', { targets: [[player('p2')]] });
    s = cast(s, 'Test Frost', { targets: [[player('p2')]] });
    expect(life(s, 'p2')).toBe(16);
    expect(activations(s, altar)).toHaveLength(0);
    // a red source p2 controlled dealt the damage: not "sources you controlled"
    const theirs = scenario([], { defs, p1: { battlefield: ['Test Altar'] }, p2: { hand: ['Test Shock', 'Test Shock'] } });
    theirs.history.push(...[1, 2].map(() => ({ turn: theirs.turn.number, ev: 'damage', actor: 'p1', facts: { amount: 2, combat: false, toPlayer: true, recipientPlayer: 'p1', 'source.colors': '|R|', 'source.controller': 'p2', 'source.id': 'x' } }) as never));
    expect(activations(theirs, find(theirs, 'Test Altar', 'battlefield', 'p1'))).toHaveLength(0);
  });
  it('CR 120.1a, 510.2: combat damage of a red source does not count as noncombat damage', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Altar'] } });
    s.history.push({ turn: s.turn.number, ev: 'damage', actor: 'p2', facts: { amount: 5, combat: true, toPlayer: true, recipientPlayer: 'p2', 'source.colors': '|R|', 'source.controller': 'p1', 'source.id': 'x' } } as never);
    expect(activations(s, find(s, 'Test Altar', 'battlefield', 'p1'))).toHaveLength(0);
  });
});

describe('CR 614.1a, 608.2c, 702.170c-d: "Whenever you cast an instant spell from your hand, exile that spell instead of putting it into your graveyard as it resolves. If you do, it becomes plotted."', () => {
  const DRIFTER = card('Test Drifter', 'Creature — Human Rogue', 'Whenever you cast an instant spell from your hand, exile that spell instead of putting it into your graveyard as it resolves. If you do, it becomes plotted.', { pt: ['2', '2'] });
  const SALVE = card('Test Salve', 'Instant', 'You gain 2 life.');
  const OATH = card('Test Oath', 'Sorcery', 'You gain 2 life.');
  const defs = [DRIFTER, SALVE, OATH];
  it('is understood: "if you do" is the replacement\'s move carried out, the body\'s `then`, on the card in exile', () => {
    expect(noManual(DRIFTER)).toBe(true);
    expect(JSON.stringify(DRIFTER.faces)).toContain('"body":{"b":"modify","destination":{"zone":"exile"},"then":{"as":"moved","do":[{"op":"designateObject","what":{"ref":"bound","name":"moved"},"designation":"plotted"}]}}');
  });
  it('CR 608.2n, 702.170d: the instant resolves, is exiled instead of going to the graveyard, and the card in exile is plotted this turn', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Salve'], battlefield: ['Test Drifter'] } });
    const s = cast(s0, 'Test Salve');
    expect(life(s, 'p1')).toBe(22);
    expect(findAll(s, 'Test Salve', 'graveyard')).toHaveLength(0);
    const exiled = find(s, 'Test Salve', 'exile', 'p1');
    expect(plottedTurn(s.objects[exiled]!)).toBe(s.turn.number);
  });
  it('CR 603.2: a sorcery does not trigger it: the sorcery goes to the graveyard and nothing is plotted', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Oath'], battlefield: ['Test Drifter'] } });
    const s = cast(s0, 'Test Oath');
    expect(findAll(s, 'Test Oath', 'graveyard')).toHaveLength(1);
    expect(findAll(s, 'Test Oath', 'exile')).toHaveLength(0);
  });
});
