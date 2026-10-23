/**
 * Helpers for the PUSH1 T1 tests (templates for keyword actions and typecycling, parser/templates/zz-push/t1.json): the T1 templates, parse options with the
 * game's whole template set and the engine's capabilities (what a decklist card gets), and a comparison key without display fields.
 */
import type { AbilityDef } from '../../../src/types/ability';
import type { FaceParse, ParseOptions, Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import t1 from '../../../src/parser/templates/zz-push/t1.json';
import { card, exampleCard } from '../templates/support';

export { automated, card, exampleCard, fullyAutomated, jsonKey, localIndex } from '../templates/support';

/** The T1 templates. */
export const T1_TEMPLATES: readonly Template[] = Object.freeze(t1 as Template[]);

/** The game path: every committed template (T1's included) and the engine's own capability set. */
export const OPTS: ParseOptions = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** The first face of the parse of a synthetic card in which the text is an ability of the template's kind. */
export const parsedWith = (t: Template, text: string, opts: ParseOptions = OPTS): FaceParse => parseCard(exampleCard(t, text), opts).faces[0]!;

/** The first face of a synthetic card of the given type line. */
export const faceOf = (typeLine: string, text: string, opts: ParseOptions = OPTS): FaceParse => parseCard(card('Example Thing', typeLine, text), opts).faces[0]!;

type Rec = Record<string, unknown>;
/** Abilities without display fields (`text`, `src`, `prov`, `span`, `sentence`): what an example's `expect` states. */
export function plain(defs: readonly AbilityDef[]): unknown[] {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Rec = {};
    for (const [k, x] of Object.entries(v as Rec)) if (!['text', 'src', 'prov', 'span', 'sentence'].includes(k)) out[k] = strip(x);
    return out;
  };
  return defs.map(strip);
}
