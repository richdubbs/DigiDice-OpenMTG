/**
 * M6-8: "target spell or permanent" (CR 115.1, 612.1), the target of every text-changing spell, read by the Obj hole (parser/holes/object.ts) as ONE target of
 * kind `object` whose filter is `{zone: ['stack', 'battlefield']}`: a spell (a card or a copy on the stack, never an ability) or a permanent. Synthetic cards
 * compiled by the default compiler from invented text (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type OracleCard, type TargetSpec } from '../../../src/index';
import { targetOptions } from '../../../src/rules/targets';
import { activate, cast, find, islands, resolveTop, scenario, target } from './support';

const recall: CardDef = compileCard({ name: 'Test Recall', layout: 'normal', type_line: 'Instant', mana_cost: '{U}', oracle_text: "Return target spell or permanent to its owner's hand.", colors: ['U'] } as OracleCard);
const bleach: CardDef = compileCard({ name: 'Test Bleach', layout: 'normal', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Target spell or permanent becomes white until end of turn.', colors: ['U'] } as OracleCard);

describe('CR 115.1: "target spell or permanent"', () => {
  it('is one target of kind object on the stack or the battlefield, and the sentence is full', () => {
    expect(recall.automation.level).toBe('full');
    const spell = recall.faces[0]!.abilities[0] as { effect: { targets: unknown[] } };
    expect(spell.effect.targets).toEqual([{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target spell or permanent', filter: { zone: ['stack', 'battlefield'] } }]);
  });

  it('a spell and a permanent are legal targets; an ability on the stack and a card in a graveyard are not', () => {
    let s: GameState = scenario(['Grizzly Bears', 'Llanowar Elves', 'Prodigal Pyromancer', 'Forest', 'Island'], {
      p1: { hand: ['Test Recall', 'Grizzly Bears'], battlefield: [...islands(1), 'Forest', 'Forest', 'Prodigal Pyromancer'], graveyard: ['Llanowar Elves'] },
      p2: { battlefield: ['Llanowar Elves'] },
      defs: [recall],
    });
    s = cast(s, 'Grizzly Bears');
    const bears = s.zones.stack[0]!;
    s = activate(s, find(s, 'Prodigal Pyromancer', 'battlefield'), [target('p2')]);
    const ability = s.zones.stack[1]!;
    expect(s.objects[ability]!.kind).toBe('ability');
    const spec = (recall.faces[0]!.abilities[0] as unknown as { effect: { targets: TargetSpec[] } }).effect.targets[0]!;
    const opts = targetOptions(s, spec, 'p1').objects;
    expect(opts).toContain(bears);
    expect(opts).toContain(find(s, 'Llanowar Elves', 'battlefield', 'p2'));
    expect(opts).not.toContain(ability);
    expect(opts).not.toContain(find(s, 'Llanowar Elves', 'graveyard', 'p1'));
    s = resolveTop(s); // the ability
    s = cast(s, 'Test Recall', [target(bears)]);
    s = resolveTop(s);
    expect(s.objects[find(s, 'Grizzly Bears', 'hand', 'p1')]).toBeDefined(); // the spell went back to its owner's hand
    expect(s.zones.stack).toEqual([]);
  });

  it('CR 400.7a: an effect that changes a permanent spell\'s characteristics applies to the permanent it becomes', () => {
    let s: GameState = scenario(['Grizzly Bears', 'Forest', 'Island'], { p1: { hand: ['Test Bleach', 'Grizzly Bears'], battlefield: [...islands(1), 'Forest', 'Forest'] }, defs: [bleach] });
    s = cast(s, 'Grizzly Bears');
    const spell = s.zones.stack[0]!;
    s = resolveTop(cast(s, 'Test Bleach', [target(spell)]));
    expect(getChars(s, spell).colors).toEqual(['W']);
    s = resolveTop(s);
    expect(getChars(s, find(s, 'Grizzly Bears', 'battlefield')).colors).toEqual(['W']);
  });
});
