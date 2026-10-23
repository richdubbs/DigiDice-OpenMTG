/** JSON to canonical English: the dispatch over ability kinds (design 2.1 principle 8). A pure function of the JSON ALONE. Owner: WP2. Contract: render/api.ts#RenderAbility. */
import type { RenderAbility, RenderContext } from './api';
import './boot';
import { matchedReading } from './gate';
import { checkAbility } from './guard';
import { K } from './kernel';
import { newState } from './state';
import { capFirst, firstAlt, NoRenderer } from './text';

/** Splits display text into sentences: at ". " outside quotes, and before every bullet. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quotes = 0;
  const flush = (): void => {
    const t = cur.trim();
    if (t !== '') out.push(t);
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quotes++;
    if (ch === '\u2022' && quotes % 2 === 0) flush();
    cur += ch;
    if (ch === '.' && quotes % 2 === 0 && text[i + 1] === ' ' && /[A-Za-z{"\u2022I]/.test(text[i + 2] ?? '')) flush();
  }
  flush();
  return out;
}

/** Display form of one sentence: capital letters where Oracle has them (sentence start, after a cost colon or a chapter dash). */
function polish(sentence: string): string {
  let s = capFirst(sentence);
  s = s.replace(/(: |-- |\u2022 | ")([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  return s;
}

/** The display text of a rendered ability: the first option of every group, the card's name for "~". */
export function display(marked: string, ctx: RenderContext): string[] {
  const name = ctx.selfNames[0];
  let text = firstAlt(marked);
  if (name !== undefined) text = text.replace(/~/g, name).replace(/¤/g, name); // r4-static: "¤", the outer card's name inside a quoted ability (refs.ts, grantor)
  return splitSentences(text.replace(/\s+/g, ' ').trim()).map(polish);
}

export const renderAbility: RenderAbility = (def, ctx) => {
  try {
    checkAbility(def);
    const marked = K.ability(def, newState(ctx));
    // the Oracle lines of the ability, when known, choose the reading: the display is then the sentence(s) the gate matched (design 10.5)
    const lines = Array.isArray(ctx.oracleLines) ? ctx.oracleLines.map(String) : [];
    const reading = lines.length > 0 ? matchedReading(marked, lines, ctx.selfNames) : null;
    return display(reading ?? marked, ctx);
  } catch (e) {
    // total: a node without a renderer, and JSON that is not the model at all, print as a marker instead of failing the caller
    return [`[cannot render ${e instanceof NoRenderer ? e.node : e instanceof Error ? e.message : String(e)}]`];
  }
};
