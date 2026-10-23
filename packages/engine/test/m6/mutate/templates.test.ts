/**
 * M6-9 (m6 design 3.7, 5 "M6-9"): the trigger templates "Whenever this creature mutates" and "Whenever a creature you control mutates" (CR 702.140d,
 * parser/templates/zz-m6/merge.json), compiled by the default compiler (the game path) from the fixture card and invented text (design 6.10), and the
 * `becomes mutated` event they wait for.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type OracleCard } from '../../../src/index';
import { gamePath } from '../../m5/cr-examples/helpers';
import { ELVES, GEMRAZER, OVER, find, mutate, resolveTop, table } from './support';

const synthetic = (text: string, type_line = 'Creature — Beast'): CardDef =>
  compileCard({ name: 'Test Ridgeback', layout: 'normal', type_line, mana_cost: '{2}{G}', oracle_text: text, colors: ['G'], power: '2', toughness: '2' } as OracleCard);

describe('CR 702.140d: "whenever ... mutates"', () => {
  it('Gemrazer: "Whenever this creature mutates, destroy target artifact or enchantment an opponent controls." is a full trigger on becomes mutated', () => {
    const def = gamePath(GEMRAZER);
    expect(def.automation.level).toBe('full');
    expect(def.faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'mutate', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'G' }, { kind: 'colored', color: 'G' }] } });
    expect(def.faces[0]!.abilities.at(-1)).toMatchObject({
      kind: 'triggered', trigger: { on: [{ ev: 'becomes', what: 'mutated', object: { self: true } }] },
      effect: { targets: [{ filter: { types: ['Artifact', 'Enchantment'], controller: 'opponent' } }], steps: [{ op: 'destroy' }] },
    });
  });

  it('"Whenever a creature you control mutates, you gain 2 life." reads the creatures you control; a near miss is not read', () => {
    const a = synthetic('Whenever a creature you control mutates, you gain 2 life.').faces[0]!.abilities[0]!;
    expect(a).toMatchObject({ kind: 'triggered', trigger: { on: [{ ev: 'becomes', what: 'mutated', object: { types: ['Creature'], controller: 'you' } }] } });
    const near = synthetic('Whenever a creature an opponent controls mutates, you gain 2 life.').faces[0]!.abilities[0]!;
    expect((near as AbilityDef).kind === 'triggered' && JSON.stringify(near).includes('"controller":"you"')).toBe(false);
  });

  it('the event: a creature you control that mutates triggers "whenever a creature you control mutates" once', () => {
    const watcher = { ...synthetic('Whenever a creature you control mutates, you gain 2 life.', 'Enchantment'), id: 'Test Ridgeback', name: 'Test Ridgeback' } as CardDef;
    let s = table([ELVES, 'Test Ridgeback'], { defs: [watcher] });
    const life = s.players[0]!.life;
    s = resolveTop(mutate(s, find(s, ELVES, 'battlefield')), [OVER]);
    while (s.zones.stack.length > 0) s = resolveTop(s);
    expect(s.players[0]!.life).toBe(life + 2);
  });
});
