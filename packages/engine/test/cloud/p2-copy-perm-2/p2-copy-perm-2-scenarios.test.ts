/**
 * Lane p2-copy-perm, round p2-copy-perm-2: the renderer fix render/np.ts (the chosen type said before "that entered this turn", family chosen-before-entered),
 * played through the engine with a synthetic card compiled by the game's default compiler (invented name and wording, design 6.10). CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 607.2d, 400.7, 707.2   "for each token you control of the chosen type that entered this turn, create a token that's a copy of it": only tokens of the
 *                              type chosen as it entered, and only those that entered this turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card as oracle, fullyAutomated } from '../../m5/templates/support';
import { advanceTo, answer, castAuto, pass, scenario } from '../../m3/scenario';

const TEXT = 'As this enchantment enters, choose a creature type.\nAt the beginning of your end step, for each token you control of the chosen type that entered this turn, create a token that\'s a copy of it.';

describe('p2-copy-perm-2 renderer (render/np.ts; CR 607.2d, 400.7): "of the chosen type that entered this turn" passes the gate', () => {
  const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
  it('in Oracle\'s order and in the other order the description is fully automated; another relative clause is not the same JSON', () => {
    const a = parseCard(oracle('Example Totem', 'Enchantment', TEXT), OPTS).faces[0]!;
    expect(fullyAutomated(a), JSON.stringify(a.gate)).toBe(true);
    const b = parseCard(oracle('Example Totem', 'Enchantment', TEXT.replace('of the chosen type that entered this turn', 'that entered this turn of the chosen type')), OPTS).faces[0]!;
    expect(fullyAutomated(b), JSON.stringify(b.gate)).toBe(true);
    const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v);
    const over = (f: typeof a) => JSON.stringify(sorted((f.abilities[1] as { effect: { steps: { over?: unknown }[] } }).effect.steps[0]!.over));
    expect(over(b)).toBe(over(a));
    const c = parseCard(oracle('Example Totem', 'Enchantment', TEXT.replace('that entered this turn', 'that attacked this turn')), OPTS).faces[0]!;
    expect(JSON.stringify(c.abilities[1])).not.toBe(JSON.stringify(a.abilities[1]));
  });
});

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const TOTEM = card('Test Totem', 'Enchantment', TEXT);
const ELF_MAKER = card('Test Elf Maker', 'Sorcery', 'Create a 1/1 green Elf creature token and a 1/1 green Goblin creature token.');
const defs = [TOTEM, ELF_MAKER];
const names = (s: GameState): string[] => s.zones.battlefield.map((id: ObjectId) => getChars(s, id).subtypes.join(' ')).filter((x) => x !== '').sort();

/** Resolve the stack, answering the type choice with `pick`. */
function resolve(s0: GameState, pick: string): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending!;
    if (p.kind === 'priority') s = pass(s);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: pick });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options.find((o) => o.label === pick || o.id === pick)!.id] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}

describe('CR 607.2d, 400.7, 707.2: "for each token you control of the chosen type that entered this turn, create a token that\'s a copy of it"', () => {
  it('is fully automated', () => expect(TOTEM.automation.level).toBe('full'));
  it('Elf chosen: at your end step the Elf token made this turn is copied, the Goblin token is not', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Totem', 'Test Elf Maker'] } });
    s = resolve(castAuto(s, 'Test Totem'), 'Elf');
    s = resolve(castAuto(s, 'Test Elf Maker'), 'Elf');
    expect(names(s)).toEqual(['Elf', 'Goblin']);
    s = resolve(advanceTo(s, s.turn.number, 'end'), 'Elf');
    expect(names(s)).toEqual(['Elf', 'Elf', 'Goblin']);
  });
});
