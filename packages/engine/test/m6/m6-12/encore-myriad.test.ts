/**
 * M6-12: encore (CR 702.141) and myriad (CR 702.116) as keyword data on M6-2's token copies, on real fixture cards (game path): Fin-Clade Fugitives
 * ("This creature can't be blocked by creatures with power 2 or less. / Encore {4}{G}") and Goldlust Triad ("Flying / Myriad / Whenever this creature deals
 * combat damage to a player, create a Treasure token.").
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, type AbilityDef, type DeclareAttackersDecision, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { makeCtx } from '../../../src/effects/ctx';
import { resolvePlayers } from '../../../src/effects/refs';
import { getCard } from '../../fixtures';
import { act, answer, find, pass, scenario } from '../../m5/helpers';
import { activate, drive, equivalent, resolveTop } from '../../m5/cr-examples/helpers';
import { lifeOf, passUntil, toDeclareAttackers } from '../../m4/helpers';

const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
const attacks = (s: GameState, pairs: [ObjectId, PlayerId | ObjectId][]) => ({
  type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: pairs.map(([attacker, defender]) => ({ attacker, defender })) },
});

describe('CR 702.141: encore', () => {
  it('keyword:encore and feature:require.player.attack are capabilities; Fin-Clade Fugitives is full', () => {
    expect(ENGINE_CAPABILITIES.has('feature:require.player.attack')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:encore')).toBe(true);
    expect(compileCard(getCard('Fin-Clade Fugitives')).automation.level).toBe('full');
  });

  /** Encore Fin-Clade Fugitives from p1's graveyard ({4}{G}, as a sorcery), with `p2` on Bob's battlefield. */
  function encore(p2: (string | { name: string; counters: Record<string, number> })[] = []): { s: GameState; token: ObjectId } {
    let s = scenario(['Fin-Clade Fugitives', 'Forest', 'Oko, Thief of Crowns'], { p1: { graveyard: ['Fin-Clade Fugitives'], battlefield: Array(5).fill('Forest') as string[] }, p2: { battlefield: p2 } });
    s = resolveTop(activate(s, find(s, 'Fin-Clade Fugitives', 'graveyard')));
    return { s, token: tokens(s)[0]! };
  }

  it('CR 702.141a: for the one opponent, a token copy with haste that must attack that opponent this turn', () => {
    const { s, token } = encore();
    expect(tokens(s)).toHaveLength(1);
    const c = getChars(s, token);
    expect([c.name, c.power, c.toughness]).toEqual(['Fin-Clade Fugitives', '7', '4']);
    expect(c.keywords.map((k) => k.keyword)).toContain('haste');
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Fin-Clade Fugitives']); // the cost (CR 118.3)
    const t = toDeclareAttackers(s);
    const d = t.pending as DeclareAttackersDecision;
    expect(d.requirements).toEqual([expect.objectContaining({ kind: 'attack', creature: token, among: ['p2'] })]);
    expect(() => act(t, attacks(t, []))).toThrow(/CR 508\.1d/); // CR 508.1d: not attacking obeys none of the requirements
    const after = act(t, attacks(t, [[token, 'p2']]));
    expect(after.combat?.attackers.map((a) => [a.id, a.defender])).toEqual([[token, 'p2']]);
  });

  it('CR 508.1d, 702.141a: attacking a planeswalker that opponent controls does not obey "attacks that opponent"', () => {
    const { s, token } = encore([{ name: 'Oko, Thief of Crowns', counters: { loyalty: 4 } }]);
    const t = toDeclareAttackers(s);
    const oko = find(t, 'Oko, Thief of Crowns', 'battlefield');
    expect(() => act(t, attacks(t, [[token, oko]]))).toThrow(/CR 508\.1d/);
    expect(act(t, attacks(t, [[token, 'p2']])).turn.step).not.toBe('main1');
  });

  it('CR 702.141a, 603.7: the token is sacrificed at the beginning of the next end step', () => {
    const { s, token } = encore();
    let t = toDeclareAttackers(s);
    t = act(t, attacks(t, [[token, 'p2']]));
    t = passUntil(t, (x) => x.turn.step === 'end' && x.zones.stack.length === 0 && x.pending?.kind === 'priority' && !x.objects[token], 'the end step sacrifice', 80);
    expect(tokens(t)).toEqual([]);
    expect(lifeOf(t, 'p2')).toBe(13);
  });

  it('CR 702.141a: "Activate only as a sorcery" and only from the graveyard', () => {
    const s = scenario(['Fin-Clade Fugitives', 'Forest'], { p1: { hand: ['Fin-Clade Fugitives'], battlefield: Array(5).fill('Forest') as string[] } });
    expect(() => activate(s, find(s, 'Fin-Clade Fugitives', 'hand'))).toThrow(/no activation/);
    const t = pass(scenario(['Fin-Clade Fugitives', 'Forest'], { p1: { graveyard: ['Fin-Clade Fugitives'], battlefield: Array(5).fill('Forest') as string[] } }));
    expect(t.pending?.player).toBe('p2');
  });
});

