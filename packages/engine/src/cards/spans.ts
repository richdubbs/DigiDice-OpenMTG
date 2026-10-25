/**
 * Display spans of a face's Oracle text with their automation status, for painting card text in the UI (design 10.5). Owner: WP18. Contract:
 * cards/pipeline.ts#SpansOf.
 *
 * Derived from the compiled definition alone (the client has a CardDef, not the parser's ledger): the front end re-reads the face's text (reminder
 * text, labels, line structure; parser/preprocess.ts), each line is given to the abilities whose `src` names it, and `CardAutomation.faces` says what of
 * each ability is manual. Ranges are in the face's ORIGINAL Oracle text (`FaceDef.oracleText`), as the player sees it.
 *
 *   reminder   reminder text (CR 207.2a): dimmed, never behavior
 *   label      an ability word or flavor word (CR 207.2c-d)
 *   auto       text of an ability that is fully automated, or the automated part of a partial one, or the understood cost of a manual activated
 *              ability ("Understood costs stay plain": the engine charges it)
 *   manual     text of a manual ability, or of a manual node of a partial one (path and reason from the ManualSpan)
 *
 * Conservative: text no ability claims (abilityIndex -1, as the TextSpan contract says), and a manual node whose words cannot be found in its line,
 * paint the whole (rest of the) line manual. Never
 * throws: if the text cannot be read at all, the whole face is one manual span.
 */
import type { AbilityDef } from '../types/ability';
import type { AbilityAutomation } from '../types/automation';
import { defaultParseOptions } from '../parser/parse';
import { originalRange, preprocessFace, type PreprocessedFace, type Range } from '../parser/preprocess';
import { contextOfFace } from './face-text';
import type { SpansOf, TextSpan } from './pipeline';

function trim(text: string, r: Range): Range {
  let [a, b] = r;
  while (a < b && /\s/.test(text[a]!)) a++;
  while (b > a && /\s/.test(text[b - 1]!)) b--;
  return [a, b];
}

