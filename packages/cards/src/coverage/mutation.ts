/**
 * The mutation harness of guards G2 and G9 (design 6.8).
 *
 *  - **G2, closed vocabulary (nonsense-word mutation).** One content word of each sentence of a deterministic sample of cards is replaced by an invented
 *    word; the mutated card must never have a `full` ability that carries that word in its behavior. Exempt by design: open classes (a card name after
 *    "named", a counter name before "counter(s)", design 6.11) and the card's own names. Counted, not judged: a word that ends up in no ability (absorbed:
 *    reminder text, structure), and a word that ends up ONLY in an ability's `label` (an ability word or flavor word before a dash, CR 207.2c-d: it has
 *    no rules meaning and the label never affects behavior, design 6.2 step 4).
 *  - **G9, near-miss mutations per template.** Each example of each template is mutated the ways design 6.8 lists (append "unless ...", swap
 *    target/each/all, add "instead", insert "up to", negate with "don't", drop the duration); every mutation must fail to parse, or parse to different
 *    JSON. A mutation that still parses, fully automated, to the SAME JSON as the example is a template that silently ignores words.
 *
 * Both are deterministic (a seeded hash picks cards and words; no Math.random) and work with whatever templates the engine is given.
 */
import { createHash } from 'node:crypto';
import type { AbilityDef, OracleCard, Template } from '@openmtg/engine';
import type { CardRun, CoverageEngine } from './engine';
import { behaviorOf, stableJson } from './snapshot';
import { guessTypeLine } from './try';

const seeded = (seed: string, s: string): string => createHash('sha256').update(`${seed}\u0000${s}`).digest('hex');

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// G2
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** Not an English word, not in the lexicon, not a card name. */
export const NONSENSE_WORD = 'zorblaxine';

export interface NonsenseViolation { name: string; face: number; original: string; mutated: string; ability: string }

export interface NonsenseResult {
  cards: number;
  mutations: number;
  /** Mutations whose word ended up in an ability that is not full: what G2 asks for. */
  rejected: number;
  /** Mutations whose word ended up in no ability at all (reminder text, structure). */
  absorbed: number;
  /** Mutations whose word ended up only in an ability's `label` (ability word or flavor word, CR 207.2c-d): counted, not judged. */
  labelOnly: number;
  violations: NonsenseViolation[];
}

const WORD = /[A-Za-z][A-Za-z'-]*[A-Za-z]|[A-Za-z]/g;

/** Positions of the words of `text` a mutation may replace (outside reminder text; not a name; not an open class). */
export function mutableWords(text: string, names: readonly string[]): { start: number; end: number; word: string }[] {
  const reminder: [number, number][] = [];
  for (const m of text.matchAll(/\([^)]*\)/g)) reminder.push([m.index!, m.index! + m[0].length]);
  const nameWords = new Set(names.flatMap((n) => n.split(/[\s,/]+/)).map((w) => w.toLowerCase()).filter((w) => w.length > 0));
  const out: { start: number; end: number; word: string }[] = [];
  const words = [...text.matchAll(WORD)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, word: m[0] }));
  words.forEach((w, i) => {
    if (w.word.length < 3) return;
    if (reminder.some(([a, b]) => w.start >= a && w.end <= b)) return;
    if (nameWords.has(w.word.toLowerCase())) return;
    const prev = words[i - 1]?.word.toLowerCase();
    const next = words[i + 1]?.word.toLowerCase();
    if (prev === 'named' || next === 'counter' || next === 'counters') return; // open classes (design 6.11)
    out.push(w);
  });
  return out;
}

function withFaceText(card: OracleCard, face: number, text: string): OracleCard {
  if (card.card_faces && card.card_faces.length > 1) {
    const faces = card.card_faces.map((f, i) => (i === face ? { ...f, oracle_text: text } : f));
    return { ...card, card_faces: faces };
  }
  return { ...card, oracle_text: text };
}

const caseLike = (model: string, word: string): string => (model[0] === model[0]!.toUpperCase() ? word[0]!.toUpperCase() + word.slice(1) : word);

