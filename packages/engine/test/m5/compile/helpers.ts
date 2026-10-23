/** Helpers for the compile pipeline tests (WP18). */
import { compileCardDetailed, defaultCompileSources, type AbilityDef, type CardDef, type CompileReport, type CompileSources, type OracleCard } from '../../../src/index';

/** A synthetic single-faced card (test data hygiene, design 6.10: invented names and minimal wordings). */
export function card(text: string, over: Partial<OracleCard> = {}): OracleCard {
  return { name: 'Test Card', oracle_id: '00000000-0000-4000-8000-000000000001', layout: 'normal', type_line: 'Instant', mana_cost: '{1}{R}', oracle_text: text, ...over } as OracleCard;
}

export function creature(text: string, over: Partial<OracleCard> = {}): OracleCard {
  return card(text, { type_line: 'Creature — Test', power: '2', toughness: '2', ...over });
}

export function compile(c: OracleCard, over: Partial<CompileSources> = {}): { def: CardDef; report: CompileReport } {
  return compileCardDetailed(c, defaultCompileSources(over));
}

export const kinds = (def: CardDef, face = 0): string[] => def.faces[face]!.abilities.map((a) => a.kind);
export const abilities = (def: CardDef, face = 0): AbilityDef[] => def.faces[face]!.abilities;
