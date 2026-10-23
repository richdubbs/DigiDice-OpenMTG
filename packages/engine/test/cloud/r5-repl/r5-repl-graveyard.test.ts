/**
 * Cloud r5-repl (Standard round 5: replacement and prevention effects): "If a card you didn't control would be put into an opponent's graveyard from anywhere,
 * exile it instead.", played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each
 * test is named after the rule it checks.
 *
 *   CR 614.1a, 400.3          an opponent's card goes to exile instead of its owner's graveyard, from the battlefield or from a hand
 *   CR 108.4, 108.4a          a card of theirs you controlled (a permanent you gained control of) is not one "you didn't control"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') });
  for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) });
    else throw new Error(`unexpected decision ${s.pending.kind}`);
  }
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) {
    s = pass(pass(s));
    for (let j = 0; j < 6 && s.pending && s.pending.kind === 'chooseObjects'; j++) s = answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) });
  }
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

const EATER = card('Test Eater', 'Creature — Horror', 'If a card you didn\'t control would be put into an opponent\'s graveyard from anywhere, exile it instead.', { pt: ['4', '4'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
const PRY = card('Test Pry', 'Sorcery', 'Target opponent discards a card.');

describe('Cloud r5-repl: "If a card you didn\'t control would be put into an opponent\'s graveyard from anywhere, exile it instead." (CR 614.1a, 108.4a)', () => {
  it('is automated', () => {
    for (const d of [EATER, SLAY, PRY]) expect(full(d), d.name).toBe(true);
  });
  it('CR 614.1a: an opponent\'s creature that dies is exiled instead', () => {
    let s = scenario([], { defs: [EATER, BEAR, SLAY], p1: { hand: ['Test Slay'], battlefield: ['Test Eater'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Slay', [obj(find(s, 'Test Bear', 'battlefield'))]);
    expect(findAll(s, 'Test Bear', 'graveyard')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'exile')).toHaveLength(1);
  });
  it('CR 614.1a, 108.4a: a card an opponent discards (no one controls a card in a hand) is exiled instead', () => {
    let s = scenario([], { defs: [EATER, BEAR, PRY], p1: { hand: ['Test Pry'], battlefield: ['Test Eater'] }, p2: { hand: ['Test Bear'] } });
    s = cast(s, 'Test Pry', [{ kind: 'player', id: 'p2' }]);
    expect(findAll(s, 'Test Bear', 'hand')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'exile')).toHaveLength(1);
  });
  it('CR 108.4: an opponent\'s creature you controlled goes to its owner\'s graveyard', () => {
    let s = scenario([], { defs: [EATER, BEAR, SLAY], p1: { hand: ['Test Slay'], battlefield: ['Test Eater'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = { ...s, objects: { ...s.objects, [bear]: { ...s.objects[bear]!, controller: 'p1' } } }; // gained control of it (test setup)
    s = cast(s, 'Test Slay', [obj(bear)]);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1);
  });
  it('CR 614.1a: your own cards go to your graveyard as usual', () => {
    let s = scenario([], { defs: [EATER, BEAR, SLAY], p1: { hand: ['Test Slay'], battlefield: ['Test Eater', 'Test Bear'] } });
    s = cast(s, 'Test Slay', [obj(find(s, 'Test Bear', 'battlefield'))]);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Slay', 'graveyard', 'p1')).toHaveLength(1);
  });
});