/** Sub-ranges of `r` not covered by `holes`, trimmed, non-empty. */
function minus(text: string, r: Range, holes: readonly Range[]): Range[] {
  const out: Range[] = [];
  let at = r[0];
  for (const h of [...holes].sort((a, b) => a[0] - b[0])) {
    if (h[1] <= at || h[0] >= r[1]) continue;
    if (h[0] > at) out.push([at, h[0]]);
    at = Math.max(at, h[1]);
  }
  if (at < r[1]) out.push([at, r[1]]);
  return out.map((p) => trim(text, p)).filter((p) => p[0] < p[1]);
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where the words of `needle` are inside `range` of the parse text ("~" + blanks for the object's name) or the normalized text. Whitespace-tolerant. */
function locate(pre: PreprocessedFace, range: Range, needle: string): Range | null {
  const words = needle.trim().replace(/\.$/, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const re = new RegExp(words.map(escape).join('\\s+'), 'i');
  for (const text of [pre.parse, pre.normalized]) {
    const m = re.exec(text.slice(range[0], range[1]));
    if (m) return trim(text, [range[0] + m.index, range[0] + m.index + m[0].length]);
  }
  return null;
}

interface Owner {
  index: number;
  def: AbilityDef;
  auto: AbilityAutomation | undefined;
}

type Push = (r: Range, status: TextSpan['status'], abilityIndex: number, path?: string, reason?: string) => void;

const firstReason = (o: Owner): string => o.auto?.manual[0]?.reason ?? (o.def.kind === 'manual' ? o.def.reason : 'manual');

/**
 * The "[Cost]:" part of an activated ability's line (CR 602.1a) and the rest, when the ability's cost is understood: an activated ability (or a manual
 * ability that kept its cost, parser/lower/verify.ts#demote) whose cost has no manual part and no manual node under `/cost`. Null otherwise.
 */
function costSplit(pre: PreprocessedFace, body: Range[], o: Owner): { cost: Range; rest: Range[] } | null {
  const cost = (o.def as { cost?: unknown }).cost;
  if (cost === undefined || (o.def.kind !== 'activated' && o.def.kind !== 'manual') || JSON.stringify(cost).includes('"kind":"manual"')) return null;
  if ((o.auto?.manual ?? []).some((m) => m.path.startsWith('/cost'))) return null;
  const first = body[0];
  if (first === undefined) return null;
  const text = pre.normalized.slice(first[0], first[1]);
  const colon = text.indexOf(':');
  const quote = text.indexOf('"');
  if (colon <= 0 || (quote >= 0 && quote < colon)) return null;
  const head = trim(pre.normalized, [first[0], first[0] + colon + 1]);
  const tail = trim(pre.normalized, [first[0] + colon + 1, first[1]]);
  return { cost: head, rest: [...(tail[0] < tail[1] ? [tail] : []), ...body.slice(1)] };
}

function spansOfLine(pre: PreprocessedFace, body: Range[], owners: Owner[], push: Push): void {
  if (owners.length === 0) {
    for (const r of body) push(r, 'manual', -1, '', 'no ability of the card claims this text');
    return;
  }
  const isManual = (o: Owner): boolean => o.def.kind === 'manual' || o.auto === undefined || o.auto.level === 'manual';
  const lead = owners.find(isManual);
  if (lead && owners.every(isManual)) {
    // design 10.5 "Understood costs stay plain": the engine charges an understood activation cost (CR 602.2b) even when the effect is resolved by hand
    const split = owners.length === 1 ? costSplit(pre, body, lead) : null;
    if (split) push(split.cost, 'auto', lead.index);
    for (const r of split ? split.rest : body) push(r, 'manual', lead.index, lead.auto?.manual[0]?.path ?? '', firstReason(lead));
    return;
  }
  // Several abilities share the line (a keyword list) or one is partial: each manual ability's words, and each manual node of a partial one, are
  // located in the line; everything else is automated. Anything that cannot be placed paints the whole line manual (never manual text shown as automated).
  const holes: { r: Range; o: Owner; path: string; reason: string }[] = [];
  const wanted: { o: Owner; text: string; path: string; reason: string }[] = owners.flatMap((o) =>
    isManual(o) ? [{ o, text: o.def.text, path: o.auto?.manual[0]?.path ?? '', reason: firstReason(o) }] : (o.auto?.manual ?? []).map((m) => ({ o, text: m.text, path: m.path, reason: m.reason })),
  );
  for (const w of wanted) {
    const where = w.text === '' ? null : (body.map((b) => locate(pre, b, w.text)).find((x) => x !== null) ?? null);
    if (where === null) {
      for (const r of body) push(r, 'manual', w.o.index, w.path, w.reason);
      return;
    }
    holes.push({ r: where, o: w.o, path: w.path, reason: w.reason });
  }
  // one span per place (two manual nodes may name the same words), and no manual span inside another
  const placed = holes.filter((h, i) => !holes.some((o, j) => j !== i && o.r[0] <= h.r[0] && o.r[1] >= h.r[1] && (o.r[0] !== h.r[0] || o.r[1] !== h.r[1] || j < i)));
  for (const h of placed) push(h.r, 'manual', h.o.index, h.path, h.reason);
  const automated = (owners.find((o) => !isManual(o)) ?? owners[0]!).index;
  for (const b of body) for (const r of minus(pre.normalized, b, placed.map((h) => h.r))) push(r, 'auto', automated);
}

export const spansOf: SpansOf = (def, faceIndex) => {
  const face = def.faces[faceIndex];
  if (face === undefined) return [];
  const autos = def.automation.faces?.[faceIndex]?.abilities;
  let pre: PreprocessedFace;
  try {
    const opts = defaultParseOptions();
    const others = def.faces.length > 1 ? def.faces.filter((_, j) => j !== faceIndex).map((f) => f.name) : [];
    pre = preprocessFace(contextOfFace(face, def.layout, others, opts), opts);
  } catch {
    const text = face.oracleText;
    return text.trim() === '' ? [] : [{ range: [0, text.length], status: 'manual', abilityIndex: -1, path: '', reason: 'the text could not be read' }];
  }
  const out: TextSpan[] = [];
  const push: Push = (r, status, abilityIndex, path, reason) => {
    const range = originalRange(pre.offsets, r) as [number, number];
    if (range[0] >= range[1]) return;
    out.push({ range, status, abilityIndex, ...(path !== undefined ? { path } : {}), ...(reason !== undefined ? { reason } : {}) });
  };
  const owners = (line: number): Owner[] => face.abilities.flatMap((a, index) => ((a.src ?? []).includes(line) ? [{ index, def: a, auto: autos?.[index] }] : []));
  // abilities without src (a parser error, an unknown mana symbol): the first one owns the lines nobody else claims
  const orphan = face.abilities.map((a, index): Owner => ({ index, def: a, auto: autos?.[index] })).filter((o) => o.def.src === undefined && o.def.kind === 'manual' && o.def.text.trim() !== '' && o.def.text.trim() !== '');
  for (const line of pre.lines) {
    if (line.blank) continue;
    // trek-9: a reminder that a line break splits ("(As this Saga enters and after your draw\nstep, add a lore counter. Sacrifice after III.)", Those Old Scientists in the
    // Oracle data) is one reminder of the preprocessor and a reminder-only line each: it is painted line by line, each piece clipped to its line
    const reminders = pre.reminders.filter((r) => r.range[0] < line.range[1] && r.range[1] > line.range[0]).map((r): Range => [Math.max(r.range[0], line.range[0]), Math.min(r.range[1], line.range[1])]);
    let mine = owners(line.index);
    if (mine.length === 0 && orphan.length > 0) mine = [orphan[0]!];
    const lead = mine[0]?.index ?? -1;
    for (const r of reminders) push(r, 'reminder', lead);
    const label = line.label?.range;
    if (label) for (const r of minus(pre.normalized, label, reminders)) push(r, 'label', lead);
    if (line.reminderOnly) continue;
    const body = minus(pre.normalized, line.range, [...reminders, ...(label ? [label] : [])]);
    if (body.length > 0) spansOfLine(pre, body, mine, push);
  }
  return out.sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
};
