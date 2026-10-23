/**
 * M6-4 (m6 design 3.6, 8.3 family D): the double-faced shapes the parser now reads (parser/templates/zz-m6/dfc.json, the werewolf conditions of
 * parser/holes/cond.ts), compiled by the default compiler (the game path) from fixture cards and invented text (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type OracleCard } from '../../../src/index';
import { gamePath } from '../../m5/cr-examples/helpers';

const abilities = (def: CardDef, face = 0): AbilityDef[] => def.faces[face]!.abilities;
const synthetic = (text: string, type_line = 'Creature — Werewolf'): CardDef =>
  compileCard({ name: 'Test Moon Howler', layout: 'normal', type_line, mana_cost: '{2}{G}', oracle_text: text, colors: ['G'], power: '2', toughness: '2' } as OracleCard);

describe('the Innistrad werewolves (CR 603.4: intervening "if" clauses over the previous turn, scope lastTurn)', () => {
  it('"if no spells were cast last turn" and "if a player cast two or more spells last turn" (the per-player maximum)', () => {
    const def = gamePath('Kruin Outlaw // Terror of Kruin Pass');
    expect(def.automation.level).toBe('full');
    expect(abilities(def, 0)[1]).toMatchObject({
      kind: 'triggered', trigger: { on: [{ ev: 'step', step: 'upkeep' }] }, interveningIf: { cond: 'not', of: { cond: 'happened', event: { ev: 'cast' }, scope: 'lastTurn' } },
      effect: { steps: [{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }] },
    });
    expect(abilities(def, 1)[2]).toMatchObject({
      kind: 'triggered', interveningIf: { cond: 'compare', left: { q: 'happenedCount', event: { ev: 'cast' }, scope: 'lastTurn', per: 'player' }, op: '>=', right: 2 },
    });
  });

  it('"Whenever this creature enters or transforms into ~" and "Whenever this creature transforms into ~" (CR 701.27e)', () => {
    const def = gamePath('Huntmaster of the Fells // Ravager of the Fells');
    expect(abilities(def, 0)[0]).toMatchObject({
      kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, { ev: 'becomes', what: 'transformed', object: { self: true } }] },
    });
    expect(def.automation.faces![0]!.abilities.map((a) => a.level)).toEqual(['full', 'full']); // (the experimental template caps the CARD at partial, design 6.9)
    expect(abilities(def, 1)[1]).toMatchObject({ kind: 'triggered', trigger: { on: [{ ev: 'becomes', what: 'transformed', object: { self: true } }] } });
  });
});

describe('family D effects', () => {
  it('"Exile ~, then return it to the battlefield transformed under your control" (and under its owner\'s control; tapped and transformed)', () => {
    const mine = abilities(synthetic('{2}{G}: Exile this creature, then return it to the battlefield transformed under your control.'))[0]!;
    expect(mine).toMatchObject({ kind: 'activated' });
    const steps = (mine as Extract<AbilityDef, { kind: 'activated' }>).effect.steps;
    expect(steps.at(-1)).toMatchObject({ op: 'move', to: { zone: 'battlefield', controller: { ref: 'you' }, transformed: true } });
    const owner = abilities(synthetic('When this creature dies, exile it, then return it to the battlefield transformed under its owner\'s control.'))[0]!;
    expect((owner as Extract<AbilityDef, { kind: 'triggered' }>).effect.steps.at(-1)).toMatchObject({ op: 'move', to: { zone: 'battlefield', controller: 'owner', transformed: true } });
    const tapped = abilities(synthetic('When this creature dies, return it to the battlefield tapped and transformed under its owner\'s control.'))[0]!;
    expect((tapped as Extract<AbilityDef, { kind: 'triggered' }>).effect.steps.at(-1)).toMatchObject({ op: 'move', to: { zone: 'battlefield', controller: 'owner', tapped: true, transformed: true } });
  });

  it('"convert ~" (CR 701.28a), "flip it" (CR 710) and the Kamigawa ki-counter condition', () => {
    expect(abilities(synthetic('{2}: Convert this creature.'))[0]).toMatchObject({ kind: 'activated', effect: { steps: [{ op: 'changeFace', what: { ref: 'self' }, to: 'convert' }] } });
    const akki = gamePath('Akki Lavarunner // Tok-Tok, Volcano Born');
    expect(abilities(akki, 0)[1]).toMatchObject({ kind: 'triggered', effect: { steps: [{ op: 'changeFace', what: { ref: 'event', role: 'source' }, to: 'flip' }] } }); // "it": the source of the damage, this creature
    const ki = abilities(synthetic('At the beginning of the end step, if there are two or more ki counters on this creature, you may flip it.'))[0]!;
    expect(ki).toMatchObject({ kind: 'triggered', interveningIf: { cond: 'compare', left: { q: 'counters', on: { ref: 'self' }, kind: 'ki' }, op: '>=', right: 2 } });
  });

  it('a near miss is not read: "if one player cast a spell last turn" and "if no spells were cast this turn, transform" stay as M5 read them or manual', () => {
    const near = abilities(synthetic('At the beginning of each upkeep, if a player cast two spells last turn, transform this creature.'))[0]!;
    expect(near.kind).toBe('manual'); // "two" without "or more" is not "at least two"
  });
});