/** Deterministic sample: the `count` cards with the smallest seeded hash of their oracle id. */
export function sampleBySeed(cards: readonly OracleCard[], count: number, seed: string): OracleCard[] {
  return [...cards].map((c) => ({ c, h: seeded(seed, c.oracle_id ?? c.name) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).slice(0, count).map((x) => x.c);
}

/**
 * The abilities that carry `word`: in their behavior or text (`label: false`), or only in their ability-word / flavor-word label (`label: true`). The labels
 * are the ability's own and, since FAST5X E11, the flavor words that name the modes of a modal spell ("• Use the Relic — ...", `modes.options[i].label`,
 * CR 207.2d): the ability's text repeats those, so they are taken out of it before the word is looked for elsewhere.
 */
function abilitiesWithWord(run: CardRun, word: string): { face: number; ability: AbilityDef; full: boolean; labelOnly: boolean }[] {
  if (!run.def) return [];
  const out: { face: number; ability: AbilityDef; full: boolean; labelOnly: boolean }[] = [];
  run.def.faces.forEach((f, fi) => f.abilities.forEach((a, ai) => {
    const labels: string[] = [];
    let rest = JSON.stringify(a, (k, v: unknown) => (k === 'label' && typeof v === 'string' ? (labels.push(v.toLowerCase()), undefined) : v)).toLowerCase();
    for (const l of labels) rest = rest.split(l).join(' ');
    const inLabel = labels.some((l) => l.includes(word));
    const elsewhere = rest.includes(word);
    if (!inLabel && !elsewhere) return;
    const level = a.kind === 'manual' ? 'manual' : run.def!.automation.faces?.[fi]?.abilities[ai]?.level;
    out.push({ face: fi, ability: a, full: level === 'full', labelOnly: !elsewhere });
  }));
  return out;
}

/** G2 over `cards` (the caller samples; design: 5,000 random cards of the index). One mutation per sentence. */
export function nonsenseMutations(cards: readonly OracleCard[], engine: CoverageEngine, opts: { seed?: string; word?: string } = {}): NonsenseResult {
  const seed = opts.seed ?? 'g2';
  const word = (opts.word ?? NONSENSE_WORD).toLowerCase();
  const res: NonsenseResult = { cards: 0, mutations: 0, rejected: 0, absorbed: 0, labelOnly: 0, violations: [] };
  for (const card of cards) {
    res.cards++;
    const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : [card];
    faces.forEach((face, fi) => {
      const text = face.oracle_text ?? '';
      const names = [card.name, ...faces.map((f) => f.name), ...faces.map((f) => f.name.split(',')[0]!)];
      // one word per sentence: sentences end at a period outside parentheses and quotes; reminder text is never mutated (it is never parsed)
      let offset = 0;
      for (const line of text.split('\n')) {
        const bySentence = new Map<number, { start: number; end: number; word: string }[]>();
        let parens = 0;
        let quoted = false;
        let sentenceNo = 0;
        const sentenceAt: number[] = [];
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]!;
          if (ch === '"') quoted = !quoted;
          else if (ch === '(') parens++;
          else if (ch === ')') parens = Math.max(0, parens - 1);
          sentenceAt.push(sentenceNo);
          if (ch === '.' && parens === 0 && !quoted) sentenceNo++;
        }
        for (const w of mutableWords(line, names)) bySentence.set(sentenceAt[w.start]!, [...(bySentence.get(sentenceAt[w.start]!) ?? []), w]);
        for (const [n, candidates] of bySentence) {
          const start = offset;
          const pick = candidates[parseInt(seeded(seed, `${card.name}|${fi}|${offset}|${n}`).slice(0, 8), 16) % candidates.length]!;
          const sentence = line;
          const mutated = text.slice(0, start + pick.start) + caseLike(pick.word, word) + text.slice(start + pick.end);
          res.mutations++;
          const run = engine.run(withFaceText(card, fi, mutated));
          const all = abilitiesWithWord(run, word);
          if (all.length === 0) {
            res.absorbed++;
            continue;
          }
          const hits = all.filter((h) => !h.labelOnly);
          if (hits.length === 0) {
            res.labelOnly++;
            continue;
          }
          const bad = hits.find((h) => h.full);
          if (bad) res.violations.push({ name: card.name, face: fi, original: pick.word, mutated: (sentence.slice(0, pick.start) + caseLike(pick.word, word) + sentence.slice(pick.end)).trim(), ability: bad.ability.text ?? '' });
          else res.rejected++;
        }
        offset += line.length + 1;
      }
    });
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// G9
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type NearMissKind = 'append-unless' | 'swap-quantifier' | 'add-instead' | 'insert-up-to' | 'negate' | 'drop-duration';

const DURATIONS = /\s+(until end of turn|until your next turn|this turn|until end of combat)\b/i;

const beforeFinalPeriod = (text: string, insert: string): string => (/\.\s*$/.test(text) ? text.replace(/\.\s*$/, `${insert}.`) : `${text}${insert}`);

/** The near-miss mutations of one example text (only those that change it). */
export function nearMisses(text: string): { kind: NearMissKind; text: string }[] {
  const out: { kind: NearMissKind; text: string }[] = [];
  const add = (kind: NearMissKind, t: string): void => {
    if (t !== text) out.push({ kind, text: t });
  };
  add('append-unless', beforeFinalPeriod(text, ' unless target opponent pays {1}'));
  if (/\btarget\b/i.test(text)) add('swap-quantifier', text.replace(/\btarget\b/i, (w) => (w[0] === 'T' ? 'Each' : 'each')));
  else if (/\beach\b/i.test(text)) add('swap-quantifier', text.replace(/\beach\b/i, (w) => (w[0] === 'E' ? 'Target' : 'target')));
  else if (/\ball\b/i.test(text)) add('swap-quantifier', text.replace(/\ball\b/i, (w) => (w[0] === 'A' ? 'Each' : 'each')));
  add('add-instead', beforeFinalPeriod(text, ' instead'));
  // a count (not inside a mana symbol or a P/T): "draw two cards" -> "draw up to two cards"; else a target: "target creature" -> "up to one target creature"
  const num = /(?<![{\w/+-])(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?![}/])/i.exec(text.replace(/\{[^}]*\}/g, (m) => ' '.repeat(m.length)));
  if (num) add('insert-up-to', `${text.slice(0, num.index)}up to ${text.slice(num.index)}`);
  else if (/\btarget\b/i.test(text)) add('insert-up-to', text.replace(/\btarget\b/i, (w) => (w[0] === 'T' ? 'Up to one target' : 'up to one target')));
  if (/\byou (\w+)/.test(text)) add('negate', text.replace(/\byou (\w+)/, "you don't $1"));
  else if (/^[A-Z][a-z]+\b/.test(text) && !/^(When|Whenever|At|If|As|Until)\b/.test(text)) add('negate', `Don't ${text[0]!.toLowerCase()}${text.slice(1)}`);
  if (DURATIONS.test(text)) add('drop-duration', text.replace(DURATIONS, ''));
  return out;
}

/**
 * The type lines an example of `t` is tried under, in order (invented card, design 6.10). An effect or rider sentence is a spell's text (CR 113.3a):
 * an Instant, then a Sorcery, and only then the `try` guess (which reads "Creatures you control ...", "Other ...", "Enchanted ..." as an Enchantment's
 * static ability and would leave such an effect example unparsed and its template unchecked).
 */
export function exampleTypeLines(t: Pick<Template, 'kind'>, text: string): string[] {
  if (t.kind === 'trigger' || t.kind === 'ability') return ['Creature — Spirit'];
  if (t.kind === 'cost') return ['Artifact Creature — Golem'];
  // std-typechange-2 (CR 306.8): a static ability about the object's own loyalty counters is a planeswalker's ("During your turn, as long as ~ has two or more loyalty
  // counters on it, ~ is a 2/5 Samurai creature ...": the renderer says that identity of a planeswalker only)
  if (t.kind === 'static' && /^during your turn, as long as ~ has [^,]* loyalty counters? on it,/i.test(text)) return ['Legendary Planeswalker — Example'];
  if (t.kind === 'static') return [/^(enchant|equip)/i.test(text) ? 'Enchantment — Aura' : 'Enchantment'];
  return [...new Set(['Instant', 'Sorcery', guessTypeLine(text)])];
}

/** A synthetic card in which an example of `t` is an ability of the right kind (invented name, design 6.10), under `typeLine` (default: the first of `exampleTypeLines`). */
export function exampleCard(t: Pick<Template, 'kind'>, text: string, typeLine: string = exampleTypeLines(t, text)[0]!): OracleCard {
  const oracle = text.replace(/~/g, 'Example Subject');
  const c = { name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: t.kind === 'cost' && !oracle.includes(':') ? `${oracle}: Draw a card.` : oracle, mana_cost: '{1}', colors: [], keywords: [] } as OracleCard;
  if (/\bCreature\b/.test(typeLine)) Object.assign(c, { power: '2', toughness: '2' });
  // r4-repl (CR 107.3, 601.2b): an instant or sorcery example that reads X without defining it ("Draw X cards. If X is 6 or more, ...") is a spell with {X} in its cost
  if (/^(Instant|Sorcery)\b/.test(typeLine) && /\bX\b/.test(oracle.replace(/,? where X is [^.]*/g, '')) && !/\{X\}|\bX is the\b/.test(oracle)) c.mana_cost = '{X}';
  return c;
}

/** The meaning of a fully automated parse (canonical JSON without display text), or null when anything is manual or the gate refused it. */
export function automatedMeaning(run: CardRun): string | null {
  if (!run.def) return null;
  const parseOk = run.parse.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual') && f.gate.every((g) => g.ok));
  if (!parseOk || run.parse.faces.length === 0) return null;
  const abilities = run.parse.faces.flatMap((f) => f.abilities);
  if (abilities.length === 0 || JSON.stringify(abilities).includes('"op":"manual"')) return null;
  return stableJson(abilities.map(behaviorOf));
}

export interface NearMissViolation { template: string; example: string; kind: NearMissKind; mutated: string }

export interface NearMissResult {
  templates: number;
  examples: number;
  /** Examples that do not parse fully automated with the whole template set under any of their type lines (nothing to compare with). */
  unparsedExamples: { template: string; example: string }[];
  /** Templates none of whose examples could be checked: G9 says nothing about them, which the gate reports as a failure. */
  uncheckedTemplates: string[];
  /**
   * W3 integration: templates whose `needs` the engine does not provide (design 6.9: they build a form behind a capability a later milestone registers, so
   * every example is "needs-engine" and none can parse fully). They are not failures; they are checked once the engine provides what they need.
   */
  gatedTemplates: string[];
  mutations: number;
  violations: NearMissViolation[];
}

export function nearMissMutations(templates: readonly Template[], engine: CoverageEngine): NearMissResult {
  const res: NearMissResult = { templates: 0, examples: 0, unparsedExamples: [], uncheckedTemplates: [], gatedTemplates: [], mutations: 0, violations: [] };
  for (const t of templates) {
    res.templates++;
    if ((t.needs ?? []).some((n) => !engine.caps.has(n))) {
      res.gatedTemplates.push(t.id);
      continue;
    }
    let checked = 0;
    for (const ex of t.examples ?? []) {
      res.examples++;
      // the first type line under which the example parses fully automated; its mutations are parsed under the same one
      let base: string | null = null;
      let typeLine = '';
      for (const tl of exampleTypeLines(t, ex.text)) {
        base = automatedMeaning(engine.run(exampleCard(t, ex.text, tl)));
        typeLine = tl;
        if (base !== null) break;
      }
      if (base === null) {
        res.unparsedExamples.push({ template: t.id, example: ex.text });
        continue;
      }
      checked++;
      for (const m of nearMisses(ex.text)) {
        res.mutations++;
        if (automatedMeaning(engine.run(exampleCard(t, m.text, typeLine))) === base) res.violations.push({ template: t.id, example: ex.text, kind: m.kind, mutated: m.text });
      }
    }
    if (checked === 0) res.uncheckedTemplates.push(t.id);
  }
  return res;
}
