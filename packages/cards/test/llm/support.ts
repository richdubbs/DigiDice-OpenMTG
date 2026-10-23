/**
 * Test support for the LLM compile tool (WP26). NO real model is ever called: `mockModel` replays scripted replies. "Parser" sources with NO templates
 * stand in for a parser that leaves a line manual; the correct reply for those lines is the game path's own JSON (it passed the parser's gates).
 */
import {
  ENGINE_CAPABILITIES, compileCardDetailed, defaultCompileSources, defaultParseOptions, type AbilityDef, type CompileSources, type OracleCard,
} from '@openmtg/engine';
import { fixtureCards } from '../../src/coverage/corpus';
import { promptAbility } from '../../src/llm/prompt';
import type { LlmClient, LlmReply, LlmRequest } from '../../src/llm/types';
import type { CardWork } from '../../src/llm/work';

let bare: CompileSources | undefined;
/** A parser that knows no template: every line that is not a keyword or a milestone 3/4 recognizer line stays manual. */
export const bareSources = (): CompileSources => (bare ??= defaultCompileSources({ parse: defaultParseOptions({ templates: [], capabilities: ENGINE_CAPABILITIES }) }));

let fixtures: OracleCard[] | undefined;
/**
 * An invented card (design 6.10) whose trigger clause no template reads, so the parser keeps a manual node for its only line. M6-4: the card-text tests used
 * Huntmaster of the Fells for this, whose werewolf lines parse now.
 */
export const manualTriggerCard = (): OracleCard =>
  ({ name: 'Test Grumbler', layout: 'normal', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', oracle_text: 'Whenever Test Grumbler snorkels a quux, you gain 1 life.', power: '3', toughness: '3', colors: ['R'], oracle_id: 'test-grumbler' }) as unknown as OracleCard;

export function fixture(name: string): OracleCard {
  fixtures ??= fixtureCards();
  const c = fixtures.find((x) => x.name === name);
  if (!c) throw new Error(`no fixture card ${name}`);
  return c;
}

export function synth(id: string, name: string, typeLine: string, text: string, extra: Partial<OracleCard> = {}): OracleCard {
  const c = { name, layout: 'normal', type_line: typeLine, oracle_text: text, mana_cost: '{1}{R}', cmc: 2, colors: ['R'], keywords: [], oracle_id: id, ...extra } as OracleCard;
  if (/\bCreature\b/.test(typeLine) && c.power === undefined) Object.assign(c, { power: '2', toughness: '2' });
  return c;
}

/** The game path's abilities for the needed lines of `work`, as a reply object (optionally changed by `edit`). */
export function goodReplyObject(work: CardWork): { faces: { abilities: Record<string, unknown>[] }[] } {
  const { def } = compileCardDetailed(work.card, defaultCompileSources());
  return {
    faces: def.faces.map((f, i) => {
      const needed = new Set(work.faces.find((w) => w.face === i)?.units.flatMap((u) => u.src) ?? []);
      return { abilities: f.abilities.filter((a: AbilityDef) => (a.src ?? []).length > 0 && (a.src ?? []).every((l) => needed.has(l))).map((a) => promptAbility(a) as Record<string, unknown>) };
    }),
  };
}

export const goodReply = (work: CardWork, edit?: (o: ReturnType<typeof goodReplyObject>) => void): string => {
  const o = goodReplyObject(work);
  edit?.(o);
  return JSON.stringify(o);
};

export type Scripted = string | { refusal: true } | { text: string; stopReason: string } | { error: string } | ((req: LlmRequest) => string);

/** A scripted model client: one reply per call, in order; records every request. Throws when the script runs out, or for a scripted `error`. */
export function mockModel(script: Scripted[]): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req: LlmRequest): Promise<LlmReply> {
      requests.push(req);
      // the real API refuses an empty assistant turn that is not the last message (HTTP 400)
      if (req.messages.some((m, i) => m.role === 'assistant' && m.content.trim() === '' && i < req.messages.length - 1)) throw new Error('400: empty assistant content');
      const next = script.shift();
      if (next === undefined) throw new Error('mock model: no scripted reply left');
      const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };
      if (typeof next === 'object' && 'refusal' in next) return { text: '', model: req.model, usage, stopReason: 'refusal' };
      if (typeof next === 'object' && 'error' in next) throw new Error(next.error);
      if (typeof next === 'object') return { text: next.text, model: req.model, usage, stopReason: next.stopReason };
      return { text: typeof next === 'function' ? next(req) : next, model: req.model, usage, stopReason: 'end_turn' };
    },
  };
}
