/**
 * Phase 2 lane p2-mana, round p2-mana-2: the round's engine concept played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 700.5, 106.1, 605.1a   "{T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.": a mana ability (no stack); the
 *                             controller chooses one of the five colors as it resolves, then adds that many units of it (effects/handlers/cards-mana.ts,
 *                             ManaProduction `devotionColor`)
 */
import { describe, expect, it } from 'vitest';
import { act, answer, find, scenario } from '../../m3/scenario';
import { compileCard, legalActions, type CardDef, type GameState, type ManaType, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const poolOf = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');

const SHRINE = card('Test Votive Shrine', 'Land', '{T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.');
const BEAR = card('Test Moss Bear', 'Creature — Bear', '', ['2', '2'], '{G}{G}');
const CHARM = card('Test Hybrid Charm', 'Enchantment', '', undefined, '{1}{G/U}');
const OTHER = card('Test Rival Elk', 'Creature — Elk', '', ['2', '2'], '{G}{G}{G}');

/** p1 controls the shrine, a {G}{G} creature and a {1}{G/U} enchantment (devotion: green 3, blue 1); p2 controls a {G}{G}{G} creature. */
function tap(color: ManaType): { s: GameState; options: string[] } {
  const s0 = scenario([], {
    p1: { battlefield: [{ name: 'Test Votive Shrine' }, { name: 'Test Moss Bear' }, { name: 'Test Hybrid Charm' }] },
    p2: { battlefield: [{ name: 'Test Rival Elk' }] },
    defs: [SHRINE, BEAR, CHARM, OTHER],
  });
  const id = find(s0, 'Test Votive Shrine', 'battlefield', 'p1');
  const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === id);
  if (!a) throw new Error('no mana ability offered');
  let s = act(s0, a.action);
  const d = s.pending as unknown as { kind: string; options?: string[] };
  expect(d.kind).toBe('chooseColor');
  const options = [...(d.options ?? [])].sort();
  s = answer(s, { kind: 'chooseColor', color });
  expect(s.zones.stack.length).toBe(0);
  return { s, options };
}

describe('CR 700.5, 106.1, 605.1a: "Choose a color. Add an amount of mana of that color equal to your devotion to that color." (ManaProduction devotionColor)', () => {
  it('is parsed and automated', () => {
    expect(automated(SHRINE)).toBe(true);
    expect(JSON.stringify(SHRINE.faces[0]!.abilities)).toContain('"dynamic":{"kind":"devotionColor","of":{"ref":"you"}}');
  });
  it('the five colors are offered; green: {G}{G}{G} (hybrid {G/U} counts toward green, CR 700.5; the opponent\'s permanents never count)', () => {
    const { s, options } = tap('G');
    expect(options).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(poolOf(s)).toBe('GGG');
  });
  it('blue: {U} (the hybrid symbol counts toward each of its colors)', () => {
    expect(poolOf(tap('U').s)).toBe('U');
  });
  it('a color with no devotion: no mana', () => {
    expect(poolOf(tap('R').s)).toBe('');
  });
});