describe('CR 702.116: myriad', () => {
  it('keyword:myriad is a capability; Goldlust Triad is full', () => {
    expect(ENGINE_CAPABILITIES.has('ref:otherOpponents')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:myriad')).toBe(true);
    expect(compileCard(getCard('Goldlust Triad')).automation.level).toBe('full');
  });

  it('CR 702.116a, 506.2: in a two-player game the only opponent is the defending player: myriad triggers and creates no token', () => {
    let s = scenario(['Goldlust Triad'], { p1: { battlefield: ['Goldlust Triad'] } });
    const triad = find(s, 'Goldlust Triad', 'battlefield');
    s = toDeclareAttackers(s);
    s = act(s, attacks(s, [[triad, 'p2']]));
    expect(s.zones.stack.map((id) => s.objects[id]!.stack?.kind)).toEqual(['triggered']); // CR 603.2: it triggers
    s = resolveTop(s);
    expect(s.pending?.kind).toBe('priority'); // "you may": no opponent other than the defending player, so nothing to choose
    expect(tokens(s)).toEqual([]);
  });

  it('ref:otherOpponents: the opponents of the controller other than the defending players (CR 506.2); outside combat, every opponent', () => {
    const s = scenario(['Goldlust Triad'], { p1: { battlefield: ['Goldlust Triad'] } });
    const run = (st: GameState): PlayerId[] => resolveRefFor(st, find(st, 'Goldlust Triad', 'battlefield'));
    expect(run(s)).toEqual(['p2']);
    let t = toDeclareAttackers(s);
    t = act(t, attacks(t, [[find(t, 'Goldlust Triad', 'battlefield'), 'p2']]));
    expect(run(t)).toEqual([]);
  });

  it('CR 508.4, 702.116a: a token copy "attacking that player or a planeswalker they control" offers the player and their planeswalkers', () => {
    const copyStep: AbilityDef = {
      kind: 'spell', text: 'test',
      effect: {
        targets: [{ id: 'c', kind: 'object', text: 'target creature you control', filter: { types: ['Creature'], controller: 'you' }, min: 1, max: 1 }],
        steps: [{ op: 'copy', what: { ref: 'target', id: 'c' }, result: 'token', who: { ref: 'you' }, tapped: true, attacking: { defender: { ref: 'anOpponent' }, orPlaneswalkers: true } }],
      },
    };
    const spell = equivalent({ name: 'Test Copy Attacker', type_line: 'Instant', mana_cost: '{0}' }, [copyStep]);
    let s = scenario(['Grizzly Bears', 'Oko, Thief of Crowns'], { p1: { battlefield: ['Grizzly Bears'], hand: ['Test Copy Attacker'] }, p2: { battlefield: [{ name: 'Oko, Thief of Crowns', counters: { loyalty: 4 } }] }, defs: [spell] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toDeclareAttackers(s);
    s = act(s, attacks(s, [[bears, 'p2']]));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Copy Attacker', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }]);
    s = resolveTop(s);
    expect(s.pending?.kind).toBe('chooseOption');
    const oko = find(s, 'Oko, Thief of Crowns', 'battlefield');
    expect(s.pending?.kind === 'chooseOption' ? s.pending.options.map((o) => o.id).sort() : []).toEqual([oko, 'p2'].sort());
    s = answer(s, { kind: 'chooseOption', ids: [oko] });
    const tok = tokens(s)[0]!;
    expect(s.combat?.attackers.find((a) => a.id === tok)?.defender).toBe(oko);
    expect(s.objects[tok]!.tapped).toBe(true);
  });
});

/** `{ref:'otherOpponents'}` as the interpreter resolves it for an ability of `source` controlled by p1. */
function resolveRefFor(s: GameState, source: ObjectId): PlayerId[] {
  const g = new Game(structuredClone(s));
  const cx = makeCtx(g, g.obj(source), { targets: [], steps: [] });
  return resolvePlayers(cx, { ref: 'otherOpponents' });
}
